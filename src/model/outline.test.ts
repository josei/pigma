import { describe, expect, it } from 'vitest';
import { outlineStrokeOp } from './boolean';
import { createEllipseNode, createFrameNode, createRectNode } from './factory';
import { solidPaint } from './paint';
import { emptyFile } from './validate';
import { updateNode } from './tree';
import type { AnyNode, PigmaFile, SceneNode, StrokeAlign } from './types';

const BLACK = solidPaint({ r: 0, g: 0, b: 0 });
const RED = solidPaint({ r: 1, g: 0, b: 0 });

/** A 100 x 50 rectangle with a red fill and a 10-wide black stroke on the given alignment. */
function stroked(align: StrokeAlign = 'INSIDE'): { file: PigmaFile; id: string } {
  const file = emptyFile('Outline');
  const page = file.document.children[0]!;
  const rect = createRectNode(null, 0, 0, 100, 50);
  rect.fills = [RED];
  rect.strokes = [BLACK];
  rect.strokeWeight = 10;
  rect.strokeAlign = align;
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

  it('a centred stroke reaches half its width each side: 110 x 60, a band of about 2978 with round corners', () => {
    // The outer edge is the rectangle grown by 5 with round corners (about 6578 square units) and the inner edge the rectangle
    // shrunk by 5 (3600), so the band is a little under the 3000 that square corners would give.
    const { file, id } = stroked('CENTER');
    const band = bandOf(file, id);
    expect(band.width).toBeCloseTo(110, 6);
    expect(band.height).toBeCloseTo(60, 6);
    expect(band.area).toBeGreaterThan(2950);
    expect(band.area).toBeLessThan(3000);
  });

  it('an outside stroke lies beyond the layer: 120 x 70, a band of about 3312', () => {
    const { file, id } = stroked('OUTSIDE');
    const band = bandOf(file, id);
    expect(band.width).toBeCloseTo(120, 6);
    expect(band.height).toBeCloseTo(70, 6);
    expect(band.area).toBeGreaterThan(3290);
    expect(band.area).toBeLessThan(3330);
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

  it('refuses a layer that is not a rectangle, ellipse or vector', () => {
    const { file } = stroked();
    const frame = createFrameNode(null, 0, 0, 100, 100);
    frame.strokes = [BLACK];
    file.document.children[0]!.children = [frame];
    expect(outlineStrokeOp(file, frame.id).reason).toBe('Outline stroke works on rectangles, ellipses and vectors');
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
