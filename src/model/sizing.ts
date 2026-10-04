import type { AnyNode, PigmaFile, SceneNode } from './types';
import { updateNode } from './tree';

/**
 * Min/max sizing (M10).
 *
 * Figma lets a layer declare size limits: they clamp what a resize handle, a
 * typed size, a HUG/FILL auto-layout frame or a constraint can produce. The
 * limits are pure data on the node (`minWidth`, `maxWidth`, `minHeight`,
 * `maxHeight`) and the rules live here so every producer clamps identically.
 */

export interface SizeLimits {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ResolvedLimits {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

/** Figma's implicit minimum: 1 unit, except lines which may collapse to 0. */
export function defaultMinimum(node: AnyNode): { width: number; height: number } {
  if (node.type === 'LINE') return { width: 1, height: 0 };
  if (node.type === 'DOCUMENT' || node.type === 'CANVAS') return { width: 0, height: 0 };
  return { width: 1, height: 1 };
}

/** Limits with the implicit defaults applied; `Infinity` means "no maximum". */
export function limitsOf(node: AnyNode): ResolvedLimits {
  const implicit = defaultMinimum(node);
  const source = node as SceneNode & SizeLimits;
  const minWidth = Math.max(implicit.width, number(source.minWidth, implicit.width));
  const minHeight = Math.max(implicit.height, number(source.minHeight, implicit.height));
  const maxWidth = Math.max(minWidth, number(source.maxWidth, Number.POSITIVE_INFINITY));
  const maxHeight = Math.max(minHeight, number(source.maxHeight, Number.POSITIVE_INFINITY));
  return { minWidth, minHeight, maxWidth, maxHeight };
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clampWidth(limits: ResolvedLimits, width: number): number {
  return Math.min(limits.maxWidth, Math.max(limits.minWidth, width));
}

export function clampHeight(limits: ResolvedLimits, height: number): number {
  return Math.min(limits.maxHeight, Math.max(limits.minHeight, height));
}

/** Clamp a box to the node's limits, keeping whichever value is already legal. */
export function clampSize(node: AnyNode, width: number, height: number): { width: number; height: number } {
  const limits = limitsOf(node);
  return { width: clampWidth(limits, width), height: clampHeight(limits, height) };
}

/** True when the node declares any explicit limit. */
export function hasSizeLimits(node: AnyNode): boolean {
  const source = node as SceneNode & SizeLimits;
  return (
    source.minWidth !== undefined ||
    source.minHeight !== undefined ||
    source.maxWidth !== undefined ||
    source.maxHeight !== undefined
  );
}

/** Snap an existing node's size back inside its limits (used after edits). */
export function enforceLimits(file: PigmaFile, id: string): PigmaFile {
  const document = updateNode(file.document, id, (target) => {
    if (target.type === 'DOCUMENT' || target.type === 'CANVAS') return target;
    if (!hasSizeLimits(target)) return target;
    const clamped = clampSize(target, target.width, target.height);
    if (clamped.width === target.width && clamped.height === target.height) return target;
    return { ...target, width: clamped.width, height: clamped.height };
  });
  return document === file.document ? file : { ...file, document };
}
