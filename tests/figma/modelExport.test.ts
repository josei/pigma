import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figDocumentToPigmaFile, figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import { nodeDecompressors } from '../../src/figma/native/node';
import { nodeExportCompressors } from '../../src/figma/native/export.node';
import { encodeCommandsBlob, exportPigmaFile, pigmaToFigMessage } from '../../src/figma/native/modelExport';
import { parseFigArchive } from '../../src/figma/native/parse';
import { applyToPoint, fromMatrix } from '../../src/model/matrix';
import { findNode } from '../../src/model/tree';
import type { ContainerNode, GradientPaint, PigmaFile, ShapeNode, TextNode } from '../../src/model/types';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

function model(): PigmaFile {
  return figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 }).file;
}

/**
 * The native wire format has no COMPONENT_SET type (variant sets export as
 * SYMBOL and re-import as COMPONENT), so compare with that normalized.
 */
function normalizeType(type: string): string {
  return type === 'COMPONENT_SET' ? 'COMPONENT' : type;
}

function collect(root: PigmaFile['document']): Array<{ id: string; name: string; type: string; width: number; height: number }> {
  const out: Array<{ id: string; name: string; type: string; width: number; height: number }> = [];
  const walk = (node: { id: string; name: string; type: string; width: number; height: number } & { children?: unknown[] }): void => {
    out.push({ id: node.id, name: node.name, type: normalizeType(node.type), width: node.width, height: node.height });
    if (Array.isArray(node.children)) for (const child of node.children) walk(child as never);
  };
  for (const page of root.children) walk(page as never);
  return out;
}

describe('editor model -> native .fig export', () => {
  it('exports a Pigma file and re-imports the same structure', async () => {
    const source = model();
    const archive = await exportPigmaFile(source, {
      schemaFrom: fixture('circle.fig'),
      decompress: nodeDecompressors,
      compress: nodeExportCompressors,
    });

    const parsed = parseFigArchive(archive, nodeDecompressors);
    expect(parsed.header.prelude).toBe('fig-kiwi');
    const reimported = figDocumentToPigmaFile(parsed, { now: () => 1 }).file;

    // Ids, names, types, and sizes survive the round trip.
    expect(collect(reimported.document)).toEqual(collect(source.document));
  });

  it('preserves text, paints, auto-layout, and vector geometry', async () => {
    const source = model();
    const archive = await exportPigmaFile(source, {
      schemaFrom: fixture('circle.fig'),
      decompress: nodeDecompressors,
      compress: nodeExportCompressors,
    });
    const reimported = figDocumentToPigmaFile(parseFigArchive(archive, nodeDecompressors), { now: () => 1 }).file;

    const title = findNode(reimported.document, '1:3') as TextNode;
    expect(title.characters).toBe('Hello Pigma');
    expect(title.style.fontSize).toBe(24);
    expect(title.style.fontWeight).toBe(700);

    const hero = findNode(reimported.document, '1:2') as ContainerNode;
    expect(hero.autoLayout).toMatchObject({ layoutMode: 'VERTICAL', itemSpacing: 8, paddingLeft: 16 });
    expect(hero.clipsContent).toBe(true);

    const card = findNode(reimported.document, '1:4') as ShapeNode;
    expect(card.cornerRadius).toBe(12);
    const fill = card.fills[0];
    expect(fill?.type).toBe('SOLID');
    // Native colors are float32, so compare channels approximately.
    if (fill?.type === 'SOLID') {
      expect(fill.color.r).toBeCloseTo(0.9, 5);
      expect(fill.color.g).toBeCloseTo(0.3, 5);
      expect(fill.color.b).toBeCloseTo(0.1, 5);
    }

    const icon = findNode(reimported.document, '1:6') as ShapeNode;
    expect(icon.pathData).toBe('M0 0 L24 0 L24 24 Z');
  });

  it('round-trips gradient orientation through the native inverse transform', async () => {
    const source = model();
    const archive = await exportPigmaFile(source, {
      schemaFrom: fixture('circle.fig'),
      decompress: nodeDecompressors,
      compress: nodeExportCompressors,
    });
    const reimported = figDocumentToPigmaFile(parseFigArchive(archive, nodeDecompressors), { now: () => 1 }).file;
    const badge = findNode(reimported.document, '1:5') as ShapeNode;
    const fill = badge.fills[0] as GradientPaint;
    const matrix = fromMatrix(fill.gradientTransform as never);
    // The fixture's handles: start (0.5,0), end (0.5,1), width (1,0).
    const near = (actual: { x: number; y: number }, x: number, y: number) => {
      expect(actual.x).toBeCloseTo(x, 5);
      expect(actual.y).toBeCloseTo(y, 5);
    };
    near(applyToPoint(matrix, 0, 0.5), 0.5, 0);
    near(applyToPoint(matrix, 1, 0.5), 0.5, 1);
    near(applyToPoint(matrix, 0, 1), 1, 0);
  });

  it('reports geometry it cannot encode instead of dropping it silently', () => {
    const file = model();
    const icon = findNode(file.document, '1:6') as ShapeNode;
    icon.pathData = 'M0 0 Q 5 5 10 0'; // quadratic: unsupported by the encoder
    const { warnings } = pigmaToFigMessage(file, { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors });
    expect(warnings.some((line) => line.includes('1:6'))).toBe(true);
  });

  it('encodes supported SVG commands into a commands blob', () => {
    const blob = encodeCommandsBlob('M0 0 L24 0 L24 24 Z');
    expect(blob).toBeInstanceOf(Uint8Array);
    expect(blob?.[0]).toBe(0x01);
    expect(blob?.length).toBe(1 + 8 + 9 + 9 + 1); // moveTo(1+8), 2×lineTo(1+8), close(1)
    expect(encodeCommandsBlob('M0 0 A 5 5 0 0 1 10 10')).toBeNull();
  });

  it('places siblings in a lexicographically ordered position sequence', () => {
    const file = model();
    const { message } = pigmaToFigMessage(file, { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors });
    const changes = message.nodeChanges as Array<{ parentIndex?: { guid: { sessionID: number; localID: number }; position: string } }>;
    const heroGuid = { sessionID: 1, localID: 2 };
    const children = changes
      .filter((change) => change.parentIndex?.guid.sessionID === heroGuid.sessionID && change.parentIndex?.guid.localID === heroGuid.localID)
      .map((change) => change.parentIndex?.position ?? '');
    expect(children.length).toBeGreaterThan(1);
    expect([...children].sort()).toEqual(children);
  });
});
