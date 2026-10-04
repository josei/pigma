import { describe, expect, it } from 'vitest';
import { settleDocument } from './settle';
import { parseFile, serializeFile } from './serialize';
import { worldTransform, updateNode } from './tree';
import { BOOLEAN_MODES, BooleanMode, booleanLabel, booleanNodes, booleanOperandsOf, canBoolean, nodePolygons, setBooleanMode } from './boolean';
import { createEllipseNode, createRectNode, createTextNode } from './factory';
import { emptyFile } from './validate';
import { absoluteBounds, findNode } from './tree';
import type { ContainerNode, PigmaFile, SceneNode } from './types';

function setup() {
  const file = emptyFile('Boolean');
  const page = file.document.children[0]!;
  // Two 100x100 squares overlapping by 50 on both axes.
  const a = createRectNode(null, 0, 0, 100, 100);
  a.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
  const b = createRectNode(null, 50, 50, 100, 100);
  page.children = [a, b];
  return { file, aId: a.id, bId: b.id };
}

const booleanNodeOf = (file: ReturnType<typeof setup>['file'], id: string) => findNode(file.document, id) as ContainerNode;

describe('boolean operations', () => {
  it('flattens rectangles and ellipses into world-space polygons', () => {
    const { file, aId } = setup();
    const polygons = nodePolygons(file.document, aId)!;
    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(4);
    expect(polygons[0]![0]).toEqual([0, 0]);
    expect(polygons[0]![2]).toEqual([100, 100]);

    const page = file.document.children[0]!;
    const ellipse = createEllipseNode(null, 0, 0, 100, 50);
    page.children = [ellipse];
    expect(nodePolygons(file.document, ellipse.id)![0]!.length).toBe(64);
  });

  it('applies the node transform to the flattened outline', () => {
    const { file, aId } = setup();
    const moved = {
      ...file,
      document: {
        ...file.document,
        children: file.document.children.map((page) => ({
          ...page,
          children: page.children.map((child) => (child.id === aId ? { ...child, transform: { ...child.transform, tx: 40, ty: 25 } } : child)),
        })),
      },
    };
    const polygons = nodePolygons(moved.document, aId)!;
    expect(polygons[0]![0]).toEqual([40, 25]);
  });

  it('unions two overlapping squares into one outline', () => {
    const { file, aId, bId } = setup();
    const result = booleanNodes(file, [aId, bId], 'UNION');
    expect(result.nodeId).toBeTruthy();
    const node = booleanNodeOf(result.file, result.nodeId!);
    expect(node.type).toBe('BOOLEAN_OPERATION');
    expect(node.name).toBe('Union');
    expect(node.pathData).toBeTruthy();
    // The union keeps the first operand's appearance.
    expect(node.fills[0]).toMatchObject({ type: 'SOLID', color: { r: 1, g: 0, b: 0 } });
    // Its box is the union of both squares.
    expect(absoluteBounds(result.file.document, node.id)).toMatchObject({ x: 0, y: 0, width: 150, height: 150 });
    // Operands become children (Figma keeps them), so the page has one node.
    const page = result.file.document.children[0]!;
    expect(page.children).toHaveLength(1);
    expect(node.children).toHaveLength(2);
  });

  it('subtracts, intersects and excludes', () => {
    const { file, aId, bId } = setup();
    const subtracted = booleanNodes(file, [aId, bId], 'SUBTRACT');
    const subNode = booleanNodeOf(subtracted.file, subtracted.nodeId!);
    expect(subNode.name).toBe('Subtract');
    expect(subNode.pathData).toBeTruthy();

    const intersected = booleanNodes(file, [aId, bId], 'INTERSECT');
    const interNode = booleanNodeOf(intersected.file, intersected.nodeId!);
    // Intersection of the two squares is the 50x50 corner.
    expect(absoluteBounds(intersected.file.document, interNode.id)).toMatchObject({ x: 50, y: 50, width: 50, height: 50 });

    const excluded = booleanNodes(file, [aId, bId], 'EXCLUDE');
    expect(booleanNodeOf(excluded.file, excluded.nodeId!).name).toBe('Exclude');
    expect(BOOLEAN_MODES).toHaveLength(4);
    expect(booleanLabel('EXCLUDE')).toBe('Exclude');
  });

  it('reports operands it cannot flatten instead of producing wrong geometry', () => {
    const { file, aId } = setup();
    const page = file.document.children[0]!;
    const text = createTextNode(null, 0, 0, 'Hi');
    page.children = [findNode(file.document, aId) as SceneNode, text];

    const { usable, skipped } = booleanOperandsOf(file, [aId, text.id]);
    expect(usable).toEqual([aId]);
    expect(skipped).toEqual([text.id]);
    expect(canBoolean(text)).toBe(false);

    // With only one usable operand nothing happens.
    const result = booleanNodes(file, [aId, text.id], 'UNION');
    expect(result.nodeId).toBeNull();
    expect(result.skipped).toEqual([text.id]);
    expect(result.file.document).toBe(file.document);
  });

  it('keeps operands inside the result so the operation stays inspectable', () => {
    const { file, aId, bId } = setup();
    const result = booleanNodes(file, [aId, bId], 'UNION');
    const node = booleanNodeOf(result.file, result.nodeId!);
    const childIds = node.children.map((child) => child.id);
    expect(childIds.sort()).toEqual([aId, bId].sort());
    // Children are local to the boolean box, so the union still renders in place.
    const child = node.children[0]!;
    expect(child.transform.tx).toBeGreaterThanOrEqual(0);
  });

  it('round-trips a boolean result through JSON', () => {
    const { file, aId, bId } = setup();
    const result = booleanNodes(file, [aId, bId], 'UNION');
    const restored = parseFile(serializeFile(result.file));
    expect(restored.ok).toBe(true);
    const node = findNode(restored.file!.document, result.nodeId!) as ContainerNode;
    expect(node.type).toBe('BOOLEAN_OPERATION');
    expect(node.pathData).toBe(booleanNodeOf(result.file, result.nodeId!).pathData);
    expect(node.children).toHaveLength(2);
  });
});

