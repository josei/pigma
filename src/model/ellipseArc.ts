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

/**
 * Whether a point, in the node's own coordinates, lies on the drawn arc: inside the outer edge, outside the hole, and within the
 * sweep. A pie slice includes its centre. An ellipse with no width or height has no area to hit.
 */
export function ellipseArcContains(width: number, height: number, arc: EllipseArc, x: number, y: number): boolean {
  const rx = width / 2;
  const ry = height / 2;
  if (!(rx > 0) || !(ry > 0)) return false;
  const dx = (x - rx) / rx;
  const dy = (y - ry) / ry;
  const radius2 = dx * dx + dy * dy;
  const inner = Math.min(Math.max(arc.innerRadius, 0), 1);
  if (radius2 > 1) return false;
  if (radius2 === 0) return inner <= 0;
  if (inner > 0 && radius2 < inner * inner) return false;
  const turn = Math.PI * 2;
  const angle = ((Math.atan2(dy, dx) - arc.startingAngle) % turn + turn) % turn;
  return angle <= arcSweep(arc);
}

/**
 * The arc's outline as a closed ring of points, in the node's own coordinates: the outer edge along the sweep, then either the centre
 * (a pie slice) or the inner edge back along the same angles (a ring sector). Used for outlines and booleans.
 */
export function ellipseArcRing(width: number, height: number, arc: EllipseArc): Array<[number, number]> {
  const rx = Math.max(width / 2, 0);
  const ry = Math.max(height / 2, 0);
  const sweep = arcSweep(arc);
  const steps = Math.max(8, Math.round((sweep / (Math.PI * 2)) * 64));
  const inner = Math.min(Math.max(arc.innerRadius, 0), 1);
  const ring: Array<[number, number]> = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = arc.startingAngle + (sweep * step) / steps;
    ring.push([rx + rx * Math.cos(angle), ry + ry * Math.sin(angle)]);
  }
  if (inner <= 0) {
    ring.push([rx, ry]);
    return ring;
  }
  for (let step = steps; step >= 0; step -= 1) {
    const angle = arc.startingAngle + (sweep * step) / steps;
    ring.push([rx + inner * rx * Math.cos(angle), ry + inner * ry * Math.sin(angle)]);
  }
  return ring;
}
