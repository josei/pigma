import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFile, runCli } from '../../src/mcp/bin';

const restFixture = fileURLToPath(new URL('../figma/fixtures/rest-file.json', import.meta.url));
const circleFig = fileURLToPath(new URL('../figma/fixtures/circle.fig', import.meta.url));

/**
 * A throwaway workspace per test. Every one is removed afterwards: without this
 * a full run leaked a directory per CLI test, thousands of them over time.
 */
const workspaces: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pigma-mcp-'));
  workspaces.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function runWith(stdioLines: string[], argv: string[]): Promise<{ written: string[]; logs: string[] }> {
  const written: string[] = [];
  const logs: string[] = [];
  async function* input(): AsyncGenerator<string> {
    for (const line of stdioLines) yield `${line}\n`;
  }
  await runCli(argv, { stdio: { input: input(), output: { write: (chunk) => written.push(chunk) } }, log: (message) => logs.push(message) });
  return { written, logs };
}

const createCall = (name: string) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'use_pigma', arguments: { operations: [{ call: 'figma.createRectangle', args: { name, width: 12, height: 12 } }] } },
  });

describe('MCP CLI loading', () => {
  it('validates Pigma JSON with the project validator', () => {
    const loaded = loadFile(restFixture);
    expect(loaded.source).toBe('rest');
    expect(loaded.file.schema).toBe('pigma/1');

    expect(loadFile(circleFig).source).toBe('native');
  });

  it('rejects a Pigma-tagged document that fails validation', () => {
    const dir = workspace();
    const bad = join(dir, 'bad.json');
    // Right schema tag, but no valid document tree.
    writeFileSync(bad, JSON.stringify({ schema: 'pigma/1', name: 'Broken', document: { type: 'NOPE', children: [] } }));
    expect(() => loadFile(bad)).toThrow(/Invalid Pigma document/);
  });

  it('round-trips a valid Pigma document', () => {
    const dir = workspace();
    const docPath = join(dir, 'doc.json');
    writeFileSync(docPath, JSON.stringify(loadFile(restFixture).file));
    const loaded = loadFile(docPath);
    expect(loaded.source).toBe('pigma');
    expect(loaded.file.name).toBe('Pigma Import Fixture');
  });
});

describe('MCP CLI persistence', () => {
  it('persists MCP writes back to a Pigma JSON file, atomically', async () => {
    const dir = workspace();
    const docPath = join(dir, 'doc.json');
    writeFileSync(docPath, JSON.stringify(loadFile(restFixture).file));

    const { written } = await runWith(
      [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }), createCall('Persisted')],
      ['--file', docPath],
    );
    const responses = written.map((line) => JSON.parse(line) as { id: number; result?: { isError?: boolean } });
    expect(responses).toHaveLength(2);
    expect(responses[1]?.result?.isError).toBeFalsy();

    const saved = JSON.parse(readFileSync(docPath, 'utf8')) as { document: { children: Array<{ children: Array<{ name: string }> }> } };
    expect(saved.document.children.flatMap((page) => page.children.map((child) => child.name))).toContain('Persisted');
    // No temp file left behind.
    expect(readdirSync(dir).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('does not convert a REST import in place and warns without --out', async () => {
    const dir = workspace();
    const restPath = join(dir, 'figma-rest.json');
    writeFileSync(restPath, readFileSync(restFixture));
    const before = readFileSync(restPath, 'utf8');

    const { written, logs } = await runWith([createCall('NotSaved')], ['--file', restPath]);
    expect(written).toHaveLength(1);
    expect(logs.some((line) => line.includes('read-only'))).toBe(true);
    // The original Figma REST file is untouched.
    expect(readFileSync(restPath, 'utf8')).toBe(before);
  });

  it('persists a native .fig import to --out', async () => {
    const dir = workspace();
    const outPath = join(dir, 'out.json');
    await runWith([createCall('Exported')], ['--file', circleFig, '--out', outPath]);
    const saved = JSON.parse(readFileSync(outPath, 'utf8')) as { schema: string; document: { children: Array<{ children: Array<{ name: string }> }> } };
    expect(saved.schema).toBe('pigma/1');
    expect(saved.document.children.flatMap((page) => page.children.map((child) => child.name))).toContain('Exported');
  });

  it('leaves memory uncommitted when the disk write fails', async () => {
    const dir = workspace();
    const docPath = join(dir, 'doc.json');
    writeFileSync(docPath, JSON.stringify(loadFile(restFixture).file));
    const unwritable = join(dir, 'missing-dir', 'out.json');

    const { written } = await runWith([createCall('Lost'), createCall('Lost2')], ['--file', docPath, '--out', unwritable]);
    const responses = written.map((line) => JSON.parse(line) as { result?: { isError?: boolean } });
    expect(responses[0]?.result?.isError).toBe(true);
    expect(existsSync(unwritable)).toBe(false);
    // The in-place Pigma file was not modified by the failed save.
    const saved = JSON.parse(readFileSync(docPath, 'utf8')) as { document: { children: Array<{ children: Array<{ name: string }> }> } };
    expect(saved.document.children.flatMap((page) => page.children.map((child) => child.name))).not.toContain('Lost');
  });
});
