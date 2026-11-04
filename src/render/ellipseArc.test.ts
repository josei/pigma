import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { renderSvgDocument } from './svgExport';
import { emptyFile } from '../model/validate';
import { createShapeNode } from '../model/factory';
import { parseFile, serializeFile } from '../model/serialize';
import { findNode } from '../model/tree';
import { arcSweep, ellipseArcPath } from '../model/ellipseArc';
import type { PigmaFile, SceneNode, ShapeNode } from '../model/types';

/**
 * A partial ellipse as Figma draws it: angles in radians from the x axis, clockwise. The fixture arc is a three-quarter turn from zero
 * to 3 pi / 2, so the top-right quarter is missing. Rendered and sampled, since the missing quarter is what a designer sees.
 */
function ellipse(arc: { startingAngle: number; endingAngle: number; innerRadius: number }): { file: PigmaFile; node: SceneNode } {
  const file = emptyFile('Arc');
  const page = file.document.children[0]!;
  const node = createShapeNode(file.document, 'ELLIPSE', 0, 0, 100, 100);
  node.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 }];
  node.strokes = [];
  node.arc = arc;
  page.children = [node];
  return { file, node };
}

function pixels(file: PigmaFile, node: SceneNode) {
  const svg = renderSvgDocument(file, [node]);
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: 100 } }).render();
  return (x: number, y: number): [number, number, number, number] => {
    const at = (y * rendered.width + x) * 4;
    return [rendered.pixels[at]!, rendered.pixels[at + 1]!, rendered.pixels[at + 2]!, rendered.pixels[at + 3]!];
  };
}

const isBlue = (pixel: number[]) => pixel[2] === 255 && pixel[3] === 255 && pixel[0] === 0;

describe('partial ellipses', () => {
  it('sweeps clockwise from the starting angle, and reads an equal start and end as a whole turn', () => {
    expect(arcSweep({ startingAngle: 0, endingAngle: Math.PI / 2, innerRadius: 0 })).toBeCloseTo(Math.PI / 2, 9);
    expect(arcSweep({ startingAngle: 0, endingAngle: 0, innerRadius: 0 })).toBeCloseTo(Math.PI * 2, 9);
    // An end before the start wraps round the circle, so 3 pi / 2 back from 0 is a quarter turn forward from 3 pi / 2.
    expect(arcSweep({ startingAngle: Math.PI * 1.5, endingAngle: 0, innerRadius: 0 })).toBeCloseTo(Math.PI / 2, 9);
  });

  it('draws a pie slice with no inner radius, and a ring sector with one', () => {
    const pie = ellipseArcPath(100, 100, { startingAngle: 0, endingAngle: Math.PI / 2, innerRadius: 0 });
    expect(pie).toContain('L 50 50 Z');
    const ring = ellipseArcPath(100, 100, { startingAngle: 0, endingAngle: Math.PI / 2, innerRadius: 0.5 });
    expect(ring.endsWith('Z')).toBe(true);
    expect(ring).not.toContain('L 50 50');
  });

  it('leaves out the missing quarter of a three-quarter arc, and fills the rest', () => {
    const { file, node } = ellipse({ startingAngle: 0, endingAngle: Math.PI * 1.5, innerRadius: 0 });
    const at = pixels(file, node);
    expect(isBlue(at(75, 25))).toBe(false);
    expect(isBlue(at(25, 25))).toBe(true);
    expect(isBlue(at(75, 75))).toBe(true);
  });

  it('cuts a hole where the inner radius is, so the centre of a ring is not filled', () => {
    const { file, node } = ellipse({ startingAngle: 0, endingAngle: Math.PI * 1.5, innerRadius: 0.5 });
    const at = pixels(file, node);
    expect(isBlue(at(50, 50))).toBe(false);
    expect(isBlue(at(90, 50))).toBe(true);
  });

  it('keeps the arc through a save and a reload', () => {
    const { file, node } = ellipse({ startingAngle: 0, endingAngle: Math.PI * 1.5, innerRadius: 0.5 });
    const parsed = parseFile(serializeFile(file));
    expect(parsed.ok).toBe(true);
    const back = findNode(parsed.file!.document, node.id) as ShapeNode;
    expect(back.arc).toEqual({ startingAngle: 0, endingAngle: Math.PI * 1.5, innerRadius: 0.5 });
  });
});
