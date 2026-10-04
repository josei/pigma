import type { AnyNode, PigmaFile, Rect, SceneNode } from './types';
import { createShapeNode } from './factory';
import { findNode, updateNode } from './tree';

/**
 * Vector paths.
 *
 * A vector node stores its geometry as SVG `pathData` in node-local coordinates
 * (the same shape Figma publishes), and editing works on anchors: a point plus
 * optional in/out tangent handles, exactly like Figma's pen.
 *
 * Only absolute `M`, `L`, `C` and `Z` are authored here; anything else still
 * renders (the renderer passes pathData straight to SVG) but cannot be anchor
 * edited, and callers get `null` from `anchorsFromPathData` rather than a guess.
 */

export interface VectorAnchor {
  x: number;
  y: number;
  /** Incoming tangent, relative to the anchor. */
  in?: { x: number; y: number };
  /** Outgoing tangent, relative to the anchor. */
  out?: { x: number; y: number };
}

export interface VectorPath {
  anchors: VectorAnchor[];
  closed: boolean;
}

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** SVG path data for an anchor list. Curves become cubics; straight runs stay lines. */
export function pathDataFromAnchors(path: VectorPath): string {
  const { anchors, closed } = path;
  if (anchors.length === 0) return '';
  const first = anchors[0] as VectorAnchor;
  const parts = [`M ${num(first.x)} ${num(first.y)}`];
  const segments = anchors.length - 1;
  for (let index = 0; index < segments; index += 1) {
    const from = anchors[index] as VectorAnchor;
    const to = anchors[(index + 1) % anchors.length] as VectorAnchor;
    const c1 = from.out;
    const c2 = to.in;
    if (c1 || c2) {
      const h1 = { x: from.x + (c1?.x ?? 0), y: from.y + (c1?.y ?? 0) };
      const h2 = { x: to.x + (c2?.x ?? 0), y: to.y + (c2?.y ?? 0) };
      parts.push(`C ${num(h1.x)} ${num(h1.y)} ${num(h2.x)} ${num(h2.y)} ${num(to.x)} ${num(to.y)}`);
    } else {
      parts.push(`L ${num(to.x)} ${num(to.y)}`);
    }
  }
  if (closed) {
    // 'Z' closes with a straight line, so only curved closures need an explicit
    // segment (the last anchor's out handle or the first anchor's in handle).
    const last = anchors[anchors.length - 1] as VectorAnchor;
    if (last.out || first.in) {
      const h1 = { x: last.x + (last.out?.x ?? 0), y: last.y + (last.out?.y ?? 0) };
      const h2 = { x: first.x + (first.in?.x ?? 0), y: first.y + (first.in?.y ?? 0) };
      parts.push(`C ${num(h1.x)} ${num(h1.y)} ${num(h2.x)} ${num(h2.y)} ${num(first.x)} ${num(first.y)}`);
    }
    parts.push('Z');
  }
  return parts.join(' ');
}

const NUMBER = String.raw`-?\d*\.?\d+(?:e[-+]?\d+)?`;

