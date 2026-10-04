import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nodeDecompressors } from '../../src/figma/native/node';
import { parseFigArchive } from '../../src/figma/native/parse';
import { figDocumentToPigmaFile, figmaRestToPigmaFile, toPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile, parseFigmaRestNodes } from '../../src/figma/rest/parse';
import { mapNativePaint } from '../../src/figma/convert/mappers';
import { ReportBuilder } from '../../src/figma/convert/report';
import { applyToPoint, fromMatrix } from '../../src/model/matrix';
import type {
  CanvasNode,
  ContainerNode,
  ShapeNode,
  TextNode,
  ComponentNode,
  InstanceNode,
  ParentNode,
  TransformMatrix,
} from '../../src/model/types';
import { hasChildren } from '../../src/model/types';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

const NOW = 1_700_000_000_000;

function convertRest(name = 'rest-file.json', options: Record<string, unknown> = {}) {
  return figmaRestToPigmaFile(parseFigmaRestFile(json(name)), { now: () => NOW, ...options });
}

function findChild(container: ParentNode, id: string) {
  return container.children.find((child) => child.id === id);
}

describe('REST conversion to the Pigma model', () => {
  it('produces a pigma/1 file with pages, ids, and source metadata', () => {
    const { file, report } = convertRest();
    expect(file.schema).toBe('pigma/1');
    expect(file.name).toBe('Pigma Import Fixture');
    expect(file.lastModified).toBe(Date.parse('2026-09-30T12:00:00Z'));
    expect(file.source?.kind).toBe('figma');
    expect(file.source?.fileKey).toBe('FILEKEY123');
    expect(file.source?.importedAt).toBe(NOW);
    expect(file.document.type).toBe('DOCUMENT');
    expect(file.document.children.map((page) => page.name)).toEqual(['Page 1', 'Internal Only Canvas']);
    expect(file.meta?.styles).toMatchObject({ 'S:1': { key: 'sk-brand' } });
    expect(report.rawPreserved).toBe(true);
    expect(report.counts.pages).toBe(2);
    expect(report.counts.byType.FRAME).toBe(1);
    expect(report.counts.byType.TEXT).toBe(1);
  });

  it('can skip the hidden internal canvas', () => {
    const { file, report } = convertRest('rest-file.json', { skipInternalCanvas: true });
    expect(file.document.children.map((page) => page.name)).toEqual(['Page 1']);
    expect(report.warnings.some((warning) => warning.includes('Internal Only Canvas'))).toBe(true);
  });

  it('keeps original hierarchy, ids, and the raw source object', () => {
    const input = json('rest-file.json') as {
      document: { children: Array<{ children: Array<{ id: string }> }> };
    };
    const { file } = figmaRestToPigmaFile(parseFigmaRestFile(input), { now: () => NOW });
    const page = file.document.children[0] as CanvasNode;
    const hero = findChild(page, '1:2') as ContainerNode;
    expect(hero.name).toBe('Hero');
    expect(hero.raw?.name).toBe('Hero');
    // `raw` is the exact source node object, not a copy.
    expect(hero.raw).toBe(input.document.children[0]?.children[0]);
    expect(hero.children.map((child) => child.id)).toEqual(['1:3', '1:4', '1:5', '1:6', '1:7', '1:13']);
  });

  it('maps frames, auto-layout, and clipping', () => {
    const { file } = convertRest();
    const hero = findChild(file.document.children[0] as CanvasNode, '1:2') as ContainerNode;
    expect(hero.type).toBe('FRAME');
    expect(hero.width).toBe(400);
    expect(hero.height).toBe(300);
    expect(hero.clipsContent).toBe(true);
    expect(hero.autoLayout).toMatchObject({ layoutMode: 'VERTICAL', itemSpacing: 8, paddingLeft: 16, paddingTop: 16 });
  });

  it('maps text content, style, and preserved runs', () => {
    const { file } = convertRest();
    const hero = findChild(file.document.children[0] as CanvasNode, '1:2') as ContainerNode;
    const title = findChild(hero, '1:3') as TextNode;
    expect(title.type).toBe('TEXT');
    expect(title.characters).toBe('Hello Pigma');
    expect(title.style.fontFamily).toBe('Inter');
    expect(title.style.fontSize).toBe(24);
    expect(title.style.fontWeight).toBe(700);
    expect(title.style.lineHeight).toEqual({ unit: 'PIXELS', value: 32 });
    expect(title.style.textAlignHorizontal).toBe('LEFT');
    expect(title.style.styleRuns).toHaveLength(1);
  });

  it('maps paints, strokes, effects, and constraints', () => {
    const { file } = convertRest();
    const hero = findChild(file.document.children[0] as CanvasNode, '1:2') as ContainerNode;
    const card = findChild(hero, '1:4') as ShapeNode;
    expect(card.cornerRadius).toBe(12);
    expect(card.rectangleCornerRadii).toEqual([12, 12, 0, 0]);
    expect(card.fills[0]).toMatchObject({ type: 'SOLID', color: { r: 0.9, g: 0.3, b: 0.1 } });
    expect(card.strokes).toHaveLength(1);
    expect(card.strokeWeight).toBe(2);
    expect(card.strokeAlign).toBe('INSIDE');
    expect(card.dashPattern).toEqual([4, 2]);
    expect(card.constraints).toEqual({ vertical: 'MIN', horizontal: 'MIN' });
    expect(card.effects?.[0]).toMatchObject({ type: 'DROP_SHADOW', radius: 8, offset: { x: 0, y: 4 } });
  });

  it('converts gradient handles into a renderer-facing transform', () => {
    const { file, report } = convertRest();
    const hero = findChild(file.document.children[0] as CanvasNode, '1:2') as ContainerNode;
    const badge = findChild(hero, '1:5') as ShapeNode;
    const fill = badge.fills[0];
    expect(fill?.type).toBe('GRADIENT_LINEAR');
    expect(fill && 'gradientStops' in fill ? fill.gradientStops : []).toHaveLength(2);
    const transform = fill && 'gradientTransform' in fill ? fill.gradientTransform : undefined;
    expect(transform).toBeDefined();
    // Gradient space → object space: the renderer passes this straight to SVG.
    const matrix = fromMatrix(transform as TransformMatrix);
    expect(applyToPoint(matrix, 0, 0.5)).toMatchObject({ x: 0.5, y: 0 });
    expect(applyToPoint(matrix, 1, 0.5)).toMatchObject({ x: 0.5, y: 1 });
    expect(applyToPoint(matrix, 0, 1)).toMatchObject({ x: 1, y: 0 });
    expect(report.unsupported.some((item) => item.feature === 'paint:gradient:handlePositions')).toBe(false);
    expect(report.unsupported.some((item) => item.feature === 'ellipse:arcData')).toBe(true);
  });

  it('preserves the orientation of a rotated gradient', () => {
    const { file } = convertRest();
    const hero = findChild(file.document.children[0] as CanvasNode, '1:2') as ContainerNode;
    const rotated = findChild(hero, '1:13') as ShapeNode;
    const fill = rotated.fills[0];
    const transform = fill && 'gradientTransform' in fill ? fill.gradientTransform : undefined;
    expect(transform).toBeDefined();
    const matrix = fromMatrix(transform as TransformMatrix);
    // Handles from the fixture: start, end, width.
    const [h0, h1, h2] = [
      { x: 0.2, y: 0.1 },
      { x: 0.8, y: 0.9 },
      { x: 0.05, y: 0.5 },
    ];
    const near = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
      expect(actual.x).toBeCloseTo(expected.x, 5);
      expect(actual.y).toBeCloseTo(expected.y, 5);
    };
    near(applyToPoint(matrix, 0, 0.5), h0);
    near(applyToPoint(matrix, 1, 0.5), h1);
    near(applyToPoint(matrix, 0, 1), h2);
  });

  it('maps vector path geometry', () => {
    const { file } = convertRest();
    const hero = findChild(file.document.children[0] as CanvasNode, '1:2') as ContainerNode;
    const icon = findChild(hero, '1:6') as ShapeNode;
    expect(icon.type).toBe('VECTOR');
    expect(icon.pathData).toBe('M0 0 L24 0 L24 24 Z');
    expect(icon.windingRule).toBe('NONZERO');
  });

  it('reports unsupported node types, paints, and effects without dropping them', () => {
    const { file, report } = convertRest();
    const hero = findChild(file.document.children[0] as CanvasNode, '1:2') as ContainerNode;
    const sticky = findChild(hero, '1:7') as ShapeNode;
    expect(sticky.type).toBe('RECTANGLE');
    expect(sticky.raw?.type).toBe('STICKY');
    expect(report.unsupported.some((item) => item.feature === 'nodeType:STICKY')).toBe(true);
    expect(report.unsupported.some((item) => item.feature === 'paint:VIDEO')).toBe(true);
    expect(report.unsupported.some((item) => item.feature === 'effect:NOISE')).toBe(true);
  });

  it('derives parent-relative transforms from absolute bounds when relativeTransform is absent', () => {
    const { file } = convertRest();
    const page = file.document.children[0] as CanvasNode;
    const group = findChild(page, '1:8') as ContainerNode;
    expect(group.transform.tx).toBe(500);
    expect(group.transform.ty).toBe(0);
    const instance = findChild(group, '1:9') as InstanceNode;
    expect(instance.transform.tx).toBe(0);
  });

  it('maps instances and component sets', () => {
    const { file, report } = convertRest();
    const page = file.document.children[0] as CanvasNode;
    const group = findChild(page, '1:8') as ContainerNode;
    const instance = findChild(group, '1:9') as InstanceNode;
    expect(instance.type).toBe('INSTANCE');
    expect(instance.componentId).toBe('2:1');
    // The model stores instance property *values* (name -> string|boolean),
    // not Figma's raw `{ type, value }` records.
    expect(instance.componentProperties).toEqual({ size: 'lg' });
    expect(report.unsupported.some((item) => item.feature === 'instance:overrides')).toBe(true);

    const set = findChild(page, '1:11') as ComponentNode;
    expect(set.type).toBe('COMPONENT_SET');
    expect(set.componentPropertyDefinitions).toMatchObject({
      state: { type: 'VARIANT', defaultValue: expect.anything(), variantOptions: expect.any(Array) },
    });
    expect(findChild(set, '1:12')?.type).toBe('COMPONENT');
  });

  it('wraps detached nodes-response roots in a synthetic page', () => {
    const { file } = figmaRestToPigmaFile(parseFigmaRestNodes(json('rest-nodes.json')), { now: () => NOW });
    const page = file.document.children[0] as CanvasNode;
    expect(page.name).toBe('Imported nodes');
    const frame = page.children[0] as ContainerNode;
    expect(frame.id).toBe('1:2');
    expect(frame.transform.tx).toBe(120);
    const label = findChild(frame, '1:3') as TextNode;
    expect(label.characters).toBe('Detached');
    expect(label.style.lineHeight).toEqual({ unit: 'AUTO' });
  });
});

