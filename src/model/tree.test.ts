import { describe, expect, it } from 'vitest';
import {
  absoluteBounds,
  boundsOfNodes,
  descendants,
  findNode,
  findParent,
  findPath,
  hitTestBox,
  insertChild,
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