/** Parse absolute M/L/C/Z path data into anchors, or null when unsupported. */
export function anchorsFromPathData(pathData: string): VectorPath | null {
  if (!pathData.trim()) return null;
  // Only absolute M/L/C/Z (plus numbers) are editable. Anything else - arcs,
  // quadratics, relative commands, unknown letters - must be refused rather than
  // tokenised into a wrong polyline.
  if (!/^[\s\d.,+\-eEMLCZ]*$/.test(pathData)) return null;
  const tokens = pathData.match(new RegExp(`[MLCZmlcz]|${NUMBER}`, 'gi'));
  if (!tokens) return null;

  const anchors: VectorAnchor[] = [];
  let closed = false;
  let index = 0;
  const next = (): number | null => {
    const token = tokens[index];
    if (token === undefined || /[MLCZmlcz]/.test(token)) return null;
    index += 1;
    return Number(token);
  };
  const point = (): { x: number; y: number } | null => {
    const x = next();
    const y = next();
    return x === null || y === null ? null : { x, y };
  };

  let command = '';
  while (index < tokens.length) {
    const token = tokens[index] as string;
    if (/[MLCZmlcz]/.test(token)) {
      command = token;
      index += 1;
    }
    if (command === 'Z' || command === 'z') {
      closed = true;
      command = '';
      continue;
    }
    if (command === 'M' || command === 'm') {
      const p = point();
      if (!p) return null;
      anchors.push({ x: p.x, y: p.y });
      command = command === 'M' ? 'L' : 'l';
      continue;
    }
    if (command === 'L' || command === 'l') {
      const p = point();
      if (!p) return null;
      anchors.push({ x: p.x, y: p.y });
      continue;
    }
    if (command === 'C' || command === 'c') {
      const c1 = point();
      const c2 = point();
      const p = point();
      if (!c1 || !c2 || !p) return null;
      const previous = anchors[anchors.length - 1];
      if (!previous) return null;
      previous.out = { x: c1.x - previous.x, y: c1.y - previous.y };
      anchors.push({ x: p.x, y: p.y, in: { x: c2.x - p.x, y: c2.y - p.y } });
      continue;
    }
    // Relative or unsupported commands: refuse rather than mis-edit the path.
    return null;
  }
  if (anchors.length === 0) return null;
  // A curved closure lands back on the start point; fold that duplicate anchor
  // into the first one so its incoming handle is preserved.
  const firstAnchor = anchors[0] as VectorAnchor;
  const lastAnchor = anchors[anchors.length - 1] as VectorAnchor;
  if (closed && anchors.length > 1 && Math.abs(lastAnchor.x - firstAnchor.x) < 1e-6 && Math.abs(lastAnchor.y - firstAnchor.y) < 1e-6) {
    firstAnchor.in = lastAnchor.in;
    anchors.pop();
  }
  return { anchors, closed };
}

export function vectorBounds(anchors: VectorAnchor[]): Rect {
  if (anchors.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = anchors.flatMap((anchor) => [anchor.x, anchor.x + (anchor.in?.x ?? 0), anchor.x + (anchor.out?.x ?? 0)]);
  const ys = anchors.flatMap((anchor) => [anchor.y, anchor.y + (anchor.in?.y ?? 0), anchor.y + (anchor.out?.y ?? 0)]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

/** Move anchors to a local origin so the node box starts at (0,0). */
export function normalizePath(path: VectorPath): { path: VectorPath; offset: { x: number; y: number } } {
  const bounds = vectorBounds(path.anchors);
  const offset = { x: Math.round(bounds.x * 100) / 100, y: Math.round(bounds.y * 100) / 100 };
  return {
    path: {
      closed: path.closed,
      anchors: path.anchors.map((anchor) => ({ ...anchor, x: anchor.x - offset.x, y: anchor.y - offset.y })),
    },
    offset,
  };
}

/** Sample a segment (line or cubic) at t in 0..1. */
export function pointOnSegment(from: VectorAnchor, to: VectorAnchor, t: number): { x: number; y: number } {
  const c1 = { x: from.x + (from.out?.x ?? 0), y: from.y + (from.out?.y ?? 0) };
  const c2 = { x: to.x + (to.in?.x ?? 0), y: to.y + (to.in?.y ?? 0) };
  if (!from.out && !to.in) {
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }
  const u = 1 - t;
  return {
    x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
    y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
  };
}

/** Insert an anchor partway along segment `index` (Figma's double-click on a segment). */
export function insertAnchor(path: VectorPath, index: number, t = 0.5): VectorPath {
  const anchors = [...path.anchors];
  const from = anchors[index];
  const to = anchors[(index + 1) % anchors.length];
  if (!from || !to) return path;
  const point = pointOnSegment(from, to, t);
  const inserted: VectorAnchor = { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 };
  anchors.splice(index + 1, 0, inserted);
  return { ...path, anchors };
}

export function removeAnchor(path: VectorPath, index: number): VectorPath {
  if (path.anchors.length <= 2) return path;
  return { ...path, anchors: path.anchors.filter((_, position) => position !== index) };
}

export function moveAnchor(path: VectorPath, index: number, x: number, y: number): VectorPath {
  return {
    ...path,
    anchors: path.anchors.map((anchor, position) => (position === index ? { ...anchor, x, y } : anchor)),
  };
}

/** Set a tangent handle (drag from an anchor with the pen). */
export function setTangent(
  path: VectorPath,
  index: number,
  handle: 'in' | 'out',
  offset: { x: number; y: number } | null,
  mirror = true,
): VectorPath {
  return {
    ...path,
    anchors: path.anchors.map((anchor, position) => {
      if (position !== index) return anchor;
      const next: VectorAnchor = { ...anchor, [handle]: offset ?? undefined };
      if (mirror && offset) {
        const opposite = handle === 'in' ? 'out' : 'in';
        next[opposite] = { x: -offset.x, y: -offset.y };
      }
      return next;
    }),
  };
}

/** Build a VECTOR node from anchors, normalised to a local box. */
export function vectorNodeFromPath(root: AnyNode | null, path: VectorPath, offset: { x: number; y: number }): SceneNode {
  const normalized = normalizePath(path);
  const bounds = vectorBounds(normalized.path.anchors);
  const node = createShapeNode(root, 'VECTOR', offset.x + normalized.offset.x, offset.y + normalized.offset.y, bounds.width, bounds.height);
  node.pathData = pathDataFromAnchors(normalized.path);
  node.windingRule = 'NONZERO';
  node.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 }, opacity: 1 }];
  node.strokeWeight = 1;
  node.strokeAlign = 'CENTER';
  node.name = 'Vector';
  return node;
}

