import type { Constraints, LayoutGrid, Rect } from './types';
import { clampHeight, clampWidth, type ResolvedLimits, type SizeLimits } from './sizing';

/**
 * Constraints and layout grids.
 *
 * Constraints decide how a frame's children follow a resize (Figma's model);
 * layout grids describe the editing guides drawn over a frame. Both are pure
 * math here so the renderer and the panel share exactly one implementation.
 */

export const CONSTRAINT_TYPES: Array<Constraints['horizontal']> = ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE'];

export function constraintLabel(type: Constraints['horizontal']): string {
  switch (type) {
    case 'MIN':
      return 'Left / Top';
    case 'CENTER':
      return 'Center';
    case 'MAX':
      return 'Right / Bottom';
    case 'STRETCH':
      return 'Stretch';
    case 'SCALE':
      return 'Scale';
    default:
      return type;
  }
}

export const DEFAULT_CONSTRAINTS: Constraints = { horizontal: 'MIN', vertical: 'MIN' };

interface AxisResult {
  position: number;
  size: number;
}

/**
 * Resolve one axis of a child's box after its container changed size.
 * `start`/`size` are the child's box, `oldSpan`/`newSpan` the container's.
 */
function constrainAxis(
  type: Constraints['horizontal'],
  start: number,
  size: number,
  oldSpan: number,
  newSpan: number,
): AxisResult {
  const delta = newSpan - oldSpan;
  switch (type) {
    case 'MIN':
      return { position: start, size };
    case 'MAX':
      return { position: start + delta, size };
    case 'CENTER': {
      const centerRatio = oldSpan === 0 ? 0.5 : (start + size / 2) / oldSpan;
      return { position: centerRatio * newSpan - size / 2, size };
    }
    case 'STRETCH':
      return { position: start, size: Math.max(1, size + delta) };
    case 'SCALE': {
      const ratio = oldSpan === 0 ? 1 : newSpan / oldSpan;
      return { position: start * ratio, size: Math.max(1, size * ratio) };
    }
    default:
      return { position: start, size };
  }
}

/**
 * New box for a child when its container resizes from `old` to `next`.
 * `constraints` is the child's own setting.
 */
export function applyConstraints(
  box: Rect,
  constraints: Constraints | undefined,
  old: { width: number; height: number },
  next: { width: number; height: number },
  limits?: SizeLimits,
): Rect {
  const resolved = constraints ?? DEFAULT_CONSTRAINTS;
  const horizontal = constrainAxis(resolved.horizontal, box.x, box.width, old.width, next.width);
  const vertical = constrainAxis(resolved.vertical, box.y, box.height, old.height, next.height);
  // A stretched or scaled child still obeys its own min/max limits (M10).
  const resolvedLimits: ResolvedLimits = {
    minWidth: limits?.minWidth ?? 1,
    minHeight: limits?.minHeight ?? 1,
    maxWidth: limits?.maxWidth ?? Number.POSITIVE_INFINITY,
    maxHeight: limits?.maxHeight ?? Number.POSITIVE_INFINITY,
  };
  return {
    x: horizontal.position,
    y: vertical.position,
    width: clampWidth(resolvedLimits, horizontal.size),
    height: clampHeight(resolvedLimits, vertical.size),
  };
}

/** Default grid per pattern, matching Figma's starting values. */
export function defaultLayoutGrid(pattern: LayoutGrid['pattern']): LayoutGrid {
  switch (pattern) {
    case 'COLUMNS':
      return { pattern, sectionSize: 80, count: 6, gutterSize: 20, offset: 0, alignment: 'STRETCH', color: { r: 1, g: 0.3, b: 0.4, a: 0.1 }, visible: true };
    case 'ROWS':
      return { pattern, sectionSize: 80, count: 4, gutterSize: 20, offset: 0, alignment: 'STRETCH', color: { r: 1, g: 0.3, b: 0.4, a: 0.1 }, visible: true };
    case 'GRID':
    default:
      return { pattern: 'GRID', sectionSize: 8, color: { r: 1, g: 0.3, b: 0.4, a: 0.1 }, visible: true };
  }
}

export interface GridLine {
  /** Offset from the frame's origin along the grid axis. */
  start: number;
  /** Thickness of the band. */
  size: number;
}

/**
 * Band positions for a grid inside a frame of `extent` units.
 * COLUMNS/ROWS distribute `count` sections with `gutterSize` between them;
 * GRID tiles `sectionSize` cells across the whole extent.
 */
export function gridBands(grid: LayoutGrid, extent: number): GridLine[] {
  const lines: GridLine[] = [];
  if (extent <= 0) return lines;
  if (grid.pattern === 'GRID') {
    const step = Math.max(1, grid.sectionSize);
    for (let position = 0; position < extent; position += step) {
      lines.push({ start: position, size: Math.min(step, extent - position) });
    }
    return lines;
  }

  const count = Math.max(1, Math.round(grid.count ?? 1));
  const gutter = Math.max(0, grid.gutterSize ?? 0);
  const offset = Math.max(0, grid.offset ?? 0);
  const available = Math.max(0, extent - offset * 2 - gutter * (count - 1));
  const section = grid.alignment === 'STRETCH' ? available / count : Math.max(0, grid.sectionSize);
  for (let index = 0; index < count; index += 1) {
    const start = offset + index * (section + gutter);
    if (start >= extent) break;
    lines.push({ start, size: Math.min(section, extent - start) });
  }
  return lines;
}
