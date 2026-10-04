import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FigmaImportError } from '../../src/figma/errors';
import { parseFigmaRest, parseFigmaRestFile, parseFigmaRestNodes, walkFigmaRest } from '../../src/figma/rest/parse';
import type { FigmaRestNode } from '../../src/figma/rest/types';

const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof FigmaImportError) return error.code;
    throw error;
  }
  throw new Error('expected a FigmaImportError');
}

describe('REST parser', () => {
  it('parses a full file response and indexes every node', () => {
    const source = parseFigmaRestFile(json('rest-file.json'));
    expect(source.kind).toBe('rest');
    expect(source.name).toBe('Pigma Import Fixture');
    expect(source.fileKey).toBe('FILEKEY123');
    expect(source.lastModified).toBe('2026-09-30T12:00:00Z');
    expect(source.roots).toHaveLength(1);
    expect(source.roots[0]?.type).toBe('DOCUMENT');
    expect(source.nodeMap.size).toBe(14);
    expect(source.nodeMap.get('1:3')?.name).toBe('Title');
    expect(source.components['2:1']?.key).toBe('ck-button');
    expect(source.styles['S:1']?.styleType).toBe('FILL');
    expect(source.raw).toStrictEqual(json('rest-file.json'));
  });

  it('parses a nodes response into detached roots', () => {
    const source = parseFigmaRestNodes(json('rest-nodes.json'));
    expect(source.roots).toHaveLength(1);
    expect(source.roots[0]?.id).toBe('1:2');
    expect(source.nodeMap.size).toBe(2);
  });

  it('auto-detects the response shape', () => {
    expect(parseFigmaRest(json('rest-file.json')).roots[0]?.type).toBe('DOCUMENT');
    expect(parseFigmaRest(json('rest-nodes.json')).roots[0]?.id).toBe('1:2');
  });

  it('walks the tree in document order', () => {
    const source = parseFigmaRestFile(json('rest-file.json'));
    const visited: string[] = [];
    walkFigmaRest(source.roots[0] as FigmaRestNode, (node) => visited.push(node.id));
    expect(visited[0]).toBe('0:0');
    expect(visited).toContain('1:2');
    expect(visited.indexOf('1:2')).toBeLessThan(visited.indexOf('1:3'));
  });

  it('rejects cyclic documents', () => {
    const cyclic = {
      document: {
        id: '0:0',
        type: 'DOCUMENT',
        children: [{ id: '0:1', type: 'CANVAS', children: [{ id: '0:0', type: 'FRAME', children: [] }] }],
      },
    };
    expect(codeOf(() => parseFigmaRestFile(cyclic))).toBe('CYCLE');
  });

  it('rejects duplicate node ids', () => {
    const duplicate = {
      document: {
        id: '0:0',
        type: 'DOCUMENT',
        children: [
          { id: '0:1', type: 'CANVAS', children: [] },
          { id: '0:1', type: 'CANVAS', children: [] },
        ],
      },
    };
    expect(codeOf(() => parseFigmaRestFile(duplicate))).toBe('DUPLICATE_ID');
  });

  it('rejects nodes without id or type', () => {
    const missing = { document: { id: '0:0', type: 'DOCUMENT', children: [{ name: 'no id' }] } };
    expect(codeOf(() => parseFigmaRestFile(missing))).toBe('MISSING_FIELD');
    const noType = { document: { id: '0:0', type: 'DOCUMENT', children: [{ id: '0:1' }] } };
    expect(codeOf(() => parseFigmaRestFile(noType))).toBe('MISSING_FIELD');
  });

  it('rejects non-array children', () => {
    const bad = { document: { id: '0:0', type: 'DOCUMENT', children: { id: '0:1' } } };
    expect(codeOf(() => parseFigmaRestFile(bad))).toBe('INVALID_DOCUMENT');
  });

  it('rejects unrecognized payloads', () => {
    expect(codeOf(() => parseFigmaRest({ foo: 1 }))).toBe('INVALID_INPUT');
    expect(codeOf(() => parseFigmaRestFile('nope'))).toBe('INVALID_INPUT');
  });
});
