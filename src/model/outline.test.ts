import { describe, expect, it } from 'vitest';
import { dashesOf, outlineStrokeOp } from './boolean';
import { createEllipseNode, createFrameNode, createLineNode, createRectNode, createShapeNode } from './factory';
import { solidPaint } from './paint';
import { emptyFile } from './validate';
import { updateNode } from './tree';
import type { AnyNode, PigmaFile, SceneNode, StrokeAlign, StrokeCap, StrokeJoin } from './types';

const BLACK = solidPaint({ r: 0, g: 0, b: 0 });
const RED = solidPaint({ r: 1, g: 0, b: 0 });

/** A 100 x 50 rectangle with a red fill and a 10-wide black stroke on the given alignment and join. */
function stroked(align: StrokeAlign = 'INSIDE', join?: StrokeJoin): { file: PigmaFile; id: string } {
  const file = emptyFile('Outline');
  const page = file.document.children[0]!;
  const rect = createRectNode(null, 0, 0, 100, 50);
  rect.fills = [RED];
  rect.strokes = [BLACK];
  rect.strokeWeight = 10;
  rect.strokeAlign = align;
  if (join) rect.strokeJoin = join;
  page.children = [rect];
  return { file, id: rect.id };
}

const layers = (file: PigmaFile) => file.document.children[0]!.children as SceneNode[];

/** The area of the path data's rings, from the shoelace formula, with the sign of each ring taken away. */
function areaOf(pathData: string): number {
  return Math.abs(
    pathData
      .split('M')
      .filter((chunk) => chunk.trim().length > 0)
      .reduce((total, chunk) => {
        const points = chunk.replace('Z', '').split('L').map((pair) => pair.trim().split(/\s+/).map(Number));
        let twice = 0;
        points.forEach(([x0, y0], index) => {
          const [x1, y1] = points[(index + 1) % points.length]!;
          twice += x0! * y1! - x1! * y0!;
        });
        return total + twice / 2;
      }, 0),
  );
}

/** The band an outline made, read back from its path data. */
function bandOf(file: PigmaFile, id: string) {
  const outline = layers(outlineStrokeOp(file, id).file)[1]! as AnyNode & { pathData: string };
  return { width: outline.width, height: outline.height, area: areaOf(outline.pathData) };
}

