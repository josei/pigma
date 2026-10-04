import { describe, expect, it } from 'vitest';
import {
  alignNodes,
  applyNodePatch,
  cloneSubtree,
  distributeNodes,
  duplicateNodes,
  frameSelection,
  groupNodes,
  instantiateClipboard,
  isEffectivelyVisible,
  positionNodes,
  reorderNodes,
  resizeFromHandle,
  scaleSelection,
  setNodeSize,
  setWorldPosition,
  setWorldRotation,
  translateWorld,
  ungroupNodes,
} from './ops';
import { createFrameNode, createGroupNode, createPolygonNode, createRectNode, createStarNode, createTextNode } from './factory';
import { absoluteBounds, findNode, findParent, parentAndIndex, updateNode } from './tree';
import { emptyFile } from './validate';
import { fromTRS, rotationOf } from './matrix';
import type { AnyNode, PigmaFile, SceneNode, ShapeNode } from './types';
import { hasChildren } from './types';

/** Narrow any node to a container for assertions. */
function container(node: AnyNode | null) {
  if (!node || !hasChildren(node)) throw new Error('expected a container node');
  return node;
}

function setup() {
  const file = emptyFile('Ops');
  const page = file.document.children[0]!;
  const a = createRectNode(null, 0, 0, 100, 100);
  const b = createRectNode(null, 200, 0, 100, 100);
  const c = createRectNode(null, 400, 0, 100, 50);
  page.children = [a, b, c];
  return { file, pageId: page.id, a: a.id, b: b.id, c: c.id };
}

