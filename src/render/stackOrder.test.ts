import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { renderSvgDocument } from './svgExport';
import { emptyFile } from '../model/validate';
import { createFrameNode, createRectNode } from '../model/factory';
import { reflowTree, defaultAutoLayout } from '../model/autoLayout';
import type { AutoLayout, SceneNode } from '../model/types';
import { findNode } from '../model/tree';

/**
 * Overlap order in a stack (Sketch's "z-index order of overlapping items"). A row with a 40-unit negative gap makes its first two
 * children overlap by 40 units, from x 60 to 100. The overlap pixel shows whichever child is on top, so it is sampled from a
 * rasterised render.
 */
function overlapPixel(overlapOrder: AutoLayout['overlapOrder']): [number, number, number] {
  const file = emptyFile('Stack');
  const page = file.document.children[0]!;
  const frame = createFrameNode(null, 0, 0, 300, 100, { name: 'Row' });
  frame.autoLayout = {
    ...defaultAutoLayout('HORIZONTAL'),
    paddingTop: 0,
    paddingLeft: 0,
    paddingRight: 0,
    paddingBottom: 0,
    itemSpacing: -40,
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    ...(overlapOrder ? { overlapOrder } : {}),
  };
  const first = createRectNode(null, 0, 0, 100, 100);
  first.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
  const second = createRectNode(null, 0, 0, 100, 100);
  second.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 }];
  frame.children = [first, second];
  page.children = [frame];
  const placed = reflowTree(file.document);
  const placedFrame = findNode(placed, frame.id) as SceneNode;
  expect((placedFrame as { children: unknown[] }).children.length).toBe(2);
  const svg = renderSvgDocument({ ...file, document: placed }, [placedFrame]);
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: 300 } }).render();
  const at = (50 * rendered.width + 80) * 4;
  return [rendered.pixels[at]!, rendered.pixels[at + 1]!, rendered.pixels[at + 2]!];
}

describe('overlap order in a stack', () => {
  it('by default the later child is on top of the overlap', () => {
    expect(overlapPixel(undefined)).toEqual([0, 0, 255]);
    expect(overlapPixel('LATER_ON_TOP')).toEqual([0, 0, 255]);
  });

  it('set to earlier on top, the earlier child shows over the overlap', () => {
    expect(overlapPixel('EARLIER_ON_TOP')).toEqual([255, 0, 0]);
  });
});
