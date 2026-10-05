/**
 * `download_assets` across its formats, through the real server path.
 *
 * The tool used to export SVG only. It now also produces PNG (the rasterizer the
 * other tools already use) and PDF (the editor's own vector PDF writer), and the
 * proof has to be the *bytes*: a data URL that is merely non-empty proves
 * nothing. So this spawns the real CLI over stdio, exports a page in each
 * format, and checks the file signatures the format itself defines — the same
 * standard the editor's export specs use (`%PDF-1.4`, the PNG IHDR).
 *
 * The document is a real Figma REST import, so the PDF path exercises a node the
 * vector writer cannot express (a VIDEO fill) and must report it in `warnings`
 * rather than crash — it used to throw on exactly that.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PROJECT_ROOT, VITE_NODE_ENTRY } from './fixtures/spawn';

vi.setConfig({ testTimeout: 60_000 });

const REST_FILE = fileURLToPath(new URL('../figma/fixtures/rest-file.json', import.meta.url));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface AssetResult {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: { assets?: Array<{ nodeId: string; format: string; dataUrl: string; warnings?: string[] }> };
}

const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
});

/** A client on the real stdio CLI, with the REST document loaded. */
async function connect(): Promise<Client> {
  const client = new Client({ name: 'assets-harness-unknown', version: '0.0.1' });
  clients.push(client);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [VITE_NODE_ENTRY, 'src/mcp/bin.ts', '--file', REST_FILE],
      cwd: PROJECT_ROOT,
      stderr: 'pipe',
    }),
  );
  return client;
}

/** The page id, discovered from the server (never assumed). */
async function pageId(client: Client): Promise<string> {
  const listed = (await client.callTool({ name: 'get_metadata', arguments: {} })) as {
    structuredContent?: { pages?: Array<{ id: string }> };
  };
  const id = listed.structuredContent?.pages?.[0]?.id;
  expect(id, 'get_metadata without a nodeId must list the pages').toBeTruthy();
  return id!;
}

async function exportPage(client: Client, format: string, extra: Record<string, unknown> = {}) {
  const result = (await client.callTool({
    name: 'download_assets',
    arguments: { nodeIds: [await pageId(client)], defaultFormat: format, ...extra },
  })) as AssetResult;
  expect(result.isError, `${format} export should not error`).toBeFalsy();
  const asset = result.structuredContent?.assets?.[0];
  expect(asset, `${format} export must return an asset`).toBeTruthy();
  expect(asset!.format).toBe(format);
  const [header, base64] = asset!.dataUrl.split(',');
  expect(header).toBe(`data:${format === 'svg' ? 'image/svg+xml' : format === 'png' ? 'image/png' : 'application/pdf'};base64`);
  const bytes = Buffer.from(base64 ?? '', 'base64');
  expect(bytes.length, `${format} bytes must not be empty`).toBeGreaterThan(0);
  return { asset: asset!, bytes };
}

describe('download_assets formats', () => {
  it('still exports SVG', async () => {
    const client = await connect();
    const { bytes } = await exportPage(client, 'svg');
    const svg = bytes.toString('utf8');
    expect(svg.startsWith('<?xml version="1.0"')).toBe(true);
    expect(svg).toContain('<svg');
  });

  it('exports a real PNG, and defaultScale really scales it', async () => {
    const client = await connect();
    const one = await exportPage(client, 'png');
    expect(one.bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'PNG signature').toBe(true);
    // IHDR is the first chunk: width and height are big-endian at bytes 16 and 20.
    const width1 = one.bytes.readUInt32BE(16);
    const height1 = one.bytes.readUInt32BE(20);
    expect(width1).toBeGreaterThan(0);
    expect(height1).toBeGreaterThan(0);

    const two = await exportPage(client, 'png', { defaultScale: 2 });
    expect(two.bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(two.bytes.readUInt32BE(16)).toBe(width1 * 2);
    expect(two.bytes.readUInt32BE(20)).toBe(height1 * 2);
  });

  it('exports a real PDF, and reports what the vector writer cannot express', async () => {
    const client = await connect();
    const { asset, bytes } = await exportPage(client, 'pdf');
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    // The fixture carries a VIDEO fill: unrepresentable in a vector PDF, so it
    // must be reported — this is the path that used to crash the whole export.
    expect(asset.warnings?.some((warning) => /VIDEO fills/.test(warning))).toBe(true);
  });

  it('names the formats it can produce when asked for one it cannot', async () => {
    const client = await connect();
    const result = (await client.callTool({
      name: 'download_assets',
      arguments: { nodeIds: [await pageId(client)], defaultFormat: 'jpg' },
    })) as AssetResult;
    expect(result.isError).toBe(true);
    const text = (result.content ?? []).map((item) => item.text ?? '').join('\n');
    expect(text).toMatch(/svg, png, pdf/);
  });
});
