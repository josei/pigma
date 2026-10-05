/**
 * Browser side of the local relay bridge.
 *
 * Connects the running editor to a Pigma relay (`src/mcp/relay.ts`) over
 * Server-Sent Events, applies remote commands to a {@link DocumentSession}
 * (normally the live editor store via `createEditorSession`), and posts results
 * back. This is a real transport between an external MCP client and the open
 * canvas — not a same-process import.
 *
 * Bidirectional sync: every local change (draw, select, undo) bumps a revision
 * and is pushed to the relay, so MCP never serves a stale cache. Remote writes
 * carry the revision the caller read and are **rejected** if the editor has
 * moved on, instead of silently clobbering local work.
 */
import type { PigmaFile } from '../model/types';
import { checkRevision, type DocumentSession } from './session';

export type BridgeStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface BridgeClientOptions {
  /** Relay base URL, e.g. `http://127.0.0.1:3002`. */
  url: string;
  /** Per-run relay token. */
  token: string;
  /** Session to read/write (the live editor). */
  session: DocumentSession;
  /** Label shown in relay status. */
  name?: string;
  onStatus?: (status: BridgeStatus, detail?: string) => void;
}

export interface BridgeClient {
  close(): void;
  status(): BridgeStatus;
  /** Current local revision (bumped on every document/selection change). */
  revision(): number;
}

interface RelayCommand {
  id: number;
  method: 'getFile' | 'getState' | 'setFile' | 'getSelection' | 'setSelection';
  params?: { file?: PigmaFile; ids?: string[]; expectedRevision?: number };
}

export function connectBridge(options: BridgeClientOptions): BridgeClient {
  const { url, token, session } = options;
  const base = url.replace(/\/$/, '');
  let status: BridgeStatus = 'connecting';
  let closed = false;
  let revision = 0;
  let pushScheduled = false;

  // A unique id per connection: the relay attributes state pushes to the active
  // editor, so a second connected window cannot clobber this one's selection.
  const connectionId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `c-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const source = new EventSource(
    `${base}/bridge/events?token=${encodeURIComponent(token)}&client=${encodeURIComponent(options.name ?? 'editor')}&cid=${encodeURIComponent(connectionId)}`,
  );

  const setStatus = (next: BridgeStatus, detail?: string): void => {
    status = next;
    options.onStatus?.(next, detail);
  };

  const post = async (body: unknown, path = '/bridge/result'): Promise<void> => {
    try {
      await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pigma-token': token },
        body: JSON.stringify({ ...(body as Record<string, unknown>), client: connectionId }),
      });
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : String(error));
    }
  };

  const push = async (): Promise<boolean> => {
    try {
      const response = await fetch(`${base}/bridge/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pigma-token': token },
        body: JSON.stringify({ id: 0, ok: true, sync: { file: session.getFile(), selection: session.getSelection(), revision } }),
      });
      return response.ok;
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const schedulePush = (): void => {
    if (pushScheduled) return;
    pushScheduled = true;
    queueMicrotask(() => {
      pushScheduled = false;
      void push();
    });
  };

  const bump = (): void => {
    revision += 1;
    schedulePush();
  };

  // Local edits, selection changes, and undo all notify through `subscribe`.
  const unsubscribe = session.subscribe?.(bump);

  source.addEventListener('hello', () => {
    // Report "connected" only once the relay has registered our initial state,
    // so clients that wait on the status never hit the registration gap.
    void (async () => {
      if (await push()) setStatus('connected');
    })();
  });

  source.addEventListener('command', (event) => {
    const command = JSON.parse((event as MessageEvent<string>).data) as RelayCommand;
    void (async () => {
      // PROGRESS: while this command runs, keep telling the bridge it is STILL
      // WORKING. The bridge re-arms the command's timer on each report, so a long
      // import stays alive and a command whose editor vanished stops reporting and
      // fails on a SHORT silence instead of the full budget.
      //
      // A SYNCHRONOUS stretch of work cannot report — the event loop is blocked, and
      // the bridge's TOTAL budget covers it. That is stated rather than hidden: the
      // reports come from the await points, which is where a long command actually
      // spends its time here.
      const progress = setInterval(() => {
        void post({ id: command.id, ok: true, progress: true }, '/bridge/progress');
      }, 1_000);
      const stopProgress = (): void => clearInterval(progress);
      try {
        try {
          checkRevision(revision, command.params?.expectedRevision);
        } catch (error) {
          await post({ id: command.id, ok: false, error: (error as Error).message });
          return;
        }
        switch (command.method) {
          case 'getFile':
            await post({ id: command.id, ok: true, result: session.getFile() });
            return;
          case 'getState':
            await post({
              id: command.id,
              ok: true,
              result: { file: session.getFile(), selection: session.getSelection(), revision },
            });
            return;
          case 'getSelection':
            await post({ id: command.id, ok: true, result: session.getSelection() });
            return;
          case 'setFile':
            await session.setFile(command.params?.file as never);
            await push();
            await post({ id: command.id, ok: true, result: { revision } });
            return;
          case 'setSelection':
            await session.setSelection(command.params?.ids ?? []);
            await push();
            await post({ id: command.id, ok: true, result: { revision } });
            return;
        }
      } catch (error) {
        await post({ id: command.id, ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        // The command has settled: stop reporting progress. A report AFTER the
        // result would re-arm a timer for an entry that no longer exists, which is
        // harmless — but stopping keeps the traffic honest.
        stopProgress();
      }
    })();
  });

  source.addEventListener('error', () => {
    if (!closed) setStatus('error', 'relay connection lost');
  });

  return {
    close: () => {
      closed = true;
      unsubscribe?.();
      source.close();
      setStatus('disconnected');
    },
    status: () => status,
    revision: () => revision,
  };
}
