/**
 * Boolean geometry: where curves live, and what the approximation costs.
 *
 * Figma keeps curves through a boolean. Pigma flattens every operand to polygons
 * and runs an exact polygon boolean, so the result is a polygon approximation.
 * This file pins the facts that decide whether a curve-preserving boolean is
 * worth adding, so the limitation cannot be argued about from memory:
 *
 *  - the SOURCE geometry DOES keep its Bezier control points (`pathData` is SVG
 *    path data and `C` segments parse into in/out handles), so the flattening is
 *    ours, not the model's;
 *  - the OUTPUT is polygonal — `polygonsToPathData` emits only M/L/Z — so a
 *    boolean bakes the approximation into the result;
 *  - the measured cost: an ellipse is sampled at 64 points (sagitta 0.12 px at
 *    r=100, area error 0.16%) and a cubic at 64 (worst deviation 0.090 px on a
 *    100 px chord, 0.09%) — 16 samples gave 1.25 px, which is why it was raised.
 *
 * The vertex counts and sample counts are asserted so raising them is a
 * deliberate edit.
 */
import { describe, expect, it } from 'vitest';
import { emptyFile } from './validate';
import { createEllipseNode, createRectNode } from './factory';
import { booleanGeometry, nodePolygons } from './boolean';
import { anchorsFromPathData, type VectorAnchor } from './vector';
import { findNode } from './tree';
import { renderSvgDocument } from '../render/svgExport';
import type { PigmaFile } from './types';

const ELLIPSE_SAMPLES = 64;
// Raised from 16: a cubic's error falls as 1/n^2, and 64 lands it at or below an
// ellipse's own error (0.120 px at r=100).
const CURVE_SAMPLES = 64;

function scene(): { file: PigmaFile; firstId: string; secondId: string } {
  const file = emptyFile('Boolean geometry');
  const page = file.document.children[0]!;
  const first = createEllipseNode(file.document, 0, 0, 200, 200);
  const second = createEllipseNode(file.document, 100, 0, 200, 200);
  page.children = [first, second];
  return { file, firstId: first.id, secondId: second.id };
}

