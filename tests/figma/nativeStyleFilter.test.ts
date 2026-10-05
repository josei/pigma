/**
 * THE ONE STYLE FILTER.
 *
 * On the wire a style IS a node entry with `styleType` set (observed in real
 * files: FILL styles are ROUNDED_RECTANGLE swatches, a GRID style is a FRAME,
 * all on the hidden "Internal Only Canvas"). Recognising them at the import
 * boundary means a style never enters the tree — so the layers panel, hit
 * testing, z-order, the MCP enumeration and export need no filter of their own.
 */
import { describe, expect, it } from 'vitest';
import { figDocumentToPigmaFile } from '../../src/figma/convert/convert';
import type { FigDocument } from '../../src/figma/native/parse';

const NOW = 1_700_000_000_000;

/** A minimal native document: a page, a real frame, and a FILL style swatch. */
function nativeDoc(): FigDocument {
  const guid = (localID: number) => ({ sessionID: 0, localID });
  const doc = {
    header: { prelude: 'fig-kiwi', version: 1 },
    meta: { file_name: 'Style filter' },
    images: new Map(),
    nodes: [
      { guid: guid(1), phase: 'CREATED', type: 'DOCUMENT', name: 'Document', visible: true },
      { guid: guid(2), phase: 'CREATED', type: 'CANVAS', name: 'Page 1', visible: true, parentIndex: { guid: guid(1), position: '!' } },
      {
        guid: guid(3), phase: 'CREATED', type: 'FRAME', name: 'Hero', visible: true,
        parentIndex: { guid: guid(2), position: '!' },
        size: { x: 100, y: 100 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      },
      // The style swatch: a node entry with styleType set.
      {
        guid: guid(4), phase: 'CREATED', type: 'ROUNDED_RECTANGLE', name: 'Brand/01', visible: true,
        parentIndex: { guid: guid(2), position: '"' },
        styleType: 'FILL',
        size: { x: 100, y: 100 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        fillPaints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, blendMode: 'NORMAL' }],
      },
    ],
  };
  const childrenMap = new Map<string, unknown[]>([
    ['0:1', [doc.nodes[1]]],
    ['0:2', [doc.nodes[2], doc.nodes[3]]],
  ]);
  return {
    ...doc,
    childrenMap,
    message: { type: 'NODE_CHANGES', nodeChanges: doc.nodes },
  } as unknown as FigDocument;
}

describe('native style entries become table rows, never layers', () => {
  it('puts a styleType entry in the table and keeps it out of the tree', () => {
    const { file } = figDocumentToPigmaFile(nativeDoc(), { now: () => NOW });
    const styles = Object.values(file.styles ?? {});
    expect(styles).toHaveLength(1);
    expect(styles[0]?.name).toBe('Brand/01');
    expect(styles[0]?.type).toBe('FILL');
    expect(styles[0]?.guid).toBe('0:4');
    expect(styles[0]?.paints).toHaveLength(1);

    // NOT a layer: it is nowhere in the page's children.
    const page = file.document.children[0]!;
    const names: string[] = [];
    const walk = (node: { name: string; children?: unknown[] }): void => {
      names.push(node.name);
      for (const child of (node.children ?? []) as Array<{ name: string; children?: unknown[] }>) walk(child);
    };
    for (const child of page.children) walk(child as { name: string; children?: unknown[] });
    expect(names).toContain('Hero');
    expect(names, 'the style leaked into the layer tree').not.toContain('Brand/01');
  });
});
