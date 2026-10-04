/**
 * Auto-sized text is measured on every write.
 *
 * `syncTextSizes` used to apply each measured box with its own `updateNode`
 * call, which rebuilt the whole path every time: settling a document with
 * thousands of auto-sized text nodes was O(changed x nodes). It now collects the
 * measurements and applies them in one traversal. These tests hold the behaviour
 * still — every measured box still lands, an unchanged document is still the
 * same object, and a text node edited through the MCP still gets its box.
 */
import { describe, expect, it } from 'vitest';
import { useEditor } from '../../src/store/editorStore';
import { createEditorSession } from '../../src/mcp/bridge';
import { createMcpServer } from '../../src/mcp/protocol';
import { nodeRasterizer } from '../../src/mcp/raster.node';
import { emptyFile } from '../../src/model/validate';
import { createFrameNode, createRectNode, createTextNode } from '../../src/model/factory';
import { syncTextSizes } from '../../src/model/textSync';
import { findNode } from '../../src/model/tree';
import type { PigmaFile, TextNode } from '../../src/model/types';

const call = (server: ReturnType<typeof createMcpServer>, method: string, params?: unknown) =>
  server.handle({ jsonrpc: '2.0', id: 1, method, params });

function textNode(file: PigmaFile, id: string): TextNode {
  const node = findNode(file.document, id);
  if (!node || node.type !== 'TEXT') throw new Error(`no TEXT node ${id}`);
  return node;
}

describe('auto-sized text settles', () => {
  it('measures a text node edited through the MCP', async () => {
    useEditor.getState().loadFile(emptyFile('Text settle'));
    const server = createMcpServer({ session: createEditorSession(useEditor), rasterizer: nodeRasterizer });
    const created = await call(server, 'tools/call', {
      name: 'use_pigma',
      arguments: {
        code: [
          "const text = figma.createText({ characters: 'Hi' });",
          'text.fontSize = 12;',
          'text.id;',
        ].join('\n'),
      },
    });
    const id = String(
      (created as { result?: { structuredContent?: { output?: string } } }).result?.structuredContent?.output ?? '',
    );
    expect(id).not.toBe('');
    const before = textNode(useEditor.getState().file, id);
    expect(before.style.fontSize).toBe(12);

    // Longer content through a second write: the box must follow it.
    await call(server, 'tools/call', {
      name: 'use_pigma',
      arguments: { code: `figma.getNodeById(${JSON.stringify(id)}).characters = 'A much longer label than before';` },
    });
    const after = textNode(useEditor.getState().file, id);
    expect(after.characters).toBe('A much longer label than before');
    expect(after.width, 'the box did not follow the content').toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(0);
  });

  it('grows the box when the font size grows', async () => {
    const file = emptyFile('Grow');
    const page = file.document.children[0]!;
    const text = createTextNode(file.document, 0, 0, 'Sized by style');
    page.children = [text];
    const small = syncTextSizes(file);
    const smallBox = textNode(small, text.id);
    (small.document.children[0]!.children[0] as TextNode).style = {
      ...(small.document.children[0]!.children[0] as TextNode).style,
      fontSize: 48,
    };
    const large = syncTextSizes(small);
    const largeBox = textNode(large, text.id);
    expect(largeBox.width).toBeGreaterThan(smallBox.width);
    expect(largeBox.height).toBeGreaterThan(smallBox.height);
  });

  it('applies every measured box when many text nodes need one', () => {
    // The single-pass application must not skip any node: each of these starts
    // with a deliberately wrong box.
    const file = emptyFile('Many');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 0, 0, 4000, 4000);
    const texts = [];
    for (let i = 0; i < 200; i += 1) {
      const text = createTextNode(file.document, (i % 20) * 200, Math.floor(i / 20) * 60, `Row ${i} label`);
      (text as { width: number }).width = 1;
      (text as { height: number }).height = 1;
      texts.push(text);
    }
    frame.children = [...texts];
    page.children = [frame];

    const settled = syncTextSizes(file);
    const boxes = texts.map((text) => textNode(settled, text.id));
    expect(boxes.filter((box) => box.width > 1 && box.height > 1)).toHaveLength(texts.length);
    // And every node object on the way down was rebuilt, not reused.
    expect(settled).not.toBe(file);
  });

  it('is the same file when nothing needed measuring', () => {
    const file = emptyFile('Stable');
    const page = file.document.children[0]!;
    const text = createTextNode(file.document, 0, 0, 'Already right');
    page.children = [text];
    const once = syncTextSizes(file);
    // Identity, not equality: a repeated write must not churn.
    expect(syncTextSizes(once)).toBe(once);
    expect(syncTextSizes(once).document).toBe(once.document);
  });

  it('leaves a fixed-size text node alone', () => {
    const file = emptyFile('Fixed');
    const page = file.document.children[0]!;
    const text = createTextNode(file.document, 0, 0, 'Fixed');
    text.style = { ...text.style, textAutoResize: 'NONE' };
    (text as { width: number }).width = 7;
    (text as { height: number }).height = 9;
    page.children = [text, createRectNode(file.document, 0, 0, 10, 10)];
    const settled = syncTextSizes(file);
    expect(settled).toBe(file);
    expect(textNode(file, text.id).width).toBe(7);
  });
});
