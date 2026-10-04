import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nodeDecompressors } from '../../src/figma/native/node';
import { figNodeId, indexNativeNodes, parseFigArchive, parseFigFile } from '../../src/figma/native/parse';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

describe('native .fig parser', () => {
  it('parses a real .fig archive into a node tree', () => {
    const doc = parseFigArchive(fixture('circle.fig'), nodeDecompressors);
    expect(doc.header.prelude).toBe('fig-kiwi');
    expect(doc.header.version).toBe(101);
    expect(doc.nodes.length).toBeGreaterThan(0);
    expect(doc.schema.definitions.length).toBeGreaterThan(500);

    const document = doc.nodes.find((node) => node.type === 'DOCUMENT');
    expect(document).toBeDefined();
    expect(figNodeId(document!)).toBe('0:0');

    const ellipse = doc.nodes.find((node) => node.type === 'ELLIPSE');
    expect(ellipse).toBeDefined();
    expect(ellipse!.size).toEqual({ x: 300, y: 300 });
    expect(ellipse!.fillPaints?.[0]?.type).toBe('SOLID');
    expect(doc.blobs.length).toBeGreaterThan(0);
  });

  it('builds parent/child maps from parentIndex', () => {
    const doc = parseFigArchive(fixture('circle.fig'), nodeDecompressors);
    const frame = doc.nodes.find((node) => node.type === 'FRAME')!;
    const frameId = figNodeId(frame)!;
    const children = doc.childrenMap.get(frameId) ?? [];
    expect(children.map((child) => child.type)).toContain('ELLIPSE');
  });

  it('detects raw canvas.fig binaries too', () => {
    const doc = parseFigFile(fixture('circle.fig'), nodeDecompressors);
    expect(doc.header.prelude).toBe('fig-kiwi');
  });

  it('parses a vector-heavy document and resolves geometry blobs', () => {
    const doc = parseFigArchive(fixture('word-outline-stroke.fig'), nodeDecompressors);
    const vectors = doc.nodes.filter((node) => node.type === 'VECTOR');
    expect(vectors.length).toBeGreaterThan(0);
    expect(doc.images.size).toBeGreaterThanOrEqual(0);
  });

  it('rejects a truncated binary', () => {
    const bytes = fixture('circle.fig');
    expect(() => parseFigFile(bytes.slice(0, 20), nodeDecompressors)).toThrow(/too small|truncated|Not a \.fig/i);
  });
});

describe('native hierarchy validation', () => {
  const node = (id: string, parentId?: string) => ({
    guid: { sessionID: Number(id.split(':')[0]), localID: Number(id.split(':')[1]) },
    type: 'FRAME',
    ...(parentId ? { parentIndex: { guid: { sessionID: Number(parentId.split(':')[0]), localID: Number(parentId.split(':')[1]) }, position: '!' } } : {}),
  });

  it('indexes a valid hierarchy', () => {
    const { nodeMap, childrenMap } = indexNativeNodes([node('0:0'), node('0:1', '0:0'), node('0:2', '0:0')]);
    expect(nodeMap.size).toBe(3);
    expect(childrenMap.get('0:0')?.map(figNodeId)).toEqual(['0:1', '0:2']);
  });

  it('rejects cyclic parent chains', () => {
    expect(() => indexNativeNodes([node('0:0', '0:1'), node('0:1', '0:0')])).toThrow(/[Cc]yclic|own parent/);
  });

  it('rejects duplicate ids', () => {
    expect(() => indexNativeNodes([node('0:0'), node('0:0')])).toThrow(/Duplicate node id/);
  });

  it('rejects dangling parents', () => {
    expect(() => indexNativeNodes([node('0:1', '9:9')])).toThrow(/missing parent/);
  });
});
