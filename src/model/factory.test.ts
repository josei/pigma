import { emptyFile } from './validate';
import { parseFile, serializeFile } from './serialize';
import { toolDraw } from './toolDraw';
import { applyNodePatch } from './ops';
import { findNode } from './tree';
import type { Tool } from '../store/editorStore';
import type { ShapeNode } from './types';

/** Every member of the Tool union, so a new tool cannot slip past this test. */
const ALL_TOOLS: Tool[] = ['select', 'hand', 'frame', 'rect', 'ellipse', 'polygon', 'star', 'line', 'text', 'section', 'pen', 'comment'];

describe('toolDraw', () => {
  it('names what every tool creates — the single tool -> node-type table', () => {
    const root = emptyFile('Shapes').document;
    const shapes: Array<[Tool, string]> = [
      ['rect', 'RECTANGLE'],
      ['ellipse', 'ELLIPSE'],
      ['polygon', 'POLYGON'],
      ['star', 'STAR'],
      ['frame', 'FRAME'],
    ];
    for (const [tool, type] of shapes) {
      const draw = toolDraw(tool);
      expect(draw.kind, `the ${tool} tool does not create a shape`).toBe('shape');
      if (draw.kind !== 'shape') continue;
      expect(draw.nodeType, `the ${tool} tool is named for ${type}`).toBe(type);
      const node = draw.factory(root, 10, 20, 120, 80);
      expect(node.type).toBe(type);
      expect(node.width).toBe(120);
      expect(node.height).toBe(80);
      expect(node.transform.tx).toBe(10);
      expect(node.transform.ty).toBe(20);
    }
  });

  it('accounts for every tool, and only those create on drag', () => {
    // The union is walked in full: a tool added without a branch would fail the
    // exhaustive switch at compile time, and this test would fail if the branch
    // were a silent fall-through.
    const expected: Record<Tool, string> = {
      select: 'none',
      hand: 'none',
      comment: 'none',
      rect: 'shape',
      ellipse: 'shape',
      polygon: 'shape',
      star: 'shape',
      frame: 'shape',
      text: 'text',
      section: 'section',
      line: 'line',
      pen: 'path',
    };
    for (const tool of ALL_TOOLS) {
      expect(toolDraw(tool).kind, `the ${tool} tool`).toBe(expected[tool]);
    }
    expect(new Set(ALL_TOOLS).size).toBe(ALL_TOOLS.length);
  });

  it('gives polygons and stars sensible point counts', () => {
    const root = emptyFile('Points').document;
    const polygon = toolDraw('polygon');
    const star = toolDraw('star');
    if (polygon.kind !== 'shape' || star.kind !== 'shape') throw new Error('expected shape tools');
    expect((polygon.factory(root, 0, 0, 100, 100) as ShapeNode & { pointCount?: number }).pointCount).toBe(3);
    expect((star.factory(root, 0, 0, 100, 100) as ShapeNode & { pointCount?: number }).pointCount).toBe(5);
  });
});

describe('polygon and star editing after creation', () => {
  it('applies point count, corner radius and inner radius as node patches', () => {
    const file = emptyFile('Edit');
    const page = file.document.children[0]!;
    const starDraw = toolDraw('star');
    const polygonDraw = toolDraw('polygon');
    if (starDraw.kind !== 'shape' || polygonDraw.kind !== 'shape') throw new Error('expected shape tools');
    const star = starDraw.factory(file.document, 0, 0, 200, 200);
    const polygon = polygonDraw.factory(file.document, 240, 0, 200, 200);
    page.children = [star, polygon];

    // The panel edits these through the same patch path as every other field.
    const withStar = applyNodePatch(file, star.id, { pointCount: 8, innerRadius: 0.25, cornerRadius: 6 });
    const starNode = findNode(withStar.document, star.id) as ShapeNode;
    expect(starNode.pointCount).toBe(8);
    expect(starNode.innerRadius).toBe(0.25);
    expect(starNode.cornerRadius).toBe(6);

    const withPolygon = applyNodePatch(withStar, polygon.id, { pointCount: 7, cornerRadius: 3 });
    const polygonNode = findNode(withPolygon.document, polygon.id) as ShapeNode;
    expect(polygonNode.pointCount).toBe(7);
    expect(polygonNode.cornerRadius).toBe(3);
    // The star is untouched by the polygon's edit.
    expect((findNode(withPolygon.document, star.id) as ShapeNode).pointCount).toBe(8);
  });

  it('persists the edits through serialization', () => {
    const file = emptyFile('Persist');
    const page = file.document.children[0]!;
    const draw = toolDraw('star');
    if (draw.kind !== 'shape') throw new Error('expected a shape tool');
    const star = draw.factory(file.document, 0, 0, 200, 200);
    page.children = [star];
    const edited = applyNodePatch(file, star.id, { pointCount: 12, innerRadius: 0.5 });

    const round = parseFile(serializeFile(edited)).file!;
    const node = findNode(round.document, star.id) as ShapeNode;
    expect(node.pointCount).toBe(12);
    expect(node.innerRadius).toBe(0.5);
  });
});