/** Read editable anchors off a vector node, or null when its path is unsupported. */
export function vectorPathOf(node: AnyNode): VectorPath | null {
  if (node.type !== 'VECTOR' && node.type !== 'BOOLEAN_OPERATION') return null;
  const data = node.pathData;
  if (!data) return null;
  return anchorsFromPathData(data);
}

/**
 * Write an edited anchor list back onto a vector node.
 *
 * The anchors are normalised so the node box starts at its own origin; the node
 * transform is shifted by the same amount (in the node's own axes) so the shape
 * does not jump when anchors move past the old origin.
 */
export function writeVectorPath(file: PigmaFile, id: string, path: VectorPath, renormalize = true): PigmaFile {
  const node = findNode(file.document, id);
  if (!node || node.locked || (node.type !== 'VECTOR' && node.type !== 'BOOLEAN_OPERATION')) return file;
  // Mid-drag writes must NOT renormalise: the anchors are expressed in the frame
  // captured at drag start, and shifting the transform on every pointermove would
  // compound the offset. The commit renormalises once.
  const normalized = renormalize ? normalizePath(path) : { path, offset: { x: 0, y: 0 } };
  const bounds = vectorBounds(normalized.path.anchors);
  const data = pathDataFromAnchors(normalized.path);
  const offset = normalized.offset;
  const shifted =
    offset.x === 0 && offset.y === 0
      ? node.transform
      : {
          ...node.transform,
          tx: node.transform.tx + node.transform.a * offset.x + node.transform.c * offset.y,
          ty: node.transform.ty + node.transform.b * offset.x + node.transform.d * offset.y,
        };
  const next = {
    ...node,
    pathData: data,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
    transform: shifted,
  } as SceneNode;
  return { ...file, document: updateNode(file.document, id, () => next) };
}

/** Every anchor position of a node in world coordinates (for overlay handles). */
export function worldAnchors(root: AnyNode, id: string): Array<{ x: number; y: number }> {
  const node = findNode(root, id);
  if (!node || (node.type !== 'VECTOR' && node.type !== 'BOOLEAN_OPERATION')) return [];
  const path = vectorPathOf(node);
  if (!path) return [];
  const m = node.transform;
  return path.anchors.map((anchor) => ({
    x: m.a * anchor.x + m.c * anchor.y + m.tx,
    y: m.b * anchor.x + m.d * anchor.y + m.ty,
  }));
}