describe('boolean geometry', () => {
  it('the source keeps Bezier control points', () => {
    // The decisive fact: a cubic in pathData becomes anchors with handles, so the
    // model is NOT already flattened.
    const path = anchorsFromPathData('M 0 0 C 0 100 100 100 100 0 Z');
    expect(path).not.toBeNull();
    expect(path!.anchors).toHaveLength(2);
    expect(path!.anchors[0]!.out).toEqual({ x: 0, y: 100 });
    expect(path!.anchors[1]!.in).toEqual({ x: 0, y: 100 });
    expect(path!.closed).toBe(true);
  });

  it('raises a quadratic to the same cubic, so its midpoint is unchanged', () => {
    const path = anchorsFromPathData('M 0 0 Q 50 100 100 0 Z');
    expect(path).not.toBeNull();
    const [start, end] = path!.anchors as [VectorAnchor, VectorAnchor];
    expect(start.out!.x).toBeCloseTo(100 / 3, 6);
    expect(start.out!.y).toBeCloseTo(200 / 3, 6);
    expect(end.in!.x).toBeCloseTo(-100 / 3, 6);
    expect(end.in!.y).toBeCloseTo(200 / 3, 6);
    // Cubic at t = 1/2: (P0 + 3 C1 + 3 C2 + P3) / 8, which is the quadratic's midpoint (50, 50).
    const c1 = { x: start.x + start.out!.x, y: start.y + start.out!.y };
    const c2 = { x: end.x + end.in!.x, y: end.y + end.in!.y };
    expect((start.x + 3 * c1.x + 3 * c2.x + end.x) / 8).toBeCloseTo(50, 6);
    expect((start.y + 3 * c1.y + 3 * c2.y + end.y) / 8).toBeCloseTo(50, 6);
  });

  it('refuses geometry it cannot represent exactly', () => {
    // Arcs and relative commands are refused rather than tokenised into a wrong polyline — a refusal is visible,
    // a wrong polyline is not.
    expect(anchorsFromPathData('M 0 0 A 50 50 0 0 1 100 0 Z')).toBeNull();
    expect(anchorsFromPathData('M 0 0 q 50 100 100 0 Z')).toBeNull();
    expect(anchorsFromPathData('m 0 0 l 10 10 z')).toBeNull();
  });

  it('samples an ellipse at 64 points and a cubic at 64', () => {
    const { file, firstId } = scene();
    const outline = nodePolygons(file.document, firstId)!;
    expect(outline).toHaveLength(1);
    // 64 samples, and polygon-clipping repeats the first point to close the ring.
    expect(outline[0]![0]).toHaveLength(ELLIPSE_SAMPLES + 1);

    const vector = { ...createRectNode(file.document, 0, 0, 100, 100), type: 'VECTOR' as const, fills: [], pathData: 'M 0 0 C 0 100 100 100 100 0 Z' };
    const page = file.document.children[0]!;
    page.children = [...page.children, vector];
    const curved = nodePolygons(file.document, vector.id)!;
    // The start anchor, CURVE_SAMPLES points for the cubic, then one point for
    // the closing segment `Z` adds: 1 + 64 + 1.
    expect(curved[0]![0]).toHaveLength(2 + CURVE_SAMPLES);
  });

  it('produces a polygon, not a curve', () => {
    const { file, firstId, secondId } = scene();
    const geometry = booleanGeometry(file, [firstId, secondId], 'SUBTRACT');
    expect(geometry.pathData).not.toBe('');
    expect([...new Set(geometry.pathData.match(/[A-Za-z]/g) ?? [])].sort()).toEqual(['L', 'M', 'Z']);
    expect(geometry.pathData, 'the result should carry no curves').not.toMatch(/[CcQqAaSsTt]/);
    // Two 64-gons overlapping: the difference keeps their vertices — 67, and 938
    // characters of path data. Pinned so a sampling change is deliberate.
    const vertices = (geometry.pathData.match(/L/g) ?? []).length + 1;
    expect(vertices).toBe(67);
    expect(geometry.pathData.length).toBe(938);
  });

  it('records what the approximation costs', () => {
    // An ellipse's 64-gon: the sagitta at r=100 and the area it loses.
    const radius = 100;
    const sagitta = radius * (1 - Math.cos(Math.PI / ELLIPSE_SAMPLES));
    expect(sagitta).toBeCloseTo(0.12, 2);
    const polygonArea = (ELLIPSE_SAMPLES / 2) * radius * radius * Math.sin((2 * Math.PI) / ELLIPSE_SAMPLES);
    const areaError = Math.abs(Math.PI * radius * radius - polygonArea) / (Math.PI * radius * radius);
    expect(areaError).toBeLessThan(0.002);

    // A cubic's 16-segment polyline, worst case over a range of handle lengths.
    const cubicAt = (p0: number[], c1: number[], c2: number[], p1: number[], t: number): [number, number] => {
      const u = 1 - t;
      return [
        u * u * u * p0[0]! + 3 * u * u * t * c1[0]! + 3 * u * t * t * c2[0]! + t * t * t * p1[0]!,
        u * u * u * p0[1]! + 3 * u * u * t * c1[1]! + 3 * u * t * t * c2[1]! + t * t * t * p1[1]!,
      ];
    };
    let worst = 0;
    for (const handle of [0.25, 0.5, 1, 2, 5]) {
      const p0 = [0, 0];
      const p1 = [100, 0];
      const c1 = [0, handle * 100];
      const c2 = [100, handle * 100];
      const samples: Array<[number, number]> = [];
      for (let i = 0; i <= CURVE_SAMPLES; i += 1) samples.push(cubicAt(p0, c1, c2, p1, i / CURVE_SAMPLES));
      for (let i = 0; i <= 400; i += 1) {
        const [x, y] = cubicAt(p0, c1, c2, p1, i / 400);
        let nearest = Number.POSITIVE_INFINITY;
        for (let s = 0; s < samples.length - 1; s += 1) {
          const [x1, y1] = samples[s]!;
          const [x2, y2] = samples[s + 1]!;
          const dx = x2 - x1;
          const dy = y2 - y1;
          const length = dx * dx + dy * dy;
          const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length));
          nearest = Math.min(nearest, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
        }
        worst = Math.max(worst, nearest);
      }
    }
    // Measured 0.090 px at 64 samples, against 1.250 px at 16: at or below the
    // ellipse's 0.120 px, so the two operand kinds are equally accurate. The cost
    // is pinned too — a curved operand flattens to 66 points instead of 18.
    expect(worst, `cubic deviation ${worst.toFixed(3)} px`).toBeLessThan(0.12);
    expect(worst).toBeGreaterThan(0.05);
    const ellipseSagittaAtR100 = 100 * (1 - Math.cos(Math.PI / ELLIPSE_SAMPLES));
    expect(worst).toBeLessThanOrEqual(ellipseSagittaAtR100 + 0.03);
  });

  it('renders the polygonal result without special cases', () => {
    const { file, firstId, secondId } = scene();
    const page = file.document.children[0]!;
    const operation = {
      ...createRectNode(file.document, 0, 0, 200, 200),
      type: 'BOOLEAN_OPERATION' as const,
      booleanOperation: 'SUBTRACT' as const,
      fills: [{ type: 'SOLID' as const, color: { r: 1, g: 0, b: 0 }, opacity: 1 }],
      children: [findNode(file.document, firstId)!, findNode(file.document, secondId)!],
      pathData: booleanGeometry(file, [firstId, secondId], 'SUBTRACT').pathData,
    };
    page.children = [operation as never];
    const svg = renderSvgDocument(file, [operation as never]);
    expect(svg).toContain('<path');
    expect(svg, 'the boolean outline renders as a path, not an ellipse').not.toContain('<ellipse');
  });
});

