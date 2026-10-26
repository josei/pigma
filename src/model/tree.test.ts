import { describe, expect, it } from 'vitest';
import {
  absoluteBounds,
  boundsOfNodes,
  descendants,
  findNode,
  findParent,
  findPath,
  hitTestBox,
  innermostFrameAt,
  insertChild,
  hitTestChild,
  layersUnderPoint,
  isDescendant,
  moveNode,
  nodeMap,
  parentAndIndex,
  removeNode,
  updateNode,
  walk,
  worldTransform,
} from './tree';
import { createFrameNode, createRectNode, createTextNode } from './factory';
import { fromTRS, multiply, applyToPoint } from './matrix';
import { emptyFile } from './validate';
import type { SceneNode } from './types';

function sampleFile() {
  const file = emptyFile('Tree');
  const page = file.document.children[0]!;
  const frame = createFrameNode(null, 100, 50, 400, 300, { name: 'Frame' });
  const rect = createRectNode(null, 20, 30, 100, 80);
  const nested = createFrameNode(null, 10, 10, 100, 100, { name: 'Nested' });
  const text = createTextNode(null, 5, 5, 'Hi');
  nested.children = [text];
  frame.children = [rect, nested];
  page.children = [frame];
  return { file, pageId: page.id, frameId: frame.id, rectId: rect.id, nestedId: nested.id, textId: text.id };
}

describe('tree operations', () => {
  it('finds nodes, parents and paths', () => {
    const { file, frameId, rectId, textId } = sampleFile();
    expect(findNode(file.document, rectId)?.id).toBe(rectId);
    expect(findParent(file.document, rectId)?.id).toBe(frameId);
    expect(findPath(file.document, textId)?.map((node) => node.id)).toHaveLength(5);
    expect(findNode(file.document, 'missing')).toBeNull();
  });

  it('walks the whole tree and indexes it', () => {
    const { file } = sampleFile();
    const visited: string[] = [];
    walk(file.document, (node) => visited.push(node.id));
    // DOCUMENT, PAGE, FRAME, RECTANGLE, NESTED, TEXT
    expect(visited).toHaveLength(6);
    expect(nodeMap(file.document).size).toBe(6);
    // The page holds a frame, a rectangle, a nested frame and a text node.
    expect(descendants(findNode(file.document, file.document.children[0]!.id)!).length).toBe(4);
  });

  it('shares structure for untouched branches on update', () => {
    const { file, rectId, nestedId } = sampleFile();
    const before = findNode(file.document, nestedId);
    const updated = updateNode(file.document, rectId, (node) => ({ ...node, name: 'Renamed' }) as typeof node);
    expect(findNode(updated, rectId)?.name).toBe('Renamed');
    expect(findNode(updated, nestedId)).toBe(before);
    expect(updated).not.toBe(file.document);
  });

  it('inserts, removes and reports parent indices', () => {
    const { file, pageId, frameId } = sampleFile();
    const extra = createRectNode(null, 0, 0, 10, 10);
    const withExtra = insertChild(file.document, frameId, extra, 0);
    expect(parentAndIndex(withExtra, extra.id)?.index).toBe(0);
    const removed = removeNode(withExtra, extra.id);
    expect(removed.removed?.id).toBe(extra.id);
    expect(findNode(removed.root, extra.id)).toBeNull();
    expect(findNode(removed.root, pageId)).not.toBeNull();
  });

  it('refuses to remove pages or the document', () => {
    const { file, pageId } = sampleFile();
    expect(removeNode(file.document, pageId).removed).toBeNull();
    expect(removeNode(file.document, file.document.id).removed).toBeNull();
  });

  it('keeps a node in place when reparented', () => {
    const { file, rectId, nestedId } = sampleFile();
    const before = absoluteBounds(file.document, rectId);
    const moved = moveNode(file.document, rectId, nestedId);
    const after = absoluteBounds(moved, rectId);
    expect(after?.x).toBeCloseTo(before!.x);
    expect(after?.y).toBeCloseTo(before!.y);
    expect(findParent(moved, rectId)?.id).toBe(nestedId);
  });

  it('accumulates parent transforms for world coordinates', () => {
    const { file, frameId, rectId } = sampleFile();
    const world = worldTransform(file.document, rectId);
    expect(world.tx).toBeCloseTo(120);
    expect(world.ty).toBeCloseTo(80);

    const rotated = updateNode(file.document, frameId, (node) => ({ ...node, transform: fromTRS(100, 50, 90) }) as typeof node);
    const rotatedWorld = worldTransform(rotated, rectId);
    const point = applyToPoint(rotatedWorld, 0, 0);
    const expected = applyToPoint(fromTRS(100, 50, 90), 20, 30);
    expect(point.x).toBeCloseTo(expected.x);
    expect(point.y).toBeCloseTo(expected.y);
  });

  it('detects ancestry and hit tests rotated boxes', () => {
    const { file, frameId, nestedId } = sampleFile();
    expect(isDescendant(file.document, frameId, nestedId)).toBe(true);
    expect(isDescendant(file.document, nestedId, frameId)).toBe(false);

    const node = createRectNode(null, 0, 0, 100, 20);
    const space = fromTRS(50, 50, 90);
    expect(hitTestBox(node, space, 50, 60)).toBe(true);
    expect(hitTestBox(node, space, 50, 200)).toBe(false);
    // Local (50, 10) on the rotated node maps to world (40, 100).
    expect(hitTestBox(node, multiply(space, fromTRS(0, 0, 0)), 40, 100)).toBe(true);
    expect(hitTestBox(node, multiply(space, fromTRS(0, 0, 0)), 90, 50)).toBe(false);
  });

  it('unions bounds across nodes', () => {
    const { file, rectId, frameId } = sampleFile();
    const bounds = boundsOfNodes(file.document, [rectId, frameId]);
    expect(bounds).toEqual({ x: 100, y: 50, width: 400, height: 300 });
  });
});