describe('document operations', () => {
  it('translates nodes in world space', () => {
    const { file, a } = setup();
    const moved = translateWorld(file, [a], 25, -10);
    expect(absoluteBounds(moved.document, a)).toEqual({ x: 25, y: -10, width: 100, height: 100 });
  });

  it('translates correctly under a rotated parent', () => {
    const file = emptyFile('Rotated');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 400, 400, { name: 'Frame' });
    frame.transform = fromTRS(0, 0, 90);
    const child = createRectNode(null, 100, 0, 50, 50);
    frame.children = [child];
    page.children = [frame];
    // A +30 world-Y move becomes +30 on the parent's rotated X axis.
    const before = absoluteBounds(file.document, child.id)!;
    expect(before.x).toBeCloseTo(-50);
    expect(before.y).toBeCloseTo(100);
    const moved = translateWorld(file, [child.id], 0, 30);
    const after = absoluteBounds(moved.document, child.id)!;
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y + 30);
  });

  it('sets world position and rotation', () => {
    const { file, a } = setup();
    const positioned = setWorldPosition(file, a, 12, 34);
    expect(absoluteBounds(positioned.document, a)).toMatchObject({ x: 12, y: 34 });
    const rotated = setWorldRotation(positioned, a, 45);
    expect(rotationOf(findNode(rotated.document, a)!.transform)).toBeCloseTo(45);
  });

  it('resizes from a corner handle, anchoring the opposite corner', () => {
    const { file, a } = setup();
    const grown = resizeFromHandle(file, a, 'se', 40, 20);
    const node = findNode(grown.document, a)!;
    expect(node.width).toBeCloseTo(140);
    expect(node.height).toBeCloseTo(120);
    expect(absoluteBounds(grown.document, a)).toMatchObject({ x: 0, y: 0 });

    const shrunk = resizeFromHandle(file, a, 'nw', 30, 30);
    const shrunkBounds = absoluteBounds(shrunk.document, a)!;
    expect(shrunkBounds.x).toBeCloseTo(30);
    expect(shrunkBounds.y).toBeCloseTo(30);
    expect(shrunkBounds.width).toBeCloseTo(70);
    expect(shrunkBounds.height).toBeCloseTo(70);
  });

  it('keeps a minimum size and respects ratio locking', () => {
    const { file, a } = setup();
    const tiny = resizeFromHandle(file, a, 'se', -500, -500);
    expect(findNode(tiny.document, a)!.width).toBeGreaterThanOrEqual(1);

    const ratio = resizeFromHandle(file, a, 'se', 100, 0, { keepRatio: true });
    const node = findNode(ratio.document, a)!;
    expect(node.height).toBeCloseTo(node.width);
  });

  it('scales every node of a multi-selection about an anchor', () => {
    const { file, a, b } = setup();
    const scaled = scaleSelection(file, [a, b], { x: 0, y: 0 }, 2, 2);
    expect(absoluteBounds(scaled.document, a)).toMatchObject({ x: 0, y: 0, width: 200, height: 200 });
    expect(absoluteBounds(scaled.document, b)).toMatchObject({ x: 400, width: 200 });
  });

  it('moves nodes to explicit positions', () => {
    const { file, a, b } = setup();
    const moved = positionNodes(file, [
      { id: a, x: 5, y: 5 },
      { id: b, x: 15, y: 25 },
    ]);
    expect(absoluteBounds(moved.document, a)).toMatchObject({ x: 5, y: 5 });
    expect(absoluteBounds(moved.document, b)).toMatchObject({ x: 15, y: 25 });
  });

  it('sets size without moving the origin and follows child constraints', () => {
    const file = emptyFile('Resize');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 100, 100);
    const child = createRectNode(null, 0, 0, 100, 100);
    frame.children = [child];
    page.children = [frame];

    // Default constraints are MIN/MIN: the child keeps its box.
    const resized = setNodeSize(file, frame.id, 200, 200);
    const resizedChild = findNode(resized.document, child.id)!;
    expect(resizedChild.width).toBeCloseTo(100);
    expect(absoluteBounds(resized.document, frame.id)).toMatchObject({ x: 0, y: 0, width: 200, height: 200 });
  });

  it('applies STRETCH, MAX and SCALE constraints when a frame resizes', () => {
    const build = (constraints: { horizontal: 'MIN' | 'MAX' | 'STRETCH' | 'SCALE'; vertical: 'MIN' | 'MAX' | 'STRETCH' | 'SCALE' }) => {
      const file = emptyFile('Constraints');
      const page = file.document.children[0]!;
      const frame = createFrameNode(null, 0, 0, 200, 200, { name: 'Frame' });
      const child = createRectNode(null, 20, 20, 100, 60);
      child.constraints = constraints;
      frame.children = [child];
      page.children = [frame];
      const resized = setNodeSize(file, frame.id, 400, 400);
      return findNode(resized.document, child.id)!;
    };

    const stretched = build({ horizontal: 'STRETCH', vertical: 'STRETCH' });
    expect(stretched.width).toBeCloseTo(300);
    expect(stretched.height).toBeCloseTo(260);
    expect(stretched.transform.tx).toBeCloseTo(20);

    const maxed = build({ horizontal: 'MAX', vertical: 'MAX' });
    expect(maxed.width).toBeCloseTo(100);
    expect(maxed.transform.tx).toBeCloseTo(220);

    const scaled = build({ horizontal: 'SCALE', vertical: 'SCALE' });
    expect(scaled.width).toBeCloseTo(200);
    expect(scaled.height).toBeCloseTo(120);
    expect(scaled.transform.tx).toBeCloseTo(40);
  });

  it('still scales group contents proportionally', () => {
    const file = emptyFile('Group scale');
    const page = file.document.children[0]!;
    const group = createGroupNode([createRectNode(null, 0, 0, 100, 50)]);
    // groupNodes() sizes a group to its contents; do the same here.
    group.width = 100;
    group.height = 50;
    page.children = [group];
    const resized = setNodeSize(file, group.id, 200, 100);
    const child = findNode(resized.document, group.children[0]!.id)!;
    expect(child.width).toBeCloseTo(200);
    expect(child.height).toBeCloseTo(100);
  });

  it('applies flat patches for geometry and appearance', () => {
    const { file, a } = setup();
    const patched = applyNodePatch(file, a, { x: 50, y: 60, width: 30, opacity: 0.5, name: 'Patch' });
    const node = findNode(patched.document, a)!;
    expect(node.name).toBe('Patch');
    expect(node.opacity).toBe(0.5);
    expect(node.width).toBe(30);
    expect(absoluteBounds(patched.document, a)).toMatchObject({ x: 50, y: 60 });
  });

  it('ignores locked nodes and no-op patches', () => {
    const { file, a } = setup();
    const locked = applyNodePatch(file, a, { locked: true });
    expect(translateWorld(locked, [a], 10, 10).document).toBe(locked.document);
    expect(setNodeSize(locked, a, 5, 5).document).toBe(locked.document);
    expect(applyNodePatch(file, a, { opacity: 1 }).document).toBe(file.document);
  });

  it('duplicates a subtree with fresh ids and preserved geometry', () => {
    const { file, a, pageId } = setup();
    const { file: duplicated, newIds } = duplicateNodes(file, [a]);
    expect(newIds).toHaveLength(1);
    const copy = findNode(duplicated.document, newIds[0]!);
    expect(copy?.id).not.toBe(a);
    expect(findParent(duplicated.document, newIds[0]!)?.id).toBe(pageId);
    expect(absoluteBounds(duplicated.document, newIds[0]!)).toEqual(absoluteBounds(file.document, a));
  });

  it('clones nested subtrees with a complete id remap', () => {
    const file = emptyFile('Clone');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 100, 100);
    const child = createRectNode(null, 0, 0, 10, 10);
    frame.children = [child];
    page.children = [frame];
    const { node, idMap } = cloneSubtree(frame);
    expect(idMap.size).toBe(2);
    expect(container(node).children[0]!.id).not.toBe(child.id);
  });

  it('groups nodes into a real bounding box and ungroups them back', () => {
    const { file, a, b } = setup();
    const { file: grouped, groupId } = groupNodes(file, [a, b]);
    const group = findNode(grouped.document, groupId!)!;
    expect(group.type).toBe('GROUP');
    expect(group.width).toBeCloseTo(300);
    expect(group.height).toBeCloseTo(100);
    expect(absoluteBounds(grouped.document, groupId!)).toEqual({ x: 0, y: 0, width: 300, height: 100 });

    const { file: ungrouped } = ungroupNodes(grouped, [groupId!]);
    expect(findNode(ungrouped.document, groupId!)).toBeNull();
    expect(absoluteBounds(ungrouped.document, a)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(absoluteBounds(ungrouped.document, b)).toEqual({ x: 200, y: 0, width: 100, height: 100 });
  });

  it('groups nodes that live in different parents', () => {
    const file = emptyFile('Mixed');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 500, 0, 200, 200);
    const inside = createRectNode(null, 10, 10, 50, 50);
    frame.children = [inside];
    const outside = createRectNode(null, 0, 0, 50, 50);
    page.children = [frame, outside];

    const { file: grouped, groupId } = groupNodes(file, [inside.id, outside.id]);
    expect(groupId).toBeTruthy();
    const group = container(findNode(grouped.document, groupId!));
    expect(group.children).toHaveLength(2);
    expect(absoluteBounds(grouped.document, inside.id)).toEqual({ x: 510, y: 10, width: 50, height: 50 });
  });

  it('wraps a selection in a frame', () => {
    const { file, a, b } = setup();
    const { file: framed, frameId } = frameSelection(file, [a, b]);
    const frame = container(findNode(framed.document, frameId!));
    expect(frame.type).toBe('FRAME');
    expect(frame.width).toBeCloseTo(300);
    expect(frame.children).toHaveLength(2);
    expect(absoluteBounds(framed.document, a)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('reorders within the parent', () => {
    const { file, a, b, c } = setup();
    const order = (target: typeof file) => container(target.document.children[0]!).children.map((child) => child.id);

    expect(order(reorderNodes(file, [a], 'front'))).toEqual([b, c, a]);
    expect(order(reorderNodes(file, [c], 'back'))).toEqual([c, a, b]);
    expect(order(reorderNodes(file, [a], 'forward'))).toEqual([b, a, c]);
    expect(order(reorderNodes(file, [c], 'backward'))).toEqual([a, c, b]);
    expect(order(reorderNodes(file, [c], 'front'))).toEqual([a, b, c]);
  });

  it('aligns nodes to the selection box and to the parent', () => {
    const { file, a, b, c } = setup();
    const left = alignNodes(file, [a, b, c], 'left');
    expect(absoluteBounds(left.document, b)).toMatchObject({ x: 0 });
    expect(absoluteBounds(left.document, c)).toMatchObject({ x: 0 });

    const bottom = alignNodes(file, [a, b, c], 'bottom');
    expect(absoluteBounds(bottom.document, c)!.y).toBeCloseTo(50);

    // A lone node aligns inside its parent container; a page-level node has
    // no container to align to, so it stays put (Figma behaves the same way).
    expect(absoluteBounds(alignNodes(file, [b], 'left').document, b)).toMatchObject({ x: 200 });

    const nested = emptyFile('Nested');
    const nestedPage = nested.document.children[0]!;
    const frame = createFrameNode(null, 50, 50, 400, 400, { name: 'Frame' });
    const child = createRectNode(null, 200, 200, 100, 100);
    frame.children = [child];
    nestedPage.children = [frame];
    expect(absoluteBounds(alignNodes(nested, [child.id], 'left').document, child.id)).toMatchObject({ x: 50 });
    expect(absoluteBounds(alignNodes(nested, [child.id], 'top').document, child.id)).toMatchObject({ y: 50 });
  });

  it('distributes three or more nodes evenly', () => {
    const { file, a, b, c } = setup();
    const spread = distributeNodes(file, [a, b, c], 'horizontal');
    const first = absoluteBounds(spread.document, a)!;
    const second = absoluteBounds(spread.document, b)!;
    const third = absoluteBounds(spread.document, c)!;
    const gapOne = second.x - (first.x + first.width);
    const gapTwo = third.x - (second.x + second.width);
    expect(gapOne).toBeCloseTo(gapTwo);
    expect(distributeNodes(file, [a, b], 'horizontal').document).toBe(file.document);
  });

  it('pastes clipboard payloads with fresh ids under a parent', () => {
    const { file, a, pageId } = setup();
    const payload = [findNode(file.document, a) as SceneNode];
    const { file: pasted, newIds } = instantiateClipboard(file, payload, pageId);
    expect(newIds).toHaveLength(1);
    expect(newIds[0]).not.toBe(a);
    expect(parentAndIndex(pasted.document, newIds[0]!)?.parent.id).toBe(pageId);
  });

  it('remaps prototype destinations when duplicating linked nodes', () => {
    const file = emptyFile('Links');
    const page = file.document.children[0]!;
    const button = createRectNode(null, 0, 0, 10, 10);
    button.interactions = [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: button.id }] }];
    const target = createTextNode(null, 0, 0, 'target');
    page.children = [button, target];
    const { file: duplicated, newIds } = duplicateNodes(file, [button.id]);
    const copy = findNode(duplicated.document, newIds[0]!)!;
    expect(copy.interactions?.[0]?.actions[0]?.destinationId).toBe(newIds[0]);
  });
});