describe('outline stroke', () => {
  it('turns the stroke into a vector filled with its paint, above the layer, and leaves the layer its fill', () => {
    const { file, id } = stroked('INSIDE');
    const outlined = outlineStrokeOp(file, id);
    expect(outlined.reason).toBeUndefined();
    const [source, outline] = layers(outlined.file);
    expect(source!.strokes).toEqual([]);
    expect(source!.fills).toEqual([RED]);
    expect(outline).toMatchObject({ type: 'VECTOR', fills: [BLACK], strokes: [] });
  });

  it('an inside stroke lies within the layer: its band is the layer less the rectangle inset by the width (about 2600)', () => {
    const { file, id } = stroked('INSIDE');
    const band = bandOf(file, id);
    expect(band.width).toBeCloseTo(100, 6);
    expect(band.height).toBeCloseTo(50, 6);
    expect(band.area).toBeGreaterThan(2580);
    expect(band.area).toBeLessThan(2610);
  });

  it('a centred stroke with round joins reaches half its width each side: 110 x 60, a band of about 2978', () => {
    // The outer edge is the rectangle grown by 5 with round corners (about 6578 square units) and the inner edge the rectangle
    // shrunk by 5 (3600), so the band is a little under the 3000 that square corners would give.
    const { file, id } = stroked('CENTER', 'ROUND');
    const band = bandOf(file, id);
    expect(band.width).toBeCloseTo(110, 6);
    expect(band.height).toBeCloseTo(60, 6);
    expect(band.area).toBeGreaterThan(2965);
    expect(band.area).toBeLessThan(2990);
  });

  it('a centred stroke with miter joins, the default, fills the square corners: a band of 3000', () => {
    // Sharp outer corners: the outer rectangle 110 x 60 (6600) less the inner 90 x 40 (3600).
    const { file, id } = stroked('CENTER');
    const band = bandOf(file, id);
    expect(band.width).toBeCloseTo(110, 6);
    expect(band.height).toBeCloseTo(60, 6);
    expect(band.area).toBeGreaterThan(2990);
    expect(band.area).toBeLessThan(3010);
  });

  it('a miter limit below a corner\'s miter ratio bevels that corner, and a higher limit keeps the miter', () => {
    // A square corner's miter is about 1.41 half widths long: a limit of 1.2 bevels it, so the band matches the bevel band, and 2 keeps it.
    const { file, id } = stroked('CENTER');
    const limited = (limit: number) => ({ ...file, document: updateNode(file.document, id, (node) => ({ ...node, strokeMiterLimit: limit }) as AnyNode) });
    const bevel = stroked('CENTER', 'BEVEL');
    expect(bandOf(limited(1.2), id).area).toBeCloseTo(bandOf(bevel.file, bevel.id).area, 3);
    const kept = bandOf(limited(2), id);
    expect(kept.area).toBeGreaterThan(2990);
    expect(kept.area).toBeLessThan(3010);
  });

  it('a centred stroke with bevel joins cuts each outer corner across: a band of about 2950', () => {
    // Each corner loses a quarter of its square (25 square units, less the 12.5 of the bevel triangle), so 4 x 12.5 is cut from 3000.
    const { file, id } = stroked('CENTER', 'BEVEL');
    const band = bandOf(file, id);
    expect(band.width).toBeCloseTo(110, 6);
    expect(band.area).toBeGreaterThan(2940);
    expect(band.area).toBeLessThan(2960);
  });

  it('an outside stroke lies beyond the layer: 120 x 70, a miter band of 3400', () => {
    const { file, id } = stroked('OUTSIDE');
    const band = bandOf(file, id);
    expect(band.width).toBeCloseTo(120, 6);
    expect(band.height).toBeCloseTo(70, 6);
    expect(band.area).toBeGreaterThan(3390);
    expect(band.area).toBeLessThan(3410);
  });

  it('refuses a layer with no visible solid stroke', () => {
    const { file, id } = stroked();
    const bare = updateNode(file.document, id, (node) => ({ ...node, strokes: [] }) as AnyNode);
    expect(outlineStrokeOp({ ...file, document: bare }, id).reason).toBe('The layer needs a visible solid stroke');
  });

  it('a dashed stroke is outlined as its dashes: less area than the solid band, in several pieces', () => {
    // Dashes of 10 with gaps of 5 cover two thirds of the edge, so the band is well under the solid 2600 and is made of many pieces.
    const { file, id } = stroked('INSIDE');
    const solid = bandOf(file, id);
    const dashed = updateNode(file.document, id, (node) => ({ ...node, dashPattern: [10, 5] }) as AnyNode);
    const outlined = outlineStrokeOp({ ...file, document: dashed }, id);
    expect(outlined.reason).toBeUndefined();
    const outline = layers(outlined.file)[1]! as AnyNode & { pathData: string };
    const area = areaOf(outline.pathData);
    expect(area).toBeLessThan(solid.area * 0.85);
    expect(area).toBeGreaterThan(solid.area * 0.4);
    expect(outline.pathData.split('M').length - 1).toBeGreaterThan(4);
  });

  it('a dash offset starts the pattern partway in, so the first dash is cut short and the last one is whole', () => {
    // A 100-unit line with dashes of 10 and gaps of 10: from the start there are five dashes, at 0, 20, 40, 60 and 80.
    const line: Array<[number, number]> = [
      [0, 0],
      [100, 0],
    ];
    expect(dashesOf(line, [10, 10], false)).toHaveLength(5);
    expect(dashesOf(line, [10, 10], false)[0]).toEqual([
      [0, 0],
      [10, 0],
    ]);
    // Five units in, the first dash has five units left, and the pattern then gives six dashes, the last one cut at the end.
    const offset = dashesOf(line, [10, 10], false, 5);
    expect(offset).toHaveLength(6);
    expect(offset[0]).toEqual([
      [0, 0],
      [5, 0],
    ]);
    expect(offset[1]).toEqual([
      [15, 0],
      [25, 0],
    ]);
    expect(offset[5]).toEqual([
      [95, 0],
      [100, 0],
    ]);
    // A whole period of offset changes nothing.
    expect(dashesOf(line, [10, 10], false, 20)).toEqual(dashesOf(line, [10, 10], false));
  });

  it('refuses a layer that is not a rectangle, ellipse or vector', () => {
    const { file } = stroked();
    const frame = createFrameNode(null, 0, 0, 100, 100);
    frame.strokes = [BLACK];
    file.document.children[0]!.children = [frame];
    expect(outlineStrokeOp(file, frame.id).reason).toBe('Outline stroke works on rectangles, ellipses, lines and vectors');
  });

  it('refuses a locked layer, and returns the file as it was', () => {
    const { file, id } = stroked();
    const locked = updateNode(file.document, id, (node) => ({ ...node, locked: true }) as AnyNode);
    const refused = outlineStrokeOp({ ...file, document: locked }, id);
    expect(refused.reason).toBe('The layer is locked');
    expect(refused.file.document).toBe(locked);
  });
});

