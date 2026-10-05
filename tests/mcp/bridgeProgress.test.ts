/**
 * Progress separates LIVENESS from WORK DURATION.
 *
 * The bridge has two budgets: a TOTAL one (the old number, kept so an editor that
 * never reports progress is bounded exactly as before) and a SILENCE one, which
 * applies once an editor HAS reported progress — from then on the timer measures
 * silence, not total work.
 */
import { describe, expect, it } from 'vitest';
import { startRelayServer } from '../../src/mcp/relay';
import { emptyFile } from '../../src/model/validate';

/** A scripted editor: connects, answers commands only when told to. */
async function scriptedEditor(relay: { url: string; token: string }) {
  const controller = new AbortController();
  const response = await fetch(`${relay.url}/bridge/events?token=${relay.token}&client=scripted&cid=scripted-1`, {
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const commandIds: number[] = [];
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const line of buffer.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6)) as { id?: number; method?: string };
          if (typeof payload.id === 'number' && payload.method) commandIds.push(payload.id);
        } catch {
          /* a heartbeat comment, not data */
        }
      }
      buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
    }
  })();
  return {
    commandIds,
    async waitForCommand(timeoutMs = 3000): Promise<number> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (commandIds.length > 0) return commandIds[commandIds.length - 1] as number;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('the editor never received a command');
    },
    progress(id: number): Promise<Response> {
      return fetch(`${relay.url}/bridge/progress`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pigma-token': relay.token },
        body: JSON.stringify({ id }),
      });
    },
    result(id: number): Promise<Response> {
      return fetch(`${relay.url}/bridge/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pigma-token': relay.token },
        body: JSON.stringify({ id, ok: true, result: { revision: 0 } }),
      });
    },
    close: () => controller.abort(),
  };
}

describe('bridge command progress', () => {
  it('a long command that keeps reporting progress COMPLETES', async () => {
    // Silence budget far shorter than the work: without progress this would fail.
    const relay = await startRelayServer({ token: 'p1', commandSilenceMs: 200, commandTimeoutMs: 10_000 });
    const editor = await scriptedEditor(relay);
    try {
      // `setFile` is an async COMMAND (getFile reads the mirror, synchronously).
      const pending = relay.session.setFile(emptyFile('Progress'));
      const id = await editor.waitForCommand();
      // Report progress for longer than the silence budget, then answer.
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        await editor.progress(id);
      }
      await editor.result(id);
      // COMPLETES: the point is that it does not reject, after reporting progress
      // for longer than the silence budget would have allowed.
      await expect(pending).resolves.not.toThrow();
    } finally {
      editor.close();
      await relay.close();
    }
  });

  it('a command whose progress STOPS is failed promptly, at the silence budget', async () => {
    const relay = await startRelayServer({ token: 'p2', commandSilenceMs: 250, commandTimeoutMs: 30_000 });
    const editor = await scriptedEditor(relay);
    try {
      // `setFile` is an async COMMAND (getFile reads the mirror, synchronously).
      const pending = relay.session.setFile(emptyFile('Progress'));
      const id = await editor.waitForCommand();
      await editor.progress(id);
      const started = Date.now();
      await expect(pending).rejects.toThrow(/no progress from the editor/);
      const elapsed = Date.now() - started;
      // PROMPTLY: far below the total budget, because it measures silence.
      expect(elapsed, 'it waited for the total budget instead of the silence one').toBeLessThan(5_000);
    } finally {
      editor.close();
      await relay.close();
    }
  });

  it('a command that NEVER reports progress falls back to the TOTAL budget', async () => {
    // The compatibility case: an editor that does not know about progress is
    // bounded by the total budget, exactly as before.
    const relay = await startRelayServer({ token: 'p3', commandSilenceMs: 100, commandTimeoutMs: 600 });
    const editor = await scriptedEditor(relay);
    try {
      // `setFile` is an async COMMAND (getFile reads the mirror, synchronously).
      const pending = relay.session.setFile(emptyFile('Progress'));
      await editor.waitForCommand();
      const started = Date.now();
      await expect(pending).rejects.toThrow(/timed out/);
      const elapsed = Date.now() - started;
      expect(elapsed, 'it failed at the SILENCE budget, breaking non-progressing editors').toBeGreaterThan(400);
      expect(elapsed).toBeLessThan(3_000);
    } finally {
      editor.close();
      await relay.close();
    }
  });
});
