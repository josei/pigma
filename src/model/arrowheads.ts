/**
 * Arrowheads for the two ends of an open path. An arrow line is a chevron of two arms, drawn with the stroke; an equilateral arrow
 * is a filled triangle, painted with the stroke. The head is ARROW_HEAD_LENGTH stroke weights long, from the end point back along
 * the path. The canvas, the outline and the PDF all build their marks from this one geometry.
 */

export type Point = [number, number];

/** The length of an arrowhead, in stroke weights. */
export const ARROW_HEAD_LENGTH = 5;

export type ArrowCap = 'ARROW_LINES' | 'ARROW_EQUILATERAL';

export function isArrowCap(cap: string | undefined): cap is ArrowCap {
  return cap === 'ARROW_LINES' || cap === 'ARROW_EQUILATERAL';
}

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
export function arrowheadsOf(polylines: Point[][], cap: ArrowCap, weight: number): ArrowheadGeometry {
  const length = ARROW_HEAD_LENGTH * weight;
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
      } else {
        // An equilateral triangle with height `length`: its base lies `length` back from the tip, half as wide as length / sqrt(3).
        const baseX = tip[0] + backX * length;
        const baseY = tip[1] + backY * length;
        const half = length / Math.sqrt(3);
        heads.push([
          tip,
          [baseX + normalX * half, baseY + normalY * half],
          [baseX - normalX * half, baseY - normalY * half],
        ]);
      }
    }
  }
  return { arms, heads };
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
export function arrowheadPaths(polylines: Point[][], cap: ArrowCap, weight: number): { arms: string; heads: string } {
  const geometry = arrowheadsOf(polylines, cap, weight);
  return {
    arms: geometry.arms.map((arm) => pathDataOf(arm, false)).join(' '),
    heads: geometry.heads.map((head) => pathDataOf(head, true)).join(' '),
  };
}