describe('positioning rotated nodes', () => {
  function rotated() {
    const file = emptyFile('Rotated');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 600, 600, { name: 'Rotated' });
    // 90 degrees: the box spans x-600..x and y..y+600 around the origin.
    frame.transform = fromTRS(1000, 1000, 90);
    page.children = [frame];
    return { file, frameId: frame.id };
  }

  it('positions by the axis-aligned box, not the raw origin', () => {
    const { file, frameId } = rotated();
    const before = absoluteBounds(file.document, frameId)!;
    expect(before.x).toBeCloseTo(400);
    expect(before.y).toBeCloseTo(1000);

    const moved = setWorldPosition(file, frameId, 460, 1040);
    const after = absoluteBounds(moved.document, frameId)!;
    expect(after.x).toBeCloseTo(460);
    expect(after.y).toBeCloseTo(1040);
    expect(after.width).toBeCloseTo(600);
    expect(after.height).toBeCloseTo(600);
  });

  it('moves a rotated node by exactly the drag delta', () => {
    const { file, frameId } = rotated();
    const before = absoluteBounds(file.document, frameId)!;
    const entries = [{ id: frameId, x: before.x + 60, y: before.y + 40 }];
    const moved = positionNodes(file, entries);
    const after = absoluteBounds(moved.document, frameId)!;
    expect(after.x - before.x).toBeCloseTo(60);
    expect(after.y - before.y).toBeCloseTo(40);
  });

  it('applies panel patches to the box coordinates of a rotated node', () => {
    const { file, frameId } = rotated();
    const patched = applyNodePatch(file, frameId, { x: 500, y: 900 });
    const bounds = absoluteBounds(patched.document, frameId)!;
    expect(bounds.x).toBeCloseTo(500);
    expect(bounds.y).toBeCloseTo(900);
  });

  it('keeps the anchor fixed when scaling a rotated selection', () => {
    const { file, frameId } = rotated();
    const before = absoluteBounds(file.document, frameId)!;
    const scaled = scaleSelection(file, [frameId], { x: before.x, y: before.y }, 2, 2);
    const after = absoluteBounds(scaled.document, frameId)!;
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(after.width).toBeCloseTo(1200);
  });

  it('round-trips a no-op position write without touching the document', () => {
    const { file, frameId } = rotated();
    const bounds = absoluteBounds(file.document, frameId)!;
    expect(setWorldPosition(file, frameId, bounds.x, bounds.y).document).toBe(file.document);
  });
});

