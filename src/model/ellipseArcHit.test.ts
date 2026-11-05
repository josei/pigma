import { describe, expect, it } from 'vitest';
import { nodePolygons } from './boolean';
import { IDENTITY } from './matrix';
import { createShapeNode } from './factory';
import { emptyFile } from './validate';
import { hitTestBox } from './tree';
import type { EllipseArc, PigmaFile, SceneNode } from './types';

/** A 100 by 100 ellipse with the given arc, on a page of its own. */
function arcEllipse(arc: EllipseArc): { file: PigmaFile; node: SceneNode } {
  const file = emptyFile('Hit');
  const page = file.document.children[0]!;
  const node = createShapeNode(file.document, 'ELLIPSE', 0, 0, 100, 100);
  node.arc = arc;
  page.children = [node];
  return { file, node };
}

// The three-quarter arc from Figma's fixture: from zero to 3 pi / 2, so the top-right quarter is missing.
const THREE_QUARTERS = Math.PI * 1.5;

describe('partial ellipses in hit tests and outlines', () => {
  it('is not hit in the missing quarter, and is hit on the arc', () => {
    const { node } = arcEllipse({ startingAngle: 0, endingAngle: THREE_QUARTERS, innerRadius: 0 });
    expect(hitTestBox(node, IDENTITY, 75, 25)).toBe(false);
    expect(hitTestBox(node, IDENTITY, 25, 25)).toBe(true);
    expect(hitTestBox(node, IDENTITY, 75, 75)).toBe(true);
  });

  it('includes the centre of a pie slice, and not the hole of a ring sector', () => {
    const pie = arcEllipse({ startingAngle: 0, endingAngle: THREE_QUARTERS, innerRadius: 0 });
    expect(hitTestBox(pie.node, IDENTITY, 50, 50)).toBe(true);
    const ring = arcEllipse({ startingAngle: 0, endingAngle: THREE_QUARTERS, innerRadius: 0.5 });
    expect(hitTestBox(ring.node, IDENTITY, 50, 50)).toBe(false);
    expect(hitTestBox(ring.node, IDENTITY, 90, 50)).toBe(true);
  });

  it('outlines the arc without the missing quarter, so a boolean of it leaves that quarter out', () => {
    const { file, node } = arcEllipse({ startingAngle: 0, endingAngle: THREE_QUARTERS, innerRadius: 0 });
    const rings = nodePolygons(file.document, node.id);
    expect(rings).not.toBeNull();
    const points = rings!.flat(2);
    // Nothing in the top-right quarter: x beyond the centre and y above it, well inside the 50-unit radius.
    expect(points.some(([x, y]) => x > 55 && y < 45)).toBe(false);
    expect(points.some(([x, y]) => x < 45 && y < 45)).toBe(true);
  });
});
