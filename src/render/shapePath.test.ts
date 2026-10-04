import { describe, expect, it } from 'vitest';
import { shapePath, starPath } from './SceneRenderer';
import { createPolygonNode, createRectNode, createStarNode } from '../model/factory';
import { applyNodePatch } from '../model/ops';
import { emptyFile } from '../model/validate';
import type { SceneNode } from '../model/types';

const arcs = (path: string) => (path.match(/A /g) ?? []).length;

/**
 * Corner radius on polygons and stars.
 *
 * QA measured the rendered path at radius 12 as byte-identical to radius 0 for
 * both shapes: the panel wrote `cornerRadius` and the renderer ignored it. These
 * assertions are about the geometry the renderer actually produces.
 */
describe('polygon and star corner radius', () => {
  it('rounds every corner of a polygon and every point of a star', () => {
    const polygonFlat = starPath(200, 200, 5, 1, false, 0);
    const polygonRound = starPath(200, 200, 5, 1, false, 12);
    expect(polygonRound, 'radius 12 rendered the same path as radius 0').not.toBe(polygonFlat);
    // One arc per corner.
    expect(arcs(polygonFlat)).toBe(0);
    expect(arcs(polygonRound)).toBe(5);

    const starFlat = starPath(200, 200, 5, 0.382, true, 0);
    const starRound = starPath(200, 200, 5, 0.382, true, 12);
    expect(starRound).not.toBe(starFlat);
    // A five-point star has ten vertices, so ten arcs.
    expect(arcs(starFlat)).toBe(0);
    expect(arcs(starRound)).toBe(10);
  });

  it('clamps a large radius so adjacent corners cannot overlap', () => {
    // A tiny shape with an absurd radius: every cut is clamped to half of the
    // shorter adjacent edge, so the arcs never swallow an edge whole.
    const tiny = starPath(20, 20, 3, 1, false, 500);
    expect(arcs(tiny)).toBe(3);
    const radii = [...tiny.matchAll(/A ([\d.]+) /g)].map((match) => Number(match[1]));
    expect(Math.max(...radii)).toBeLessThan(500);
    // Each arc radius is at most half the edge it sits on.
    const longestEdge = Math.hypot(20, 20);
    expect(Math.max(...radii)).toBeLessThanOrEqual(longestEdge / 2 + 0.001);
    // A zero radius keeps the plain polygon, so nothing changes for shapes that
    // never asked for rounding.
    expect(starPath(200, 200, 3, 1, false, 0)).toBe(starPath(200, 200, 3, 1, false));
  });

  it('renders the radius the properties panel writes', () => {
    const file = emptyFile('Round');
    const page = file.document.children[0]!;
    const star = createStarNode(file.document, 0, 0, 200, 200);
    const polygon = createPolygonNode(file.document, 240, 0, 200, 200);
    const rect = createRectNode(file.document, 480, 0, 200, 200);
    page.children = [star, polygon, rect];

    const edited = applyNodePatch(applyNodePatch(file, star.id, { cornerRadius: 12 }), polygon.id, { cornerRadius: 12 });
    const at = (id: string) => shapePath(edited.document.children[0]!.children.find((n) => n.id === id) as SceneNode)!;
    expect(arcs(at(star.id))).toBe(10);
    // The factory's polygon has three sides by default, so three arcs.
    expect(arcs(at(polygon.id))).toBe(3);
    // The rectangle was already rounded by the renderer, which is why the panel
    // looked like it worked: the defect was specific to polygons and stars.
    expect(shapePath(applyNodePatch(edited, rect.id, { cornerRadius: 12 }).document.children[0]!.children.find((n) => n.id === rect.id) as SceneNode)!).toContain('A ');
  });
});