describe('a vector with several contours', () => {
  /** A vector node holding `pathData`, on the page. */
  function vectorWith(pathData: string) {
    const file = emptyFile('Contours');
    const page = file.document.children[0]!;
    const node = { ...createRectNode(file.document, 0, 0, 100, 100), type: 'VECTOR' as const, fills: [], pathData };
    page.children = [node];
    return { file, id: node.id };
  }

  it('keeps a counter as a hole, not a filled region', () => {
    // A square with a square cut out: the glyph 'O' in miniature.
    const { file, id } = vectorWith('M0 0 L100 0 L100 100 L0 100 Z M25 25 L75 25 L75 75 L25 75 Z');
    const polygons = nodePolygons(file.document, id)!;
    expect(polygons, 'the counter became a second, filled region').toHaveLength(1);
    expect(polygons[0], 'the counter is not a hole in the outer contour').toHaveLength(2);
  });

  it('keeps separate contours as separate regions', () => {
    // Two squares side by side, like the stem and dot of an 'i'.
    const { file, id } = vectorWith('M0 0 L10 0 L10 10 L0 10 Z M20 0 L30 0 L30 10 L20 10 Z');
    const polygons = nodePolygons(file.document, id)!;
    expect(polygons).toHaveLength(2);
  });
});

describe('a quadratic curve in a boolean', () => {
  it('is sampled as its cubic, so a vector with a quadratic outline is no longer refused', () => {
    const file = emptyFile('Quadratic');
    const vector = { ...createRectNode(file.document, 0, 0, 100, 100), type: 'VECTOR' as const, fills: [], pathData: 'M 0 0 Q 50 100 100 0 Z' };
    const page = file.document.children[0]!;
    page.children = [...page.children, vector];
    const outline = nodePolygons(file.document, vector.id);
    expect(outline).not.toBeNull();
    expect(outline![0]![0]).toHaveLength(2 + CURVE_SAMPLES);
  });
});
