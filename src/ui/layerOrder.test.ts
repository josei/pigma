import { describe, expect, it } from 'vitest';
import { layerRowOrder } from './layerOrder';
import type { SceneNode } from '../model/types';

/** A minimal layer: only the fields the order reads. */
const layer = (id: string, children?: SceneNode[]) => ({ id, children }) as unknown as SceneNode;

describe('layer row order', () => {
  it('lists the last child first, as the panel draws it', () => {
    expect(layerRowOrder([layer('a'), layer('b'), layer('c')], new Set())).toEqual(['c', 'b', 'a']);
  });

  it('lists a row\'s children under it only when the row is expanded', () => {
    const tree = [layer('frame', [layer('x'), layer('y')]), layer('top')];
    expect(layerRowOrder(tree, new Set())).toEqual(['top', 'frame']);
    expect(layerRowOrder(tree, new Set(['frame']))).toEqual(['top', 'frame', 'y', 'x']);
  });

  it('lists nested children in the same order at every depth', () => {
    const tree = [layer('outer', [layer('mid', [layer('p'), layer('q')])])];
    expect(layerRowOrder(tree, new Set(['outer', 'mid']))).toEqual(['outer', 'mid', 'q', 'p']);
  });
});
