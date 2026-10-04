import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import { createMcpServer, type McpServer } from '../../src/mcp/protocol';
import { createSession } from '../../src/mcp/session';

const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../figma/fixtures/${name}`, import.meta.url)), 'utf8'));

function build(): { server: McpServer; session: ReturnType<typeof createSession> } {
  const { file } = figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 });
  const session = createSession(file);
  return { server: createMcpServer({ session }), session };
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const response = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  if (!response || !('result' in response)) throw new Error('expected a result');
  return response.result as { structuredContent?: Record<string, unknown>; isError?: boolean; content: Array<{ text: string }> };
}

describe('Code Connect mapping tools', () => {
  it('adds a mapping and reads it back', async () => {
    const { server, session } = build();
    const added = await callTool(server, 'add_code_connect_map', {
      nodeId: '1:9',
      componentName: 'Button',
      source: 'src/components/Button.tsx',
      label: 'React',
      version: 'Code Connect CLI',
    });
    expect(added.isError).toBeFalsy();
    expect((added.structuredContent?.map as Record<string, { componentName: string }>)['1:9']?.componentName).toBe('Button');

    // Persisted in the document metadata, not just the response.
    expect((session.getFile()?.meta?.codeConnect as Record<string, unknown> | undefined)?.['1:9']).toBeDefined();

    const read = await callTool(server, 'get_code_connect_map', { nodeId: '1:9' });
    expect((read.structuredContent?.map as Record<string, { source: string }>)['1:9']?.source).toBe('src/components/Button.tsx');
  });

  it('confirms a batch of mappings', async () => {
    const { server } = build();
    const sent = await callTool(server, 'send_code_connect_mappings', {
      mappings: [
        { nodeId: '1:9', componentName: 'Button', source: 'src/Button.tsx' },
        { nodeId: '1:12', componentName: 'Card', source: 'src/Card.tsx', label: 'React' },
      ],
    });
    expect(sent.isError).toBeFalsy();
    expect(sent.structuredContent?.confirmed).toBe(2);
    expect(Object.keys(sent.structuredContent?.map as Record<string, unknown>).sort()).toEqual(['1:12', '1:9']);
  });

  it('get_context_for_code_connect returns property definitions and descendants', async () => {
    const { server } = build();
    const context = await callTool(server, 'get_context_for_code_connect', { nodeId: '1:11' });
    expect(context.isError).toBeFalsy();
    const structured = context.structuredContent as {
      propertyDefinitions: Record<string, unknown>;
      descendants: Array<{ id: string; type: string }>;
    };
    expect(structured.propertyDefinitions).toMatchObject({ state: { type: 'VARIANT' } });
    expect(structured.descendants.map((entry) => entry.id)).toContain('1:12');
  });

  it('get_context_for_code_connect rejects non-component nodes', async () => {
    const { server } = build();
    const context = await callTool(server, 'get_context_for_code_connect', { nodeId: '9:9' });
    expect(context.isError).toBe(true);
  });

  it('get_code_connect_suggestions never fabricates a source path', async () => {
    const { server } = build();
    const suggestions = await callTool(server, 'get_code_connect_suggestions', { nodeId: '1:11' });
    expect(suggestions.isError).toBeFalsy();
    const list = (suggestions.structuredContent?.suggestions as Array<Record<string, unknown>>) ?? [];
    expect(list[0]).toMatchObject({ nodeId: '1:11', mapped: false, source: null });
    expect(list[0]?.variantOptions).toEqual([{ property: 'state', options: ['default', 'hover'] }]);
    expect(suggestions.structuredContent?.requiresCodebase).toBe(true);
  });

  it('get_code_connect_suggestions reflects an existing mapping', async () => {
    const { server } = build();
    await callTool(server, 'add_code_connect_map', { nodeId: '1:11', componentName: 'Button', source: 'src/Button.tsx' });
    const suggestions = await callTool(server, 'get_code_connect_suggestions', { nodeId: '1:11' });
    const list = (suggestions.structuredContent?.suggestions as Array<Record<string, unknown>>) ?? [];
    expect(list[0]?.mapped).toBe(true);
    expect((list[0]?.currentMapping as { source: string }).source).toBe('src/Button.tsx');
  });

  it('rejects mappings for unknown nodes and missing fields', async () => {
    const { server } = build();
    const unknown = await callTool(server, 'add_code_connect_map', { nodeId: '9:9', componentName: 'X', source: 'x.tsx' });
    expect(unknown.isError).toBe(true);

    const missing = await callTool(server, 'add_code_connect_map', { nodeId: '1:9' });
    expect(missing.isError).toBe(true);
  });
});
