import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import { useEditor } from '../../src/store/editorStore';
import { createEditorSession } from '../../src/mcp/bridge';
import { createMcpServer, type McpServer } from '../../src/mcp/protocol';
import { nodeRasterizer } from '../../src/mcp/raster.node';
import type { PigmaFile } from '../../src/model/types';
import { findNode } from '../../src/model/tree';
import { hasChildren } from '../../src/model/types';

const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../figma/fixtures/${name}`, import.meta.url)), 'utf8'));

const imported: PigmaFile = figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 }).file;

/** The editor store is a module singleton: restore it after each test. */
let snapshot: ReturnType<typeof useEditor.getState> | null = null;

function loadImported(): void {
  if (!snapshot) snapshot = useEditor.getState();
  useEditor.getState().loadFile(imported);
}

afterEach(() => {
  if (snapshot) {
    useEditor.setState(snapshot, true);
    snapshot = null;
  }
});

function call(server: McpServer, method: string, params?: unknown) {
  return server.handle({ jsonrpc: '2.0', id: 1, method, params });
}

describe('live editor bridge', () => {
  it('sizes text through use_pigma, the reported gap', async () => {
    loadImported();
    const server = createMcpServer({ session: createEditorSession(useEditor), rasterizer: nodeRasterizer });
    const tool = (code: string) => call(server, 'tools/call', { name: 'use_pigma', arguments: { code } });
    const output = (response: unknown) =>
      response && typeof response === 'object' && 'result' in response
        ? (response.result as { structuredContent: { output: string } }).structuredContent.output
        : '';

    // The exact script that used to fail: create text, then size it.
    const created = await tool(
      [
        "const text = figma.createText({ characters: 'Sized through MCP' });",
        'text.fontSize = 20;',
        "text.fontName = { family: 'Roboto', style: 'Bold' };",
        "text.letterSpacing = { unit: 'PIXELS', value: 2 };",
        "text.lineHeight = { unit: 'PERCENT', value: 150 };",
        "text.textAlignHorizontal = 'CENTER';",
        'text.id;',
      ].join('\n'),
    );
    const id = output(created);
    expect(id, 'the script did not report a node id').not.toBe('');

    // Read it back through the API, and from the live document.
    const read = await tool(`figma.getNodeById(${JSON.stringify(id)}).fontSize;`);
    expect(read === null ? null : output(read), 'fontSize did not round-trip through the MCP tool').toBe(20);
    const node = findNode(useEditor.getState().file.document, id);
    expect(node?.type).toBe('TEXT');
    if (node?.type !== 'TEXT') throw new Error('the created node is not TEXT');
    expect(node.style.fontSize).toBe(20);
    expect(node.style.fontFamily).toBe('Roboto');
    expect(node.style.fontStyle).toBe('Bold');
    expect(node.style.letterSpacing).toEqual({ unit: 'PIXELS', value: 2 });
    expect(node.style.lineHeight).toEqual({ unit: 'PERCENT', value: 150 });
    expect(node.style.textAlignHorizontal).toBe('CENTER');
  });

  it('does not run a failing script twice, through the MCP tool', async () => {
    loadImported();
    const server = createMcpServer({ session: createEditorSession(useEditor), rasterizer: nodeRasterizer });
    const before = useEditor.getState().file.document.children[0]!;
    const childrenBefore = hasChildren(before) ? before.children.length : 0;

    // A runtime SyntaxError after a side effect: the script compiles, so it must
    // not be retried, and the failing run must leave the document alone.
    const response = await call(server, 'tools/call', {
      name: 'use_pigma',
      arguments: { code: "figma.createFrame({ name: 'Once' });\nthrow new SyntaxError('boom');" },
    });
    const text = JSON.stringify(response);
    expect(text, 'the runtime error should be reported').toContain('boom');
    expect(text, 'it is not a syntax error').not.toContain('not valid JavaScript');
    const after = useEditor.getState().file.document.children[0]!;
    const frames = (hasChildren(after) ? after.children : []).filter((child) => child.name === 'Once');
    expect(frames, 'the failing script was applied to the document').toHaveLength(0);
    expect(hasChildren(after) ? after.children.length : 0, 'the document changed').toBe(childrenBefore);
  });

  it('reads and writes the real editor store through MCP', async () => {
    loadImported();
    const server = createMcpServer({ session: createEditorSession(useEditor), rasterizer: nodeRasterizer });

    // Reads reflect the live document.
    const metadata = await call(server, 'tools/call', { name: 'get_metadata', arguments: { nodeId: '1:2' } });
    const result = metadata && 'result' in metadata ? (metadata.result as { structuredContent?: unknown }) : null;
    expect(result?.structuredContent).toBeTruthy();

    // Writes land on the live store and its undo history.
    const historyBefore = useEditor.getState().past.length;
    const created = await call(server, 'tools/call', {
      name: 'use_pigma',
      arguments: { operations: [{ call: 'figma.createRectangle', args: { x: 5, y: 5, width: 30, height: 30, name: 'From MCP' } }] },
    });
    const payload = created && 'result' in created ? (created.result as { structuredContent: { results: Array<{ nodeId: string }> } }) : null;
    const nodeId = payload?.structuredContent.results[0]?.nodeId;
    expect(nodeId).toBeTruthy();

    const state = useEditor.getState();
    const page = state.file.document.children[0];
    expect(page && hasChildren(page) ? page.children.some((child) => child.id === nodeId) : false).toBe(true);
    expect(state.past.length).toBeGreaterThan(historyBefore);

    // Selection is driven through the store's own select action.
    await call(server, 'tools/call', {
      name: 'use_pigma',
      arguments: { operations: [{ call: 'figma.currentPage.selection', args: { nodeIds: [nodeId] } }] },
    });
    expect(useEditor.getState().selection).toEqual([nodeId]);

    // The edit is a normal editor action: undo restores the previous document.
    useEditor.getState().undo();
    const afterUndo = useEditor.getState();
    const undonePage = afterUndo.file.document.children[0];
    expect(undonePage && hasChildren(undonePage) ? undonePage.children.some((child) => child.id === nodeId) : false).toBe(false);
  });

  it('generates design context from the live document', async () => {
    loadImported();
    const server = createMcpServer({ session: createEditorSession(useEditor), rasterizer: nodeRasterizer });
    const response = await call(server, 'tools/call', { name: 'get_design_context', arguments: { nodeId: '1:3' } });
    const result = response && 'result' in response ? (response.result as { content: Array<{ text: string }> }) : null;
    expect(result?.content[0]?.text).toContain('export function');

    const node = findNode(useEditor.getState().file.document, '1:3');
    expect(node).toBeTruthy();
  });
});