function collectSceneNodes(root: ParentNode): ShapeNode[] {
  const found: ShapeNode[] = [];
  const stack: ParentNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    for (const child of node.children) {
      if (hasChildren(child)) {
        stack.push(child);
      } else if (child.type === 'ELLIPSE' || child.type === 'VECTOR' || child.type === 'RECTANGLE') {
        found.push(child);
      }
    }
  }
  return found;
}

describe('native conversion to the Pigma model', () => {
  it('converts a real .fig into the Pigma model', () => {
    const doc = parseFigArchive(fixture('circle.fig'), nodeDecompressors);
    const { file, report } = figDocumentToPigmaFile(doc, { now: () => NOW });
    expect(report.sourceKind).toBe('native');
    expect(file.document.children).toHaveLength(2);
    const page = file.document.children[0] as CanvasNode;
    expect(page.name).toBe('Page 1');
    expect(page.backgroundColor).toMatchObject({ r: 0.11764705926179886 });

    const frame = page.children.find((child) => child.type === 'FRAME') as ContainerNode;
    expect(frame).toBeDefined();
    expect(frame.width).toBe(350);
    expect(frame.height).toBe(350);
    expect(frame.raw?.type).toBe('FRAME');

    const ellipse = frame.children.find((child) => child.type === 'ELLIPSE') as ShapeNode;
    expect(ellipse).toBeDefined();
    expect(ellipse.width).toBe(300);
    expect(ellipse.transform.tx).toBe(25);
    expect(ellipse.fills[0]).toMatchObject({ type: 'SOLID', color: { r: 1, g: 0, b: 0 } });
    expect(ellipse.pathData).toBeDefined();
    expect(ellipse.pathData?.length).toBeGreaterThan(0);
  });

  it('resolves vector geometry from blobs', () => {
    const doc = parseFigArchive(fixture('word-outline-stroke.fig'), nodeDecompressors);
    const { file } = figDocumentToPigmaFile(doc, { now: () => NOW });
    const shapes = file.document.children.flatMap((page) => collectSceneNodes(page));
    const vectors = shapes.filter((node) => node.type === 'VECTOR');
    expect(vectors.length).toBeGreaterThan(0);
    expect(vectors.some((vector) => (vector.pathData ?? '').length > 0)).toBe(true);
  });

  it('imports the fixture\'s own embedded image as a data URL', () => {
    const doc = parseFigArchive(fixture('with-image.fig'), nodeDecompressors);
    expect(doc.images.size).toBe(1);
    const [hash, bytes] = [...doc.images.entries()][0] as [string, Uint8Array];
    expect(hash).toMatch(/^[0-9a-f]{40}$/);

    // The document itself references the embedded asset (no test-side mutation).
    const { file } = figDocumentToPigmaFile(doc, { now: () => NOW });
    const shapes = file.document.children.flatMap((page) => collectSceneNodes(page));
    const painted = shapes.find((node) => node.fills.some((fill) => fill.type === 'IMAGE'));
    expect(painted).toBeDefined();
    const fill = painted!.fills.find((entry) => entry.type === 'IMAGE');
    expect(fill && 'dataUrl' in fill ? fill.dataUrl : undefined).toMatch(/^data:image\/png;base64,/);
    expect(fill && 'imageRef' in fill ? fill.imageRef : undefined).toBe(hash);

    // The data URL must decode back to the exact embedded bytes.
    const dataUrl = fill && 'dataUrl' in fill ? fill.dataUrl ?? '' : '';
    const decoded = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    expect(new Uint8Array(decoded)).toEqual(bytes);
  });

  it('inverts native gradient transforms into renderer space', () => {
    // Figma stores node space → gradient space; the renderer wants the inverse.
    const stored = { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 };
    const paint = {
      type: 'GRADIENT_LINEAR',
      stops: [
        { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
      ],
      transform: stored,
      visible: true,
    };
    const mapped = mapNativePaint(paint, { report: new ReportBuilder(), nodeId: '1:1', path: 'test' });
    expect(mapped.type).toBe('GRADIENT_LINEAR');
    const transform = mapped && 'gradientTransform' in mapped ? mapped.gradientTransform : undefined;
    expect(transform).toBeDefined();
    const matrix = fromMatrix(transform as TransformMatrix);
    // gradient (0,0.5) → stored transform maps object (0.5,0) → gradient (0,0.5)…
    // so the inverse must send (0,0.5) back to (0.5, 0).
    expect(applyToPoint(matrix, 0, 0.5).x).toBeCloseTo(0.5, 6);
    expect(applyToPoint(matrix, 0, 0.5).y).toBeCloseTo(0, 6);
    expect(applyToPoint(matrix, 1, 0.5).x).toBeCloseTo(0.5, 6);
    expect(applyToPoint(matrix, 1, 0.5).y).toBeCloseTo(1, 6);
  });

  it('converts either source through toPigmaFile', () => {
    const fromRest = toPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => NOW });
    const fromNative = toPigmaFile(parseFigArchive(fixture('circle.fig'), nodeDecompressors), { now: () => NOW });
    expect(fromRest.report.sourceKind).toBe('rest');
    expect(fromNative.report.sourceKind).toBe('native');
  });
});
