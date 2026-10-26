/**
 * Shared plugin engine (`src/plugins/engine.ts`) tests.
 *
 * These run against the engine directly, with an injected loader — the same
 * surface the browser editor uses. The Node binding in `src/mcp/plugin` is
 * covered by `tests/mcp/plugin.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { getQuickJS } from 'quickjs-emscripten';
import { createPluginEngine, type PluginEngineLoader, type QuickJSModuleLike } from '../../src/plugins/engine';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import { findNode } from '../../src/model/tree';
import type { PigmaFile } from '../../src/model/types';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../figma/fixtures/${name}`, import.meta.url)), 'utf8'));

function freshFile(): PigmaFile {
  return figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 }).file;
}

/** The loader a browser host would supply, injected here so the engine stays host-agnostic. */
const nodeLoader: PluginEngineLoader = async () => (await getQuickJS()) as unknown as QuickJSModuleLike;

describe('shared plugin engine', () => {
  it('requires a loader instead of importing a runtime itself', () => {
    expect(() => createPluginEngine(undefined as unknown as PluginEngineLoader)).toThrow(/requires a loader/);
  });

  it('uses the injected loader and returns file, output, logs, and warnings', async () => {
    let loads = 0;
    const engine = createPluginEngine(async () => {
      loads += 1;
      return nodeLoader();
    });
    const result = await engine.run(
      `const rect = figma.createRectangle({ x: 10, y: 20, width: 30, height: 40, name: 'From engine' }); rect.id;`,
      freshFile(),
    );
    expect(loads).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.logs).toEqual([]);
    expect(result.closed).toBe(false);
    const node = findNode(result.file.document, String(result.output));
    expect(node?.name).toBe('From engine');
    expect(node?.type).toBe('RECTANGLE');
  });

  it('surfaces loader failures with their cause', async () => {
    const engine = createPluginEngine(async () => {
      throw new Error('wasm unavailable');
    });
    await expect(engine.run('1;', freshFile())).rejects.toThrow(/wasm unavailable/);
  });

  it('keeps the sandbox guarantees', async () => {
    const engine = createPluginEngine(nodeLoader);
    const result = await engine.run(
      `[
        typeof require, typeof process, typeof fetch, typeof globalThis.__pigmaGet,
        typeof globalThis.eval === 'function' ? 'js-eval-only' : 'no-eval',
      ].join(',')`,
      freshFile(),
    );
    expect(result.output).toBe('undefined,undefined,undefined,undefined,js-eval-only');

    // Unsupported members are explicit errors, never silent no-ops.
    await expect(engine.run('figma.currentPage.exportAsync;', freshFile())).rejects.toThrow(/Unsupported/);
    await expect(engine.run('figma.createRectangle().doesNotExist;', freshFile())).rejects.toThrow(
      /Unsupported Plugin API member "doesNotExist"/,
    );
  });

  it('enforces the wall-clock limit', async () => {
    const engine = createPluginEngine(nodeLoader);
    await expect(engine.run('while (true) {}', freshFile(), { timeoutMs: 50 })).rejects.toThrow(/interrupted|timed out/i);
  });

  it('reports converted or skipped input as warnings, and keeps them in logs', async () => {
    const engine = createPluginEngine(nodeLoader);
    const result = await engine.run(
      `
      const vector = figma.createVector({ width: 10, height: 10 });
      vector.vectorNetwork = {
        vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        segments: [
          { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 2, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        ],
      };
      figma.on('selectionchange', () => {});
      vector.id;
      `,
      freshFile(),
    );
    expect(result.warnings.some((line) => line.includes('converted to pathData'))).toBe(true);
    expect(result.warnings.some((line) => line.includes('is not delivered in Pigma'))).toBe(true);
    for (const warning of result.warnings) expect(result.logs).toContain(warning);
  });

  it('delivers plugin parameters and reports the run handler output', async () => {
    const engine = createPluginEngine(nodeLoader);
    const result = await engine.run(
      `figma.on('run', ({ parameters }) => figma.createText({ characters: parameters.label }).id);`,
      freshFile(),
      { parameters: { label: 'Shared' } },
    );
    const node = findNode(result.file.document, String(result.output));
    expect(node?.type).toBe('TEXT');
    expect(node && 'characters' in node ? node.characters : '').toBe('Shared');
  });

  it('is independent per engine instance (no shared guest state)', async () => {
    const engine = createPluginEngine(nodeLoader);
    const first = await engine.run('figma.createRectangle({ name: "A" }).id;', freshFile());
    const second = await engine.run('figma.currentPage.children.length;', freshFile());
    expect(typeof first.output).toBe('string');
    // The second run starts from the file it was given, not the first run's.
    expect(second.output).toBe(freshFile().document.children[0]?.children.length ?? 0);
  });
});
