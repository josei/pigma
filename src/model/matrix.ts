import type { Transform, TransformMatrix } from './types';

export const IDENTITY: Transform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export function identity(): Transform {
  return { ...IDENTITY };
}

export function translate(tx: number, ty: number): Transform {
  return { a: 1, b: 0, c: 0, d: 1, tx, ty };
}

/** Compose `m` then `n` (i.e. n ∘ m in column-vector convention). */
export function multiply(m: Transform, n: Transform): Transform {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    tx: m.a * n.tx + m.c * n.ty + m.tx,
    ty: m.b * n.tx + m.d * n.ty + m.ty,
  };
}

export function applyToPoint(m: Transform, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
}

export function invert(m: Transform): Transform {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return identity();
  const ia = m.d / det;
  const ib = -m.b / det;
  const ic = -m.c / det;
  const id = m.a / det;
  return {
    a: ia,
    b: ib,
    c: ic,
    d: id,
    tx: -(ia * m.tx + ic * m.ty),
    ty: -(ib * m.tx + id * m.ty),
  };
}

/** Rotation angle in degrees (counter-clockwise, screen space y-down). */
export function rotationOf(m: Transform): number {
  return (Math.atan2(m.b, m.a) * 180) / Math.PI;
}

export function scaleOf(m: Transform): { x: number; y: number } {
  return {
    x: Math.hypot(m.a, m.b),
    y: Math.hypot(m.c, m.d),
  };
}

/** Build a transform from translation, rotation (degrees) and unit scale. */
export function fromTRS(tx: number, ty: number, rotationDeg: number, sx = 1, sy = 1): Transform {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: cos * sx,
    b: sin * sx,
    c: -sin * sy,
    d: cos * sy,
    tx,
    ty,
  };
}

/** Rebuild a transform keeping translation/scale but replacing rotation. */
export function withRotation(m: Transform, rotationDeg: number): Transform {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { x: sx, y: sy } = scaleOf(m);
  return { a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy, tx: m.tx, ty: m.ty };
}

/** Figma wire format: [[a, c, tx], [b, d, ty]]. */
export function toMatrix(m: Transform): TransformMatrix {
  return [
    [m.a, m.c, m.tx],
    [m.b, m.d, m.ty],
  ];
}

export function fromMatrix(m: TransformMatrix | number[][]): Transform {
  const row0 = m[0] ?? [];
  const row1 = m[1] ?? [];
  return {
    a: row0[0] ?? 1,
    b: row1[0] ?? 0,
    c: row0[1] ?? 0,
    d: row1[1] ?? 1,
    tx: row0[2] ?? 0,
    ty: row1[2] ?? 0,
  };
}

export function transformToCss(m: Transform): string {
  return `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.tx}, ${m.ty})`;
}

/** The four corners of a node-local box under `m`, in order TL, TR, BR, BL. */
export function cornersOf(m: Transform, width: number, height: number): Array<{ x: number; y: number }> {
  return [
    applyToPoint(m, 0, 0),
    applyToPoint(m, width, 0),
    applyToPoint(m, width, height),
    applyToPoint(m, 0, height),
  ];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned bounding box of a rotated box. */
export function boundsOf(m: Transform, width: number, height: number): Rect {
  const pts = cornersOf(m, width, height);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function roundTo(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

