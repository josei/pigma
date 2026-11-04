import type { EllipseArc } from './types';

/** The sweep from the starting angle to the ending angle, clockwise, in (0, 2 pi]. A sweep of zero reads as a whole turn. */
export function arcSweep(arc: EllipseArc): number {
  const turn = Math.PI * 2;
  let sweep = arc.endingAngle - arc.startingAngle;
  while (sweep <= 0) sweep += turn;
  while (sweep > turn) sweep -= turn;
  return sweep;
}

/**
 * The outline of an ellipse's arc, in the node's own coordinates. Angles are in radians, with zero on the x axis and increasing
 * clockwise (as Figma's plugin docs state). A zero inner radius closes the arc through the centre, like a pie slice; a larger one
 * is a ring sector, with the inner edge drawn back at the same angles. The inner radius is a fraction of each radius.
 */
export function ellipseArcPath(width: number, height: number, arc: EllipseArc): string {
  const rx = Math.max(width / 2, 0);
  const ry = Math.max(height / 2, 0);
  const cx = rx;
  const cy = ry;
  const start = arc.startingAngle;
  const end = start + arcSweep(arc);
  const large = arcSweep(arc) > Math.PI ? 1 : 0;
  const at = (fraction: number, angle: number): [number, number] => [
    cx + fraction * rx * Math.cos(angle),
    cy + fraction * ry * Math.sin(angle),
  ];
  const point = (x: number, y: number) => `${Number(x.toFixed(3))} ${Number(y.toFixed(3))}`;
  const inner = Math.min(Math.max(arc.innerRadius, 0), 1);
  const [sx, sy] = at(1, start);
  const [ex, ey] = at(1, end);
  const outer = `M ${point(sx, sy)} A ${Number(rx.toFixed(3))} ${Number(ry.toFixed(3))} 0 ${large} 1 ${point(ex, ey)}`;
  if (inner <= 0) return `${outer} L ${point(cx, cy)} Z`;
  const [ix, iy] = at(inner, end);
  const [jx, jy] = at(inner, start);
  const innerRx = Number((inner * rx).toFixed(3));
  const innerRy = Number((inner * ry).toFixed(3));
  return `${outer} L ${point(ix, iy)} A ${innerRx} ${innerRy} 0 ${large} 0 ${point(jx, jy)} Z`;
}
