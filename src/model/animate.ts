import type { PigmaFile, SceneNode, Transform } from './types';
import { boundsOf, invert, multiply } from './matrix';
import { findNode, worldTransform } from './tree';

/**
 * Smart animate (M12).
 *
 * On navigation, layers that exist in both frames are matched by name and type,
 * and the destination's copy starts at the origin frame's geometry so a CSS
 * transition can move it into place. Everything else simply appears.
 *
 * The matching itself is pure data, so it is unit tested without a browser.
 */

export interface LayerMatch {
  fromId: string;
  toId: string;
  /** Absolute transform of the layer in the origin frame. */
  fromMatrix: Transform;
  /** Absolute transform of the layer in the destination frame. */
  toMatrix: Transform;
  /** Matrices expressed relative to each frame's origin, ready for rendering. */
  fromRelative: Transform;
  toRelative: Transform;
}

export interface SmartAnimatePlan {
  matches: LayerMatch[];
  duration: number;
  easing: string;
}

export const SMART_ANIMATE_DEFAULT = { duration: 300, easing: 'ease-in-out' };

/**
 * Layers eligible for animation: the frame's direct children. Nested layers are
 * skipped because their transforms are parent-relative, so animating them would
 * need per-parent matching (documented limitation).
 */
function layersOf(frame: SceneNode): SceneNode[] {
  return 'children' in frame && Array.isArray(frame.children) ? (frame.children as SceneNode[]) : [];
}

/** Plan the animation between two frames of the same file. */
export function planSmartAnimate(
  file: PigmaFile,
  fromFrameId: string,
  toFrameId: string,
  options: { duration?: number; easing?: string } = {},
): SmartAnimatePlan {
  const fromFrame = findNode(file.document, fromFrameId);
  const toFrame = findNode(file.document, toFrameId);
  const plan: SmartAnimatePlan = {
    matches: [],
    duration: options.duration ?? SMART_ANIMATE_DEFAULT.duration,
    easing: options.easing ?? SMART_ANIMATE_DEFAULT.easing,
  };
  if (!fromFrame || !toFrame || fromFrame.id === toFrame.id) return plan;

  const fromLayers = new Map<string, SceneNode>();
  for (const layer of layersOf(fromFrame as SceneNode)) {
    fromLayers.set(`${layer.type}:${layer.name}`, layer);
  }

  const toFrameMatrix = invert(worldTransform(file.document, toFrameId));
  for (const target of layersOf(toFrame as SceneNode)) {
    const source = fromLayers.get(`${target.type}:${target.name}`);
    if (!source) continue;
    plan.matches.push({
      fromId: source.id,
      toId: target.id,
      fromMatrix: worldTransform(file.document, source.id),
      toMatrix: worldTransform(file.document, target.id),
      // Both matrices are expressed inside the destination frame: the layer
      // starts where it was in the origin frame and transitions into place.
      fromRelative: multiply(toFrameMatrix, worldTransform(file.document, source.id)),
      toRelative: multiply(toFrameMatrix, worldTransform(file.document, target.id)),
    });
  }
  return plan;
}

/** True when two matrices differ enough to be worth animating. */
export function matrixChanged(a: Transform, b: Transform, epsilon = 0.01): boolean {
  return (
    Math.abs(a.a - b.a) > epsilon ||
    Math.abs(a.b - b.b) > epsilon ||
    Math.abs(a.c - b.c) > epsilon ||
    Math.abs(a.d - b.d) > epsilon ||
    Math.abs(a.tx - b.tx) > epsilon ||
    Math.abs(a.ty - b.ty) > epsilon
  );
}

/** Content size of a frame's children, used by prototype scrolling. */
export function contentSize(frame: SceneNode): { width: number; height: number } {
  if (!('children' in frame) || !Array.isArray(frame.children) || frame.children.length === 0) {
    return { width: frame.width, height: frame.height };
  }
  let width = frame.width;
  let height = frame.height;
  for (const child of frame.children as SceneNode[]) {
    const box = boundsOf(child.transform, child.width, child.height);
    width = Math.max(width, box.x + box.width);
    height = Math.max(height, box.y + box.height);
  }
  return { width: Math.ceil(width), height: Math.ceil(height) };
}
