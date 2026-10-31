/**
 * Arrowheads for the two ends of an open path. An arrow line is a chevron of two arms, drawn with the stroke; the other caps are
 * filled shapes, painted with the stroke: an equilateral arrow, an inward triangle, a diamond and a circle. The head is
 * ARROW_HEAD_LENGTH stroke weights long, from the end point back along the path. The canvas, the outline and the PDF all build
 * their marks from this one geometry.
 */

export type Point = [number, number];

/** The default length of an arrowhead, in stroke weights. */
export const ARROW_HEAD_LENGTH = 5;

export type ArrowCap = 'ARROW_LINES' | 'ARROW_EQUILATERAL' | 'TRIANGLE_FILLED' | 'DIAMOND_FILLED' | 'CIRCLE_FILLED';

export function isArrowCap(cap: string | undefined): cap is ArrowCap {
  return cap === 'ARROW_LINES' || cap === 'ARROW_EQUILATERAL' || cap === 'TRIANGLE_FILLED' || cap === 'DIAMOND_FILLED' || cap === 'CIRCLE_FILLED';
}

/** Vertices on a circle, for a round head drawn as a closed polygon. */
const CIRCLE_SEGMENTS = 32;

export interface ArrowheadGeometry {
  /** Open three-point polylines: the two arms of an arrow line, which meet at the end point. */
  arms: Point[][];
  /** Closed triangles: an equilateral head, with its tip at the end point. */
  heads: Point[][];
}

/**
 * The arrowheads at both ends of each open polyline. A polyline with fewer than two distinct points has no direction, so it gets
 * no head. The two ends of a line are the first and the last points, each with its direction taken from the segment beside it.
 */
export function arrowheadsOf(polylines: Point[][], cap: ArrowCap, weight: number, headLength = ARROW_HEAD_LENGTH): ArrowheadGeometry {
  const length = headLength * weight;
  const arms: Point[][] = [];
  const heads: Point[][] = [];
  const cos = Math.cos(Math.PI / 6);
  const sin = Math.sin(Math.PI / 6);
  for (const points of polylines) {
    if (points.length < 2) continue;
    const ends: Array<[Point, Point]> = [
      [points[0]!, points[1]!],
      [points[points.length - 1]!, points[points.length - 2]!],
    ];
    for (const [tip, from] of ends) {
      const ux = tip[0] - from[0];
      const uy = tip[1] - from[1];
      const size = Math.hypot(ux, uy);
      if (size === 0) continue;
      // `outward` points away from the path; `back` points along it, into the line; `normal` is across it.
      const backX = -ux / size;
      const backY = -uy / size;
      const normalX = uy / size;
      const normalY = -ux / size;
      if (cap === 'ARROW_LINES') {
        arms.push([
          [tip[0] + length * (backX * cos + normalX * sin), tip[1] + length * (backY * cos + normalY * sin)],
          tip,
          [tip[0] + length * (backX * cos - normalX * sin), tip[1] + length * (backY * cos - normalY * sin)],
        ]);
      } else if (cap === 'ARROW_EQUILATERAL') {
        // An equilateral triangle with height `length`: its base lies `length` back from the tip, half as wide as length / sqrt(3).
        const baseX = tip[0] + backX * length;
        const baseY = tip[1] + backY * length;
        const half = length / Math.sqrt(3);
        heads.push([
          tip,
          [baseX + normalX * half, baseY + normalY * half],
          [baseX - normalX * half, baseY - normalY * half],
        ]);
      } else {
        heads.push(filledHead(cap, tip, [backX, backY], [normalX, normalY], length));
      }
    }
  }
  return { arms, heads };
}

/**
 * The closed outline of a filled end. An inward triangle has its base on the end point and its tip `length` back along the line,
 * half as wide as an equilateral head. A diamond and a circle are centred on the end point, `length` across.
 */
function filledHead(cap: 'TRIANGLE_FILLED' | 'DIAMOND_FILLED' | 'CIRCLE_FILLED', tip: Point, back: Point, normal: Point, length: number): Point[] {
  const [backX, backY] = back;
  const [normalX, normalY] = normal;
  if (cap === 'TRIANGLE_FILLED') {
    const half = length / Math.sqrt(3);
    return [
      [tip[0] + normalX * half, tip[1] + normalY * half],
      [tip[0] + backX * length, tip[1] + backY * length],
      [tip[0] - normalX * half, tip[1] - normalY * half],
    ];
  }
  const radius = length / 2;
  if (cap === 'DIAMOND_FILLED') {
    return [
      [tip[0] + backX * radius, tip[1] + backY * radius],
      [tip[0] + normalX * radius, tip[1] + normalY * radius],
      [tip[0] - backX * radius, tip[1] - backY * radius],
      [tip[0] - normalX * radius, tip[1] - normalY * radius],
    ];
  }
  return Array.from({ length: CIRCLE_SEGMENTS }, (_, index) => {
    const angle = (2 * Math.PI * index) / CIRCLE_SEGMENTS;
    return [tip[0] + radius * Math.cos(angle), tip[1] + radius * Math.sin(angle)] as Point;
  });
}

/** A number as it is written into path data: at most three decimals, without trailing zeros. */
function coordinate(value: number): string {
  return String(Number(value.toFixed(3)));
}

function pathDataOf(polyline: Point[], closed: boolean): string {
  const [first, ...rest] = polyline;
  const moves = `M ${coordinate(first![0])} ${coordinate(first![1])}`;
  const lines = rest.map(([x, y]) => ` L ${coordinate(x)} ${coordinate(y)}`).join('');
  return `${moves}${lines}${closed ? ' Z' : ''}`;
}

/** The arrowheads at the ends of the given open polylines as path data: the arms, and the heads (each closed). */
export function arrowheadPaths(polylines: Point[][], cap: ArrowCap, weight: number, headLength = ARROW_HEAD_LENGTH): { arms: string; heads: string } {
  const geometry = arrowheadsOf(polylines, cap, weight, headLength);
  return {
    arms: geometry.arms.map((arm) => pathDataOf(arm, false)).join(' '),
    heads: geometry.heads.map((head) => pathDataOf(head, true)).join(' '),
  };
}
