/**
 * Browser stand-in for the editor bridge, shared by the bridge tests and the
 * hosted-deployment tests.
 *
 * Speaks the relay protocol over real HTTP with the same revision/ACK semantics
 * as `src/mcp/browserClient.ts`: it opens the SSE stream, answers commands, and
 * pushes state. Not a test file itself (vitest collects `*.test.ts`).
 */
import type { PigmaFile } from '../../src/model/types';

export interface RelayCommand {
  id: number;
  method: string;
  params?: { file?: PigmaFile; ids?: string[]; expectedRevision?: number };
}

/**
 * Browser stand-in that speaks the relay protocol over real HTTP with the same
 * revision/ACK semantics as `src/mcp/browserClient.ts`.
 */
export class FakeBrowser {
  file: PigmaFile | null;
  selection: string[] = [];
  revision = 0;
  connected = false;
  /** The stream's terminal error, when it ended for a reason other than close(). */
  lastError: Error | null = null;
  /** Connection id; the relay attributes state pushes to the active one. */
  readonly id: string;
  private readonly base: string;
  private readonly token: string;
  private readonly abort = new AbortController();

  constructor(base: string, token: string, file: PigmaFile, id = `browser-${Math.random().toString(36).slice(2)}`) {
    this.base = base;
    this.token = token;
    this.file = file;
    this.id = id;
    void this.run();
  }

  private async post(body: unknown): Promise<void> {
    await fetch(`${this.base}/bridge/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pigma-token': this.token },
      body: JSON.stringify({ ...(body as Record<string, unknown>), client: this.id }),
    });
  }

  private async push(): Promise<void> {
    await this.post({ id: 0, ok: true, sync: { file: this.file, selection: this.selection, revision: this.revision } });
  }

  /** Simulate a local editor change (draw / select / undo). */
  async localEdit(mutate: (file: PigmaFile) => PigmaFile, selection?: string[]): Promise<void> {
    this.file = mutate(this.file as PigmaFile);
    if (selection) this.selection = selection;
    this.revision += 1;
    await this.push();
  }

  private async run(): Promise<void> {
    try {
      const response = await fetch(`${this.base}/bridge/events?token=${this.token}&client=fake-browser&cid=${encodeURIComponent(this.id)}`, { signal: this.abort.signal });
      const reader = response.body?.getReader();
      if (!reader) throw new Error('no SSE body');
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf('\n\n');
        while (index >= 0) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const event = /^event: (.*)$/m.exec(chunk)?.[1];
          const data = /^data: (.*)$/m.exec(chunk)?.[1];
          if (event === 'hello') {
            this.connected = true;
            await this.push();
          }
          if (event === 'command' && data) await this.handle(JSON.parse(data) as RelayCommand);
          index = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      // A server going away mid-stream (ECONNRESET / "fetch failed") is ordinary
      // teardown, not a test failure. Recording it keeps the information without
      // producing an unhandled rejection — which vitest reports as a run-level
      // error and which made a loaded run look broken.
      this.lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  private async handle(command: RelayCommand): Promise<void> {
    const expected = command.params?.expectedRevision;
    if (expected !== undefined && expected !== this.revision) {
      await this.post({ id: command.id, ok: false, error: `stale revision: editor is at ${this.revision}, caller read ${expected}` });
      return;
    }
    switch (command.method) {
      case 'setFile':
        this.file = command.params?.file ?? this.file;
        this.revision += 1;
        await this.push();
        await this.post({ id: command.id, ok: true, result: { revision: this.revision } });
        break;
      case 'setSelection':
        this.selection = command.params?.ids ?? [];
        this.revision += 1;
        await this.push();
        await this.post({ id: command.id, ok: true, result: { revision: this.revision } });
        break;
      case 'getFile':
        await this.post({ id: command.id, ok: true, result: this.file });
        break;
      case 'getState':
        await this.post({
          id: command.id,
          ok: true,
          result: { file: this.file, selection: this.selection, revision: this.revision },
        });
        break;
      default:
        await this.post({ id: command.id, ok: false, error: `unsupported ${command.method}` });
    }
  }

  async waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('timed out waiting for the fake browser');
  }

  close(): void {
    this.abort.abort();
  }
}