describe('isEffectivelyVisible', () => {
  function scene() {
    const file = emptyFile('Visibility');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 200, 200, { name: 'Frame' });
    const group = createFrameNode(null, 0, 0, 100, 100, { name: 'Group' });
    group.type = 'GROUP';
    const rect = createRectNode(null, 0, 0, 50, 50);
    group.children = [rect];
    frame.children = [group];
    page.children = [frame];
    return { file, page, frame, group, rect };
  }

  it('walks the ancestor chain iteratively', () => {
    const { file, page, frame, group, rect } = scene();
    expect(isEffectivelyVisible(file.document, rect.id)).toBe(true);
    expect(isEffectivelyVisible(file.document, page.id)).toBe(true);
    expect(isEffectivelyVisible(file.document, file.document.id)).toBe(true);
    expect(isEffectivelyVisible(file.document, 'missing')).toBe(false);

    // Hiding any ancestor hides the descendant.
    const hiddenGroup = { ...file, document: updateNode(file.document, group.id, (node) => ({ ...node, visible: false }) as typeof node) };
    expect(isEffectivelyVisible(hiddenGroup.document, rect.id)).toBe(false);
    expect(isEffectivelyVisible(hiddenGroup.document, frame.id)).toBe(true);

    const hiddenFrame = { ...file, document: updateNode(file.document, frame.id, (node) => ({ ...node, visible: false }) as typeof node) };
    expect(isEffectivelyVisible(hiddenFrame.document, rect.id)).toBe(false);

    // The page itself is checked too, but the document's own flag is not.
    const hiddenPage = { ...file, document: updateNode(file.document, page.id, (node) => ({ ...node, visible: false }) as typeof node) };
    expect(isEffectivelyVisible(hiddenPage.document, rect.id)).toBe(false);
  });

  it('terminates when duplicate ids exist in the tree', () => {
    const { file, page, frame, group, rect } = scene();
    // Duplicate ids are only a warning in the validator, so the walk must not
    // follow a parent chain that can revisit the same id.
    rect.id = group.id;
    const document = updateNode(file.document, frame.id, (node) => ({ ...node, children: [group] }) as typeof node);
    const started = Date.now();
    const result = isEffectivelyVisible(document, group.id);
    expect(Date.now() - started).toBeLessThan(500);
    expect(typeof result).toBe('boolean');

    // A three-deep duplicate still resolves in one pass.
    const deep = { ...group, id: frame.id, children: [{ ...group, id: frame.id, children: [rect] }] };
    const nested = updateNode(document, page.id, (node) => ({ ...node, children: [deep] }) as typeof node);
    expect(isEffectivelyVisible(nested, frame.id)).toBe(true);
  });
});