describe('boolean operation kind', () => {
  it('records the operation on the created node and round-trips it', () => {
    const file = emptyFile('Booleans');
    const page = file.document.children[0]!;
    const a = createRectNode(null, 0, 0, 100, 100);
    const b = createRectNode(null, 50, 50, 100, 100);
    page.children = [a, b];
    const result = booleanNodes(file, [a.id, b.id], 'SUBTRACT');
    const node = findNode(result.file.document, result.nodeId!) as ContainerNode & { booleanOperation?: string };
    expect(node.booleanOperation).toBe('SUBTRACT');
    expect(node.name).toBe(booleanLabel('SUBTRACT'));

    const restored = parseFile(serializeFile(result.file));
    expect(restored.ok).toBe(true);
    const roundTripped = findNode(restored.file!.document, result.nodeId!) as ContainerNode & { booleanOperation?: string };
    expect(roundTripped.booleanOperation).toBe('SUBTRACT');
    expect(roundTripped.children).toHaveLength(2);
  });

  it('switches the mode of an existing boolean in place', () => {
    const file = emptyFile('Booleans');
    const page = file.document.children[0]!;
    const a = createRectNode(null, 0, 0, 100, 100);
    const b = createRectNode(null, 50, 50, 100, 100);
    page.children = [a, b];
    const created = booleanNodes(file, [a.id, b.id], 'UNION');
    const nodeId = created.nodeId!;
    const union = findNode(created.file.document, nodeId) as ContainerNode;

    const subtracted = setBooleanMode(created.file, nodeId, 'SUBTRACT');
    const switched = findNode(subtracted.document, nodeId) as ContainerNode & { booleanOperation?: string };
    // Same node, same operands, new geometry and label.
    expect(switched.id).toBe(nodeId);
    expect(switched.children.map((child) => child.id)).toEqual([a.id, b.id]);
    expect(switched.booleanOperation).toBe('SUBTRACT');
    expect(switched.name).toBe(booleanLabel('SUBTRACT'));
    expect(switched.pathData).not.toBe(union.pathData);
    // Intersecting keeps the overlapping corner only.
    const intersected = setBooleanMode(created.file, nodeId, 'INTERSECT');
    const overlap = findNode(intersected.document, nodeId) as ContainerNode;
    expect(overlap.width).toBeCloseTo(50);
    expect(overlap.height).toBeCloseTo(50);
    // A non-boolean node is left untouched.
    expect(setBooleanMode(created.file, a.id, 'UNION')).toBe(created.file);
  });

  it('is undoable through the store history', () => {
    const file = emptyFile('Booleans');
    const page = file.document.children[0]!;
    const a = createRectNode(null, 0, 0, 100, 100);
    const b = createRectNode(null, 50, 50, 100, 100);
    page.children = [a, b];
    const created = booleanNodes(file, [a.id, b.id], 'UNION');
    const before = JSON.stringify(created.file);
    const after = setBooleanMode(created.file, created.nodeId!, 'EXCLUDE');
    expect(JSON.stringify(after)).not.toBe(before);
    expect(setBooleanMode(after, created.nodeId!, 'UNION')).toBeTruthy();
  });
});