describe('outline stroke on an ellipse', () => {
  it('outlines a centred ellipse with the same reach as a rectangle: 110 x 60', () => {
    const file = emptyFile('Outline');
    const page = file.document.children[0]!;
    const ellipse = createEllipseNode(null, 0, 0, 100, 50);
    ellipse.fills = [RED];
    ellipse.strokes = [BLACK];
    ellipse.strokeWeight = 10;
    ellipse.strokeAlign = 'CENTER';
    page.children = [ellipse];
    const outlined = outlineStrokeOp(file, ellipse.id);
    expect(outlined.reason).toBeUndefined();
    const band = bandOf(file, ellipse.id);
    // The ellipse is sampled at 64 points and the joins at 32, so the sizes are within a twentieth of a unit.
    expect(band.width).toBeCloseTo(110, 1);
    expect(band.height).toBeCloseTo(60, 1);
  });
});

describe('outline stroke on a line and an open path', () => {
  /** A horizontal line 100 long, with a 10-wide black stroke and the given cap. */
  function line(cap: StrokeCap): { file: PigmaFile; id: string } {
    const file = emptyFile('Outline');
    const page = file.document.children[0]!;
    const segment = createLineNode(null, 0, 0, 100);
    segment.strokes = [BLACK];
    segment.strokeWeight = 10;
    segment.strokeCap = cap;
    page.children = [segment];
    return { file, id: segment.id };
  }

  it('a butt-capped line is a 100 x 10 band, with square ends', () => {
    const { file, id } = line('NONE');
    const band = bandOf(file, id);
    expect(band.width).toBeCloseTo(100, 6);
    expect(band.height).toBeCloseTo(10, 6);
    expect(band.area).toBeCloseTo(1000, 0);
  });

  it('a square-capped line extends by half its width at each end: 110 x 10', () => {
    const { file, id } = line('SQUARE');
    const band = bandOf(file, id);
    expect(band.width).toBeCloseTo(110, 6);
    expect(band.area).toBeCloseTo(1100, 0);
  });

  it('a round-capped line adds a half disc at each end: 110 wide, and a little over 1078 square units', () => {
    const { file, id } = line('ROUND');
    const band = bandOf(file, id);
    // The disc is a 32-gon turned off the axes, so its extreme points are within a few thousandths of 5.
    expect(band.width).toBeCloseTo(110, 1);
    expect(band.height).toBeCloseTo(10, 1);
    expect(band.area).toBeGreaterThan(1070);
    expect(band.area).toBeLessThan(1085);
  });

  it('an equilateral arrow on a line adds a triangle at each end, as wide as 5 weights over root 3 at its base', () => {
    // At a weight of 10 each head is 50 long, so its base is 2 x 50 / root 3 = 57.7 across: the band is that tall. The two heads add
    // to the 1000 of the butt band, less the parts of each head that the band already covers.
    const { file, id } = line('ARROW_EQUILATERAL');
    const band = bandOf(file, id);
    expect(band.width).toBeCloseTo(100, 6);
    expect(band.height).toBeCloseTo((2 * 50) / Math.sqrt(3), 1);
    expect(band.area).toBeGreaterThan(2900);
    expect(band.area).toBeLessThan(3050);
  });

  it('a dashed stroke dashes the arms of an arrow line too, so the arms cover less than solid ones', () => {
    const { file, id } = line('ARROW_LINES');
    const solid = bandOf(file, id);
    const dashed = updateNode(file.document, id, (node) => ({ ...node, dashPattern: [10, 10] }) as AnyNode);
    const band = bandOf({ ...file, document: dashed }, id);
    expect(band.area).toBeLessThan(solid.area);
    expect(band.area).toBeGreaterThan(1000);
  });

  it('an arrow-lines cap on a line adds two chevron arms at each end, taller than the butt band', () => {
    const { file, id } = line('ARROW_LINES');
    const band = bandOf(file, id);
    expect(band.width).toBeGreaterThan(100);
    expect(band.height).toBeGreaterThan(50);
    expect(band.area).toBeGreaterThan(1000);
  });

  it('an open path is outlined as a band along it, centred, with round joins at its corners', () => {
    // An L of two edges, 100 along and 50 down. Its start and end are butt-capped, so the band reaches x 0 at the start and y 50 at
    // the end; only the corner is round, reaching 5 beyond it. The band is therefore 105 wide (0 to 105) and 55 tall (-5 to 50).
    const file = emptyFile('Outline');
    const page = file.document.children[0]!;
    const path = createShapeNode(null, 'RECTANGLE', 0, 0, 100, 50);
    const vector = { ...path, type: 'VECTOR', pathData: 'M 0 0 L 100 0 L 100 50', windingRule: 'NONZERO', strokes: [BLACK], strokeWeight: 10, strokeCap: 'NONE', fills: [] } as unknown as SceneNode;
    page.children = [vector];
    const outlined = outlineStrokeOp(file, vector.id);
    expect(outlined.reason).toBeUndefined();
    const band = bandOf(file, vector.id);
    expect(band.width).toBeCloseTo(105, 1);
    expect(band.height).toBeCloseTo(55, 1);
  });
});
