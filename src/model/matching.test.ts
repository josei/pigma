import { describe, expect, it } from 'vitest';
import { matchingLayerIds } from './matching';
import { createFrameNode, createRectNode } from './factory';
import { emptyFile } from './validate';
import type { PigmaFile, ShapeNode } from './types';

/** A page with one frame holding three rectangles (two named Card), and a rectangle named Card outside the frame. */
function scene() {
  const file: PigmaFile = emptyFile('Match');
  const page = file.document.children[0]!;
  const frame = createFrameNode(null, 0, 0, 400, 400);
  const first = createRectNode(null, 0, 0, 10, 10);
  first.name = 'Card';
  const second = createRectNode(null, 20, 0, 10, 10);
  second.name = 'Card';
  const other = createRectNode(null, 40, 0, 10, 10);
  other.name = 'Icon';
  frame.children = [first, second, other];
  const outside = createRectNode(null, 500, 0, 10, 10);
  outside.name = 'Card';
  page.children = [frame, outside];
  return { file, frame, first, second, other, outside };
}

describe('select all matching', () => {
  it('selects the layers with the same type and name inside the frame that holds the selection', () => {
    const { file, first, second } = scene();
    expect(matchingLayerIds(file, first.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('does not reach outside the holding frame, even for a matching name', () => {
    const { file, first, outside } = scene();
    expect(matchingLayerIds(file, first.id)).not.toContain(outside.id);
  });

  it('matches an instance by its component, not its name', () => {
    const { file, first, second, other } = scene();
    const frame = file.document.children[0]!.children[0]! as { children: ShapeNode[] };
    // Make the first and third layers instances of the same component, the second a plain rectangle.
    const asInstance = (node: ShapeNode, componentId: string) => ({ ...node, type: 'INSTANCE', componentId }) as unknown as ShapeNode;
    frame.children = [asInstance(first, 'comp-a'), second, asInstance(other, 'comp-a')];
    expect(matchingLayerIds(file, first.id).sort()).toEqual([first.id, other.id].sort());
  });

  it('a top-level selection searches the whole page, and an id that is not in the file matches nothing', () => {
    const { file, frame, outside, first, second } = scene();
    expect(matchingLayerIds(file, outside.id).sort()).toEqual([outside.id, first.id, second.id].sort());
    expect(matchingLayerIds(file, 'missing-id')).toEqual([]);
    expect(matchingLayerIds(file, frame.id)).toEqual([frame.id]);
  });
});