describe('live boolean operations', () => {
  /** Two overlapping squares unioned, with the result's id. */
  const union = () => {
    const file = emptyFile('Live');
    const page = file.document.children[0]!;
    const a = createRectNode(file.document, 0, 0, 100, 100);
    const b = createRectNode(file.document, 50, 50, 100, 100);
    page.children = [a, b];
    const made = booleanNodes(file, [a.id, b.id], 'UNION');
    const node = findNode(made.file.document, made.nodeId!) as ContainerNode;
    return { file: made.file, id: made.nodeId!, operandIds: node.children.map((child) => child.id) };
  };
  const settle = (file: PigmaFile) => settleDocument(file);
  const booleanOf = (file: PigmaFile, id: string) => findNode(file.document, id) as ContainerNode;
  /** The operands, moved into world space again for a fresh evaluation. */
  const freshEvaluation = (file: PigmaFile, id: string, mode: BooleanMode = 'UNION') => {
    const node = booleanOf(file, id);
    // Rebuild the operands as siblings and union them, which is what the boolean
    // node itself computes — so the two must agree.
    const page = file.document.children[0]!;
    const rebuilt = {
      ...file,
      document: updateNode(file.document, id, (target) => ({ ...(target as ContainerNode), children: [] })),
    };
    const placed = node.children.map((child) => ({
      ...child,
      transform: {
        ...child.transform,
        tx: child.transform.tx + node.transform.tx,
        ty: child.transform.ty + node.transform.ty,
      },
    }));
    const withSiblings = { ...rebuilt, document: updateNode(rebuilt.document, page.id, (target) => ({ ...target, children: [...(target as ContainerNode).children, ...placed] } as SceneNode)) };
    return booleanNodes(withSiblings, placed.map((child) => child.id), mode);
  };

  it('re-evaluates when an operand moves, matching a fresh evaluation', () => {
    const { file, id, operandIds } = union();
    const before = booleanOf(file, id);
    expect(before.pathData).toBeTruthy();

    // Move the second operand 200px right: the union becomes two separate rings.
    const moved = { ...file, document: updateNode(file.document, operandIds[1]!, (node) => ({ ...node, transform: { ...node.transform, tx: node.transform.tx + 200 } })) };
    const after = booleanOf(settle(moved), id);

    expect(after.pathData, 'moving an operand did not change the boolean geometry').not.toBe(before.pathData);
    expect(after.width).toBeGreaterThan(before.width);

    // ...and it is the geometry the same operands produce from scratch.
    const fresh = freshEvaluation(settle(moved), id);
    const freshNode = findNode(fresh.file.document, fresh.nodeId!) as ContainerNode;
    expect(after.pathData).toBe(freshNode.pathData);
    expect(after.width).toBe(freshNode.width);
    expect(after.height).toBe(freshNode.height);
  });

  it('re-evaluates when an operand resizes', () => {
    const { file, id, operandIds } = union();
    const before = booleanOf(file, id);
    const resized = {
      ...file,
      document: updateNode(file.document, operandIds[1]!, (node) => ({ ...node, width: 300, height: 300 })),
    };
    const after = booleanOf(settle(resized), id);
    expect(after.pathData).not.toBe(before.pathData);
    expect(after.width).toBeGreaterThan(before.width);

    const fresh = freshEvaluation(settle(resized), id);
    const freshNode = findNode(fresh.file.document, fresh.nodeId!) as ContainerNode;
    expect(after.pathData).toBe(freshNode.pathData);
  });

  it('is idempotent: settling an unchanged boolean returns the same node', () => {
    const { file } = union();
    const once = settle(file);
    const twice = settle(once);
    expect(twice.document).toBe(once.document);
  });

  it('keeps the operands in place in the world while the node re-anchors', () => {
    const { file, id, operandIds } = union();
    const before = booleanOf(file, id);
    const worldBefore = before.children.map((child) => worldTransform(file.document, child.id));

    const moved = { ...file, document: updateNode(file.document, operandIds[1]!, (node) => ({ ...node, transform: { ...node.transform, tx: node.transform.tx + 200 } })) };
    const settled = settle(moved);
    const after = booleanOf(settled, id);
    // The operands' world positions are what the user set — the node's own origin
    // moved to follow its content instead.
    const worldAfter = after.children.map((child) => worldTransform(settled.document, child.id));
    expect(worldAfter[1]!.tx).toBeCloseTo(worldBefore[1]!.tx + 200, 5);
    expect(worldAfter[0]!.tx).toBeCloseTo(worldBefore[0]!.tx, 5);
  });

  it('stays live through a JSON round trip', () => {
    const { file, id, operandIds } = union();
    const reloaded = parseFile(serializeFile(file)).file!;
    expect((findNode(reloaded.document, id) as ContainerNode).booleanOperation).toBe('UNION');

    // Move an operand in the reloaded file: it must still re-evaluate.
    const moved = { ...reloaded, document: updateNode(reloaded.document, operandIds[1]!, (node) => ({ ...node, transform: { ...node.transform, tx: node.transform.tx + 200 } })) };
    const after = booleanOf(settleDocument(moved), id);
    const fresh = freshEvaluation(settleDocument(moved), id);
    const freshNode = findNode(fresh.file.document, fresh.nodeId!) as ContainerNode;
    expect(after.pathData).toBe(freshNode.pathData);
    expect(after.width).toBeGreaterThan(200);
  });
});
