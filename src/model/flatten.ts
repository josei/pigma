import type { ContainerNode, PigmaFile, SceneNode } from './types';
import { booleanNodes, booleanOperandsOf } from './boolean';
import { createRectNode } from './factory';
import { applyNodePatchToAll, ungroupNodes } from './ops';
import { findNode, insertChild, updateNode } from './tree';
import { hasChildren } from './types';
import { textOutline } from '../render/textOutline';

/** Why a flatten was refused, or the flattened layer. */
export type FlattenFrameResult = { file: PigmaFile; nodeId: string; reason?: undefined } | { file: PigmaFile; nodeId: null; reason: string };

/**
 * Flatten a frame into one path layer: the union of its shapes, clipped to the frame when
 * the frame clips its content, and given the frame's fill and stroke and name. The frame
 * itself is removed. Text children are flattened to their outlines (Inter Regular, see
 * textOutline.ts). Frames with groups, lines or empty text are refused.
 */
export function flattenFrameOp(file: PigmaFile, frameId: string): FlattenFrameResult {
  const refuse = (reason: string): FlattenFrameResult => ({ file, nodeId: null, reason });
  const frame = findNode(file.document, frameId);
  if (!frame || frame.type !== 'FRAME') return refuse('Select a frame to flatten');
  const container = frame as ContainerNode;
  if (container.children.length === 0) return refuse('The frame has no shapes to flatten');
  if (container.children.some((child) => hasChildren(child))) return refuse('A frame flattens when its children are shapes or text');

  // Text becomes its outline first, so it joins the union like any other shape.
  let current = file;
  for (const child of container.children) {
    if (child.type !== 'TEXT') continue;
    const outlined = outlineTextOp(current, child.id);
    if (!outlined) return refuse('A text layer in the frame is empty, so it has no outline');
    current = outlined;
  }
  const childIds = container.children.map((child) => child.id);
  const { usable } = booleanOperandsOf(current, childIds);
  if (usable.length !== childIds.length) return refuse('Every layer in the frame needs an outline (lines cannot be flattened)');

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
 * Replace a text layer with its outline as a vector, keeping its id and place in the
 * tree. `null` when the text has no glyphs to draw.
 */
export function outlineTextOp(file: PigmaFile, id: string): PigmaFile | null {
  const node = findNode(file.document, id);
  if (!node || node.type !== 'TEXT') return null;
  const pathData = textOutline(node);
  if (pathData === null) return null;
  const { characters: _characters, style: _style, ...rest } = node;
  const vector = { ...rest, type: 'VECTOR', pathData, windingRule: 'NONZERO' } as unknown as SceneNode;
  return { ...file, document: updateNode(file.document, id, () => vector) };
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
