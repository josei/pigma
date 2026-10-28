import { describe, expect, it } from 'vitest';
import { emptyFile, validatePigmaFile } from './validate';
import { parseFile, safeFileName, serializeFile, stableStringify } from './serialize';
import { createFrameNode, createRectNode, createTextNode } from './factory';
import type { PigmaFile, SceneNode } from './types';
import { hasChildren } from './types';

function fileWithRaw(): PigmaFile {
  const file = emptyFile('Raw');
  const page = file.document.children[0]!;
  const frame = createFrameNode(null, 0, 0, 200, 200, { name: 'Frame' });
  const rect = createRectNode(null, 10, 10, 50, 50);
  rect.raw = { figmaStyleId: 'S:1', unknownField: { nested: [1, 2, 3] } };
  const text = createTextNode(null, 0, 0, 'Hello');
  frame.children = [rect, text];
  page.children = [frame];
  return file;
}

describe('serialization and validation', () => {
  it('round-trips a document byte-for-byte', () => {
    const file = fileWithRaw();
    const json = serializeFile(file);
    const result = parseFile(json);
    expect(result.ok).toBe(true);
    expect(serializeFile(result.file!)).toBe(json);
  });

  it('keeps a miter limit through a save and a load, and drops the default of 4', () => {
    const file = emptyFile('Miter');
    const sharp = createRectNode(null, 0, 0, 40, 40);
    sharp.strokeJoin = 'MITER';
    sharp.strokeMiterLimit = 1.5;
    const plain = createRectNode(null, 50, 0, 40, 40);
    plain.strokeMiterLimit = 4;
    file.document.children[0]!.children = [sharp, plain];
    const restored = parseFile(serializeFile(file)).file!.document.children[0]!.children as Array<SceneNode & { strokeMiterLimit?: number }>;
    expect(restored[0]!.strokeMiterLimit).toBe(1.5);
    expect(restored[1]!.strokeMiterLimit).toBeUndefined();
  });

  it('keeps a dash offset through a save and a load, and drops a zero offset', () => {
    const file = emptyFile('Dash');
    const rect = createRectNode(null, 0, 0, 40, 40);
    rect.dashPattern = [8, 4];
    rect.dashOffset = 3;
    const zero = createRectNode(null, 50, 0, 40, 40);
    zero.dashPattern = [8, 4];
    zero.dashOffset = 0;
    file.document.children[0]!.children = [rect, zero];
    const restored = parseFile(serializeFile(file)).file!.document.children[0]!.children as Array<SceneNode & { dashOffset?: number }>;
    expect(restored[0]!.dashOffset).toBe(3);
    expect(restored[1]!.dashOffset).toBeUndefined();
  });

  it('preserves unsupported Figma fields through a round trip', () => {
    const json = serializeFile(fileWithRaw());
    const result = parseFile(json);
    const frame = result.file!.document.children[0]!.children[0]!;
    if (!hasChildren(frame)) throw new Error('expected the frame container');
    const rect = frame.children[0] as SceneNode;
    expect(rect.raw).toEqual({ figmaStyleId: 'S:1', unknownField: { nested: [1, 2, 3] } });
  });

  it('keeps unknown node fields in raw and warns about them', () => {
    const payload = {
      schema: 'pigma/1',
      name: 'Unknown fields',
      document: {
        id: '0:0',
        type: 'DOCUMENT',
        children: [
          {
            id: '1:0',
            type: 'CANVAS',
            name: 'Page',
            children: [{ id: '1:1', type: 'RECTANGLE', name: 'R', width: 10, height: 10, figmaOnly: true }],
          },
        ],
      },
    };
    const result = validatePigmaFile(payload);
    expect(result.ok).toBe(true);
    expect(result.file!.document.children[0]!.children[0]!.raw).toEqual({ figmaOnly: true });
    expect(result.warnings.join(' ')).toContain('preserved 1 unrecognized field');
  });

  it('normalizes Figma relativeTransform matrices', () => {
    const payload = {
      document: {
        id: '0:0',
        type: 'DOCUMENT',
        children: [
          {
            id: '1:0',
            type: 'CANVAS',
            name: 'Page',
            children: [
              {
                id: '1:1',
                type: 'RECTANGLE',
                name: 'R',
                width: 10,
                height: 10,
                relativeTransform: [
                  [0, -1, 25],
                  [1, 0, 40],
                ],
                transform: [
                  [0, -1, 25],
                  [1, 0, 40],
                ],
              },
            ],
          },
        ],
      },
    };
    const result = validatePigmaFile(payload);
    const node = result.file!.document.children[0]!.children[0]!;
    expect(node.transform).toEqual({ a: 0, b: 1, c: -1, d: 0, tx: 25, ty: 40 });
  });

  it('fills defaults for missing optional fields', () => {
    const payload = {
      document: {
        id: '0:0',
        type: 'DOCUMENT',
        children: [{ id: '1:0', type: 'CANVAS', name: 'Page', children: [{ id: '1:1', type: 'TEXT', characters: 'Hi' }] }],
      },
    };
    const result = validatePigmaFile(payload);
    const text = result.file!.document.children[0]!.children[0]!;
    expect(text.visible).toBe(true);
    expect(text.locked).toBe(false);
    expect(text.opacity).toBe(1);
    if (text.type === 'TEXT') expect(text.style.fontSize).toBe(14);
    expect(text.fills).toEqual([]);
  });

  it('rejects structurally broken documents', () => {
    expect(validatePigmaFile(null).ok).toBe(false);
    expect(validatePigmaFile({}).errors[0]).toContain('document');
    expect(validatePigmaFile({ document: { type: 'DOCUMENT', children: [] } }).errors[0]).toContain('no CANVAS pages');
    const notCanvas = validatePigmaFile({ document: { type: 'DOCUMENT', children: [{ type: 'FRAME', id: '9:9' }] } });
    expect(notCanvas.ok).toBe(false);
    expect(notCanvas.warnings.join(' ')).toContain('not a CANVAS node');
  });

  it('reports duplicate ids without failing the import', () => {
    const payload = {
      document: {
        id: '0:0',
        type: 'DOCUMENT',
        children: [
          {
            id: '1:0',
            type: 'CANVAS',
            name: 'Page',
            children: [
              { id: '1:1', type: 'RECTANGLE', width: 1, height: 1 },
              { id: '1:1', type: 'RECTANGLE', width: 1, height: 1 },
            ],
          },
        ],
      },
    };
    const result = validatePigmaFile(payload);
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toContain('duplicate node id');
  });

  it('reports JSON syntax errors instead of throwing', () => {
    const result = parseFile('{ not json');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('invalid JSON');
  });

  it('validates its own empty file and stable stringify is deterministic', () => {
    const file = emptyFile('Empty');
    expect(validatePigmaFile(JSON.parse(serializeFile(file))).ok).toBe(true);
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('builds filesystem-safe download names', () => {
    expect(safeFileName('My Design!', 'json')).toBe('My-Design.json');
    expect(safeFileName('   ', 'svg')).toBe('pigma.svg');
  });

  it('generates ids that cannot collide with imported ones', () => {
    const payload = {
      document: {
        id: '0:0',
        type: 'DOCUMENT',
        children: [{ id: 'ab12:900', type: 'CANVAS', name: 'Page', children: [] }],
      },
    };
    const result = validatePigmaFile(payload);
    expect(result.ok).toBe(true);
    const fresh = createRectNode(null, 0, 0, 1, 1);
    expect(fresh.id).not.toBe('ab12:900');
    expect(Number(fresh.id.split(':')[1])).toBeGreaterThan(900);
  });
});