describe('applyNodePatch type-gates polygon/star fields', () => {
  /** A page with one rectangle, one polygon and one star. */
  const scene = () => {
    const file = emptyFile('Gate');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 0, 0, 100, 100);
    const polygon = createPolygonNode(file.document, 140, 0, 100, 100);
    const star = createStarNode(file.document, 280, 0, 100, 100);
    page.children = [rect, polygon, star];
    return { file, rect, polygon, star };
  };
  const nodeIn = (file: PigmaFile, id: string) => findNode(file.document, id) as ShapeNode;

  it('ignores pointCount and innerRadius on a node that cannot carry them', () => {
    const { file, rect } = scene();
    const patched = applyNodePatch(file, rect.id, { pointCount: 8, innerRadius: 0.2, cornerRadius: 4 });

    const node = nodeIn(patched, rect.id);
    // The fields the type does own still apply...
    expect(node.cornerRadius).toBe(4);
    // ...and the ones it does not are dropped instead of stored.
    expect((node as { pointCount?: number }).pointCount).toBeUndefined();
    expect((node as { innerRadius?: number }).innerRadius).toBeUndefined();
    expect(patched).not.toBe(file);
  });

  it('still applies them to a polygon and a star', () => {
    const { file, polygon, star } = scene();
    const withPolygon = applyNodePatch(file, polygon.id, { pointCount: 7, innerRadius: 0.3 });
    expect(nodeIn(withPolygon, polygon.id).pointCount).toBe(7);
    expect(nodeIn(withPolygon, polygon.id).innerRadius).toBe(0.3);

    const withStar = applyNodePatch(withPolygon, star.id, { pointCount: 9, innerRadius: 0.25 });
    expect(nodeIn(withStar, star.id).pointCount).toBe(9);
    expect(nodeIn(withStar, star.id).innerRadius).toBe(0.25);
    // The rectangle is untouched by either edit.
    expect(nodeIn(withStar, file.document.children[0]!.children[0]!.id).pointCount).toBeUndefined();
  });

  it('is a no-op when those fields are the only thing a foreign node is patched with', () => {
    const { file, rect } = scene();
    const patched = applyNodePatch(file, rect.id, { pointCount: 12, innerRadius: 0.5 });
    // Nothing changed, so the file comes back as it was — the fields did not
    // sneak into the node and did not bump a revision.
    expect(patched.document.children[0]!.children[0]).toEqual(file.document.children[0]!.children[0]);
  });
});
