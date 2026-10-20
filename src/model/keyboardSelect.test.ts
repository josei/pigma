import { describe, expect, it } from 'vitest';
import { createFrameNode, createRectNode } from './factory';
import { layersInRect } from './keyboardSelect';
import { emptyFile } from './validate';

function twoRects() {
  const file = emptyFile('Keyboard');
  const page = file.document.children[0]!;
  const left = createRectNode(null, 0, 0, 100, 100);
  const right = createRectNode(null, 300, 0, 100, 100);
  const hidden = { ...createRectNode(null, 0, 300, 100, 100), visible: false };
  page.children = [left, right, hidden];
  return { file, page, left, right, hidden };
}

describe('layersInRect', () => {
  it('selects the layers the box touches, by any part', () => {
    const { file, page, left } = twoRects();
    expect(layersInRect(file.document, page, { x: 90, y: 10, width: 20, height: 20 })).toEqual([left.id]);
  });

  it('selects nothing for a box that touches no layer', () => {
    const { file, page } = twoRects();
    expect(layersInRect(file.document, page, { x: 150, y: 150, width: 10, height: 10 })).toEqual([]);
  });

  it('skips hidden layers, as the marquee does', () => {
    const { file, page, hidden } = twoRects();
    expect(layersInRect(file.document, page, { x: 0, y: 290, width: 200, height: 120 })).not.toContain(hidden.id);
  });

  it('keeps child order across several layers', () => {
    const { file, page, left, right } = twoRects();
    expect(layersInRect(file.document, page, { x: 0, y: 0, width: 400, height: 100 })).toEqual([left.id, right.id]);
  });

  it('works inside a frame, with the frame children as the container', () => {
    const file = emptyFile('Frame');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 200, 200, { name: 'F' });
    const inner = createRectNode(null, 10, 10, 50, 50);
    frame.children = [inner];
    page.children = [frame];
    expect(layersInRect(file.document, frame, { x: 0, y: 0, width: 20, height: 20 })).toEqual([inner.id]);
  });
});
