import type { Tool } from '../store/editorStore';
import type { Node, NodeType, SceneNode } from './types';
import { createEllipseNode, createFrameNode, createPolygonNode, createRectNode, createStarNode } from './factory';

/**
 * What each drawing tool creates, in one exhaustive table.
 *
 * The canvas branches on this instead of on the tool name, so there is exactly
 * one place that says "the Polygon tool makes a POLYGON": the table below. It is
 * typed with no `default` branch, which means adding a tool to the `Tool` union
 * without deciding what it creates is a compile error rather than a silent
 * fall-through to a rectangle.
 *
 * The bespoke creators (text, section, line, pen) keep their own code — they do
 * more than call a factory — but they are still named here, so a test can walk
 * every tool and see which path it takes.
 */
export type ToolDraw =
  /** A drag creates a shape through `factory`. */
  | {
      kind: 'shape';
      nodeType: NodeType;
      factory: (root: Node | null, x: number, y: number, width: number, height: number) => SceneNode;
    }
  /** A drag (or a click) creates an empty text layer and starts editing it. */
  | { kind: 'text' }
  /** A drag creates a page-level section, which never nests into a frame. */
  | { kind: 'section' }
  /** A drag creates a line from start to end, rotated to its angle. */
  | { kind: 'line' }
  /** The pen builds a path from clicked anchors; the drag-create path does nothing. */
  | { kind: 'path' }
  /** No node creation: selection, panning, comments. */
  | { kind: 'none' };

export function toolDraw(tool: Tool): ToolDraw {
  switch (tool) {
    case 'rect':
      return { kind: 'shape', nodeType: 'RECTANGLE', factory: createRectNode };
    case 'ellipse':
      return { kind: 'shape', nodeType: 'ELLIPSE', factory: createEllipseNode };
    case 'polygon':
      return { kind: 'shape', nodeType: 'POLYGON', factory: createPolygonNode };
    case 'star':
      return { kind: 'shape', nodeType: 'STAR', factory: createStarNode };
    case 'frame':
      return { kind: 'shape', nodeType: 'FRAME', factory: createFrameNode };
    case 'text':
      return { kind: 'text' };
    case 'section':
      return { kind: 'section' };
    case 'line':
      return { kind: 'line' };
    case 'pen':
      return { kind: 'path' };
    case 'select':
    case 'hand':
    case 'comment':
      return { kind: 'none' };
  }
}

/** Every tool that creates a node by dragging on the canvas. */
export function createsOnDrag(tool: Tool): boolean {
  return toolDraw(tool).kind !== 'none' && toolDraw(tool).kind !== 'path';
}
