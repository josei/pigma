import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { renderSvgDocument } from './svgExport';
import { emptyFile } from '../model/validate';
import { createRectNode } from '../model/factory';
import { parseFile, serializeFile } from '../model/serialize';
import { findNode } from '../model/tree';
import type { PigmaFile, SceneNode, StrokeSideWeights } from '../model/types';

/**
 * Individual stroke weights (Figma's per-side strokes, `strokeTopWeight` and the rest, per the Plugin API update 48): a rectangle
 * draws each side as a band inside its box, in the stroke paint. Rendered and sampled, since the bands are what a designer sees.
 */
function box(strokeWeight: number, sides: StrokeSideWeights | undefined, radius = 0): { file: PigmaFile; node: SceneNode } {
  const file = emptyFile('Sides');
  const page = file.document.children[0]!;
  const rect = createRectNode(file.document, 0, 0, 100, 100);
  rect.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
  rect.strokes = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
  rect.strokeWeight = strokeWeight;
  if (sides) rect.individualStrokeWeights = sides;
  if (radius > 0) rect.cornerRadius = radius;
  page.children = [rect];
  return { file, node: rect };
}

function pixels(file: PigmaFile, node: SceneNode) {
  const svg = renderSvgDocument(file, [node]);
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: 100 } }).render();
  return (x: number, y: number): [number, number, number] => {
    const at = (y * rendered.width + x) * 4;
    return [rendered.pixels[at]!, rendered.pixels[at + 1]!, rendered.pixels[at + 2]!];
  };
}

describe('individual stroke weights', () => {
  it('draws only the sides that have a width, as bands inside the box', () => {
    const { file, node } = box(1, { top: 0, right: 0, bottom: 0, left: 20 });
    const at = pixels(file, node);
    expect(at(10, 50)).toEqual([255, 0, 0]);
    expect(at(50, 50)).toEqual([255, 255, 255]);
    expect(at(50, 5)).toEqual([255, 255, 255]);
    expect(at(95, 50)).toEqual([255, 255, 255]);
  });

  it('draws a top band of its own width, and nothing on the other sides', () => {
    const { file, node } = box(1, { top: 10, right: 0, bottom: 0, left: 0 });
    const at = pixels(file, node);
    expect(at(50, 5)).toEqual([255, 0, 0]);
    expect(at(50, 50)).toEqual([255, 255, 255]);
  });

  it('draws the bands even when the single weight is zero', () => {
    const { file, node } = box(0, { top: 0, right: 0, bottom: 0, left: 20 });
    expect(pixels(file, node)(10, 50)).toEqual([255, 0, 0]);
  });

  it('keeps one weight on a rounded rectangle, since the bands are for a plain box', () => {
    const { file, node } = box(6, { top: 0, right: 0, bottom: 0, left: 20 }, 20);
    const at = pixels(file, node);
    // The single weight of 6 is centred on the edge, so it shows 3 units inside it; the 20-unit left band is not drawn.
    expect(at(1, 50)).toEqual([255, 0, 0]);
    expect(at(10, 50)).toEqual([255, 255, 255]);
  });

  it('survives a save and a reload', () => {
    const { file, node } = box(1, { top: 2, right: 3, bottom: 4, left: 5 });
    const parsed = parseFile(serializeFile(file));
    expect(parsed.ok).toBe(true);
    const back = findNode(parsed.file!.document, node.id) as SceneNode;
    expect(back.individualStrokeWeights).toEqual({ top: 2, right: 3, bottom: 4, left: 5 });
  });
});