describe('innermostFrameAt', () => {
  function nestedFrames(innerLocked = false) {
    const file = emptyFile('Nested');
    const page = file.document.children[0]!;
    const outer = createFrameNode(null, 0, 0, 400, 400, { name: 'Outer' });
    const inner = createFrameNode(null, 50, 50, 100, 100, { name: 'Inner' });
    outer.children = [{ ...inner, locked: innerLocked }];
    page.children = [outer];
    return { file, outerId: outer.id, innerId: inner.id };
  }

  it('returns the innermost frame under the point, not the outer frame that holds it', () => {
    const { file, innerId } = nestedFrames();
    expect(innermostFrameAt(file.document, file.document.children[0]!.id, 100, 100)).toBe(innerId);
  });

  it('returns the outer frame when the point is in it but outside the inner one', () => {
    const { file, outerId } = nestedFrames();
    expect(innermostFrameAt(file.document, file.document.children[0]!.id, 20, 20)).toBe(outerId);
  });

  it('returns null when no frame is under the point', () => {
    const { file } = nestedFrames();
    expect(innermostFrameAt(file.document, file.document.children[0]!.id, 900, 900)).toBeNull();
  });

  it('skips a locked frame with its children, so the outer frame takes the shape', () => {
    const { file, outerId } = nestedFrames(true);
    expect(innermostFrameAt(file.document, file.document.children[0]!.id, 100, 100)).toBe(outerId);
  });

  it('ignores shapes that are not frames', () => {
    const file = emptyFile('Shape');
    const page = file.document.children[0]!;
    page.children = [createRectNode(null, 0, 0, 100, 100)];
    expect(innermostFrameAt(file.document, page.id, 50, 50)).toBeNull();
  });
});

