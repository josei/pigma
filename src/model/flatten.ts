import type { ContainerNode, PigmaFile, SceneNode } from './types';
import { booleanNodes, booleanOperandsOf } from './boolean';
import { createRectNode } from './factory';
import { applyNodePatchToAll, ungroupNodes } from './ops';
import { findNode, insertChild, updateNode } from './tree';
import { hasChildren } from './types';

/** Why a flatten was refused, or the flattened layer. */
export type FlattenFrameResult = { file: PigmaFile; nodeId: string; reason?: undefined } | { file: PigmaFile; nodeId: null; reason: string };

/**
 * Flatten a frame into one path layer: the union of its shapes, clipped to the frame when
 * the frame clips its content, and given the frame's fill and stroke and name. The frame
 * itself is removed. Frames whose children are not all outlined shapes are refused.
 */
export function flattenFrameOp(file: PigmaFile, frameId: string): FlattenFrameResult {
  const refuse = (reason: string): FlattenFrameResult => ({ file, nodeId: null, reason });
  const frame = findNode(file.document, frameId);
  if (!frame || frame.type !== 'FRAME') return refuse('Select a frame to flatten');
  const container = frame as ContainerNode;
  if (container.children.length === 0) return refuse('The frame has no shapes to flatten');
  if (container.children.some((child) => hasChildren(child))) return refuse('A frame flattens when its children are shapes');
  const childIds = container.children.map((child) => child.id);
  const { usable } = booleanOperandsOf(file, childIds);
  if (usable.length !== childIds.length) return refuse('Every shape in the frame needs an outline (text and lines cannot be flattened)');

  let current = file;
  let shapeId: string;
  if (usable.length === 1) {
    shapeId = usable[0]!;
  } else {
    const union = booleanNodes(current, usable, 'UNION');
    if (!union.nodeId) return refuse('Flatten could not be applied');
    current = union.file;
    shapeId = union.nodeId;
  }

  if (container.clipsContent) {
    // Clip to the frame: a rectangle the frame's size, inside the frame, intersected with the shape.
    const clip = createRectNode(current.document, 0, 0, container.width, container.height);
    current = { ...current, document: insertChild(current.document, frameId, clip) };
    const clipped = booleanNodes(current, [shapeId, clip.id], 'INTERSECT');
    if (!clipped.nodeId || clipped.empty) return refuse('The shapes lie outside the frame, so nothing is left to flatten');
    current = clipped.file;
    shapeId = clipped.nodeId;
  }

  // The flattened layer takes the frame's paint and name, and replaces the frame.
  current = applyNodePatchToAll(current, [shapeId], {
    fills: container.fills,
    strokes: container.strokes,
    strokeWeight: container.strokeWeight,
    name: container.name,
  });
  current = toVectorOp(current, shapeId);
  const lifted = ungroupNodes(current, [frameId]);
  return { file: lifted.file, nodeId: shapeId };
}

/**
 * Make a flattened boolean static: its path becomes a vector layer with no operands, so
 * nothing re-evaluates it. A boolean keeps its operands and is live; flatten is the point
 * at which the user asks for the outline to stop depending on them.
 */
export function toVectorOp(file: PigmaFile, id: string): PigmaFile {
  const node = findNode(file.document, id);
  if (!node || node.type !== 'BOOLEAN_OPERATION' || !node.pathData) return file;
  const { children: _children, booleanOperation: _mode, clipsContent: _clips, ...rest } = node as ContainerNode;
  const vector = { ...rest, type: 'VECTOR' } as unknown as SceneNode;
  return { ...file, document: updateNode(file.document, id, () => vector) };
}
