import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import type { PigmaFile, SceneNode } from '../../src/model/types';
import { findNode } from '../../src/model/tree';
import { createMcpServer, type McpServer } from '../../src/mcp/protocol';
import { nodeRasterizer } from '../../src/mcp/raster.node';
import { createSession } from '../../src/mcp/session';

const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../figma/fixtures/${name}`, import.meta.url)), 'utf8'));

function build(): { server: McpServer; session: ReturnType<typeof createSession>; file: PigmaFile } {
  const { file } = figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 });
  const session = createSession(file);
  return { server: createMcpServer({ session, rasterizer: nodeRasterizer }), session, file };
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const response = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  if (!response || !('result' in response)) throw new Error('expected a result');
  return response.result as {
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  };
}

describe('platform tools', () => {
  it('whoami reports an explicit capability result', async () => {
    const { server } = build();
    const result = await callTool(server, 'whoami');
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ supported: false, capability: 'whoami' });
    expect(String(result.structuredContent?.reason)).toMatch(/no accounts/i);
  });

  it('generate_pigma_design reports the missing capture backend', async () => {
    const { server } = build();
    const result = await callTool(server, 'generate_pigma_design', { url: 'https://example.com' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ supported: false, capability: 'generate_pigma_design' });
    expect(result.structuredContent?.alternatives).toContain('use_pigma (create layers programmatically)');
  });

  it('generate_diagram builds a Mermaid flowchart into the document', async () => {
    const { server, session } = build();
    const result = await callTool(server, 'generate_diagram', {
      mermaid: 'graph LR\n  A[Start] --> B{Choice}\n  B -->|yes| C[Done]\n  B --> D[Other]',
    });
    expect(result.isError).toBeFalsy();
    const created = (result.structuredContent?.created as string[]) ?? [];
    expect(created.length).toBeGreaterThanOrEqual(6); // 4 nodes + 3 edges
    const doc = session.getFile()?.document ?? build().file.document;
    const names = created.map((id) => findNode(doc, id)?.name);
    expect(names).toEqual(expect.arrayContaining(['Start', 'Choice', 'Done', 'Other']));
    const edge = created.map((id) => findNode(doc, id)).find((node) => node?.type === 'LINE') as SceneNode | undefined;
    expect(edge).toBeDefined();
    expect(edge?.strokeCap).toBe('ARROW_LINES');
  });

  it('generate_diagram reports natural language and non-flowchart input as unsupported', async () => {
    const { server } = build();
    const natural = await callTool(server, 'generate_diagram', { description: 'a login flow' });
    expect(natural.isError).toBe(true);
    expect(String(natural.structuredContent?.reason)).toMatch(/Mermaid/i);

    const sequence = await callTool(server, 'generate_diagram', { mermaid: 'sequenceDiagram\n  A->>B: hi' });
    expect(sequence.isError).toBe(true);
    expect(String(sequence.content[0]?.text)).toMatch(/flowchart/i);
  });

  it('generate_diagram notes ignored directives instead of silently dropping them', async () => {
    const { server } = build();
    const result = await callTool(server, 'generate_diagram', {
      mermaid: 'graph TD\n  A[A] --> B[B]\n  classDef red fill:#f00\n  class A red',
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.ignored).toEqual(expect.arrayContaining(['classDef', 'class']));
  });

  it('get_figjam returns an outline with screenshots and honest capabilities', async () => {
    const { server } = build();
    const result = await callTool(server, 'get_figjam', { nodeId: '1:2' });
    expect(result.isError).toBeFalsy();
    const text = result.content.find((entry) => entry.type === 'text')?.text ?? '';
    expect(text).toContain('id="1:2"');
    const images = result.content.filter((entry) => entry.type === 'image');
    expect(images.length).toBeGreaterThan(0);
    expect(images[0]?.mimeType).toBe('image/png');
    expect(result.structuredContent?.capabilities).toMatchObject({ xmlOutline: true, screenshots: true, figjamSemantics: false });
  });

  it('registers the generative and shader surface with honest capability results', async () => {
    const { server } = build();
    const generative = [
      'list_generative_plugins',
      'get_generative_plugin',
      'create_generative_plugin',
      'update_generative_plugin',
      'list_shaders',
      'list_file_shaders',
      'get_shader',
      'create_shader',
      'update_shader',
    ];
    const tools = server.tools.map((tool) => tool.definition.name);
    for (const name of generative) expect(tools).toContain(name);

    for (const name of generative) {
      const result = await callTool(server, name);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ supported: false, capability: name });
      expect(String(result.structuredContent?.reason)).toMatch(/account library|shader/i);
      expect(result.structuredContent?.alternatives).toContain('use_pigma (run a plugin script against the open document)');
    }
  });

  it('get_libraries reports remote libraries as unsupported rather than inventing them', async () => {
    const { server } = build();
    const result = await callTool(server, 'get_libraries', { includeRemote: true });
    expect(result.structuredContent).toMatchObject({ available: [], remoteSupported: false });
    expect(String(result.structuredContent?.note)).toMatch(/Figma cloud/i);
  });
});