describe('layersUnderPoint', () => {
  function layered() {
    const file = emptyFile('Layers');
    const page = file.document.children[0]!;
    const back = { ...createRectNode(null, 0, 0, 100, 100), name: 'Back' };
    const front = { ...createRectNode(null, 0, 0, 100, 100), name: 'Front' };
    const far = { ...createRectNode(null, 300, 300, 50, 50), name: 'Far' };
    page.children = [back, front, far];
    return { file, pageId: page.id, backId: back.id, frontId: front.id };
  }

  it('lists the layers under the point topmost first, in the Layers-panel order', () => {
    const { file, pageId, frontId, backId } = layered();
    const names = layersUnderPoint(file.document, pageId, 50, 50).map((layer) => layer.id);
    expect(names).toEqual([frontId, backId]);
  });

  it('leaves out a layer the point is not inside', () => {
    const { file, pageId } = layered();
    expect(layersUnderPoint(file.document, pageId, 320, 320).map((layer) => layer.name)).toEqual(['Far']);
  });

  it('leaves out a hidden layer', () => {
    const { file, pageId, frontId } = layered();
    const page = file.document.children[0]!;
    page.children = page.children.map((child) => (child.id === frontId ? { ...child, visible: false } : child));
    expect(layersUnderPoint(file.document, pageId, 50, 50).map((layer) => layer.name)).toEqual(['Back']);
  });

  it('keeps a locked layer and marks it locked', () => {
    const { file, pageId, frontId } = layered();
    const page = file.document.children[0]!;
    page.children = page.children.map((child) => (child.id === frontId ? { ...child, locked: true } : child));
    const front = layersUnderPoint(file.document, pageId, 50, 50)[0]!;
    expect(front).toMatchObject({ name: 'Front', locked: true });
  });

  it('lists a frame and then its children one level deeper, when the point is inside the frame', () => {
    const file = emptyFile('Nested');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 200, 200, { name: 'Frame' });
    const child = { ...createRectNode(null, 10, 10, 50, 50), name: 'Child' };
    frame.children = [child];
    page.children = [frame];
    const rows = layersUnderPoint(file.document, page.id, 20, 20);
    expect(rows.map((row) => [row.name, row.depth])).toEqual([
      ['Frame', 0],
      ['Child', 1],
    ]);
  });

  it('does not reach a child through a frame the point is outside', () => {
    const file = emptyFile('Clipped');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 100, 100, { name: 'Frame' });
    const child = { ...createRectNode(null, 120, 120, 50, 50), name: 'Outside' };
    frame.children = [child];
    page.children = [frame];
    expect(layersUnderPoint(file.document, page.id, 130, 130)).toEqual([]);
  });
});

describe('hit testing follows the paint order of a stack', () => {
  /** A frame holding two rectangles that overlap at x 40 to 100, the second drawn last. */
  function stack(overlapOrder?: 'LATER_ON_TOP' | 'EARLIER_ON_TOP', withMask = false) {
    const file = emptyFile('Stack');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 300, 100, { name: 'Row' });
    frame.autoLayout = { layoutMode: 'HORIZONTAL', ...(overlapOrder ? { overlapOrder } : {}) } as typeof frame.autoLayout;
    const first = createRectNode(null, 0, 0, 100, 100);
    first.name = 'First';
    const second = createRectNode(null, 40, 0, 100, 100);
    second.name = 'Second';
    const kids: SceneNode[] = [first, second];
    if (withMask) {
      const mask = createRectNode(null, 0, 0, 10, 10);
      mask.isMask = true;
      kids.push(mask);
    }
    frame.children = kids;
    page.children = [frame];
    return { file, frameId: frame.id, firstId: first.id, secondId: second.id };
  }

  it('by default a click on the overlap hits the later child, which is drawn on top', () => {
    const { file, frameId, secondId } = stack();
    expect(hitTestChild(file.document, frameId, 60, 50)?.id).toBe(secondId);
  });

  it('set to earlier on top, a click on the overlap hits the earlier child, which is the one drawn on top', () => {
    const { file, frameId, firstId } = stack('EARLIER_ON_TOP');
    expect(hitTestChild(file.document, frameId, 60, 50)?.id).toBe(firstId);
  });

  it('a stack that holds a mask keeps the child order, so the later child is still hit', () => {
    const { file, frameId, secondId } = stack('EARLIER_ON_TOP', true);
    expect(hitTestChild(file.document, frameId, 60, 50)?.id).toBe(secondId);
  });

  it('leaves out an excluded child, so a rotate press can reach the one behind it', () => {
    const { file, frameId, firstId, secondId } = stack();
    expect(hitTestChild(file.document, frameId, 60, 50, secondId)?.id).toBe(firstId);
  });
});

