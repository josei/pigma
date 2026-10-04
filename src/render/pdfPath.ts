/**
 * SVG path data → PDF path operators.
 *
 * The renderer emits SVG `d` strings (rects, ellipses, stars, pen paths, imported
 * Figma vectors), and the vector PDF exporter must draw the very same geometry.
 * PDF has no arc operator, so `A` segments are converted to cubic Béziers with
 * the standard endpoint-to-centre parameterisation; quadratic segments are
 * elevated to cubics. Everything else maps one-to-one.
 */

import { roundTo } from '../model/matrix';

type Token = { command: string; values: number[] };

const PARAM_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Split path data into command tokens, handling implicit repeats and signs. */
export function parsePathData(data: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let command: string | null = null;
  let values: number[] = [];
  const flush = () => {
    if (!command) return;
    const count = PARAM_COUNT[command.toUpperCase()] ?? 0;
    if (count === 0) {
      tokens.push({ command, values: [] });
      return;
    }
    for (let index = 0; index + count <= values.length; index += count) {
      tokens.push({ command, values: values.slice(index, index + count) });
      // An implicit repeat of `M` continues as `L`, exactly like SVG.
      if (command === 'M') command = 'L';
      else if (command === 'm') command = 'l';
    }
  };
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(data)) !== null) {
    const [, letter, number] = match;
    if (letter) {
      flush();
      command = letter;
      values = [];
      if (letter === 'Z' || letter === 'z') {
        tokens.push({ command: letter, values: [] });
        command = null;
      }
    } else if (number !== undefined) {
      values.push(Number(number));
    }
  }
  flush();
  return tokens;
}

/** Endpoint parameterisation of an SVG arc into a list of cubic Béziers. */
function arcToCubics(
  x0: number,
  y0: number,
  rx: number,
  ry: number,
  angleDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x1: number,
  y1: number,
): Array<[number, number, number, number, number, number]> {
  if (rx === 0 || ry === 0) return [[x0, y0, x1, y1, x1, y1]];
  const phi = (angleDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x0 - x1) / 2;
  const dy2 = (y0 - y1) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  const radiiScale = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (radiiScale > 1) {
    const scale = Math.sqrt(radiiScale);
    rx *= scale;
    ry *= scale;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor = denominator === 0 ? 0 : sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const value = length === 0 ? 0 : Math.min(1, Math.max(-1, dot / length));
    const sign2 = ux * vy - uy * vx < 0 ? -1 : 1;
    return sign2 * Math.acos(value);
  };
  const startAngle = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let deltaAngle = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
  else if (sweep && deltaAngle < 0) deltaAngle += 2 * Math.PI;

  const segments = Math.ceil(Math.abs(deltaAngle / (Math.PI / 2)));
  const step = deltaAngle / segments;
  const alpha = (4 / 3) * Math.tan(step / 4);
  const cubics: Array<[number, number, number, number, number, number]> = [];
  let theta = startAngle;
  let px = x0;
  let py = y0;
  for (let index = 0; index < segments; index += 1) {
    const next = theta + step;
    const cosNext = Math.cos(next);
    const sinNext = Math.sin(next);
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const point = (t: number, s: number) => ({
      x: cx + rx * cosPhi * t - ry * sinPhi * s,
      y: cy + rx * sinPhi * t + ry * cosPhi * s,
    });
    const end = point(cosNext, sinNext);
    const start = point(cosTheta, sinTheta);
    const d1 = { x: -rx * cosPhi * sinTheta - ry * sinPhi * cosTheta, y: -rx * sinPhi * sinTheta + ry * cosPhi * cosTheta };
    const d2 = { x: -rx * cosPhi * sinNext - ry * sinPhi * cosNext, y: -rx * sinPhi * sinNext + ry * cosPhi * cosNext };
    cubics.push([
      px + alpha * d1.x,
      py + alpha * d1.y,
      end.x - alpha * d2.x,
      end.y - alpha * d2.y,
      end.x,
      end.y,
    ]);
    void start;
    px = end.x;
    py = end.y;
    theta = next;
  }
  return cubics;
}

/**
 * Convert SVG path data to PDF path operators (no paint operator: the caller
 * appends `f`, `f*`, `S`, `B`, …). Coordinates are emitted as-is; the caller
 * sets the transform with `cm`.
 */
export function pathToPdf(data: string): string {
  const tokens = parsePathData(data);
  const out: string[] = [];
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let lastControl: { x: number; y: number } | null = null;
  let lastQuadratic: { x: number; y: number } | null = null;

  const num = (value: number) => `${roundTo(value, 3)}`;

  for (const token of tokens) {
    const upper = token.command.toUpperCase();
    const relative = token.command !== upper;
    const v = token.values;
    switch (upper) {
      case 'M': {
        const x = relative ? cx + v[0]! : v[0]!;
        const y = relative ? cy + v[1]! : v[1]!;
        out.push(`${num(x)} ${num(y)} m`);
        cx = x;
        cy = y;
        startX = x;
        startY = y;
        lastControl = null;
        lastQuadratic = null;
        break;
      }
      case 'L': {
        const x = relative ? cx + v[0]! : v[0]!;
        const y = relative ? cy + v[1]! : v[1]!;
        out.push(`${num(x)} ${num(y)} l`);
        cx = x;
        cy = y;
        lastControl = null;
        lastQuadratic = null;
        break;
      }
      case 'H': {
        const x = relative ? cx + v[0]! : v[0]!;
        out.push(`${num(x)} ${num(cy)} l`);
        cx = x;
        lastControl = null;
        lastQuadratic = null;
        break;
      }
      case 'V': {
        const y = relative ? cy + v[0]! : v[0]!;
        out.push(`${num(cx)} ${num(y)} l`);
        cy = y;
        lastControl = null;
        lastQuadratic = null;
        break;
      }
      case 'C': {
        const [x1, y1, x2, y2, x, y] = v as [number, number, number, number, number, number];
        const p1 = { x: relative ? cx + x1 : x1, y: relative ? cy + y1 : y1 };
        const p2 = { x: relative ? cx + x2 : x2, y: relative ? cy + y2 : y2 };
        const end = { x: relative ? cx + x : x, y: relative ? cy + y : y };
        out.push(`${num(p1.x)} ${num(p1.y)} ${num(p2.x)} ${num(p2.y)} ${num(end.x)} ${num(end.y)} c`);
        lastControl = p2;
        lastQuadratic = null;
        cx = end.x;
        cy = end.y;
        break;
      }
      case 'S': {
        const [x2, y2, x, y] = v as [number, number, number, number];
        const reflected = lastControl ? { x: 2 * cx - lastControl.x, y: 2 * cy - lastControl.y } : { x: cx, y: cy };
        const p2 = { x: relative ? cx + x2 : x2, y: relative ? cy + y2 : y2 };
        const end = { x: relative ? cx + x : x, y: relative ? cy + y : y };
        out.push(`${num(reflected.x)} ${num(reflected.y)} ${num(p2.x)} ${num(p2.y)} ${num(end.x)} ${num(end.y)} c`);
        lastControl = p2;
        lastQuadratic = null;
        cx = end.x;
        cy = end.y;
        break;
      }
      case 'Q': {
        const [x1, y1, x, y] = v as [number, number, number, number];
        const control = { x: relative ? cx + x1 : x1, y: relative ? cy + y1 : y1 };
        const end = { x: relative ? cx + x : x, y: relative ? cy + y : y };
        // Elevate the quadratic to a cubic.
        const c1 = { x: cx + (2 / 3) * (control.x - cx), y: cy + (2 / 3) * (control.y - cy) };
        const c2 = { x: end.x + (2 / 3) * (control.x - end.x), y: end.y + (2 / 3) * (control.y - end.y) };
        out.push(`${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(end.x)} ${num(end.y)} c`);
        lastQuadratic = control;
        lastControl = null;
        cx = end.x;
        cy = end.y;
        break;
      }
      case 'T': {
        const [x, y] = v as [number, number];
        const reflectedControl: { x: number; y: number } = lastQuadratic
          ? { x: 2 * cx - lastQuadratic.x, y: 2 * cy - lastQuadratic.y }
          : { x: cx, y: cy };
        const end = { x: relative ? cx + x : x, y: relative ? cy + y : y };
        const c1 = { x: cx + (2 / 3) * (reflectedControl.x - cx), y: cy + (2 / 3) * (reflectedControl.y - cy) };
        const c2 = { x: end.x + (2 / 3) * (reflectedControl.x - end.x), y: end.y + (2 / 3) * (reflectedControl.y - end.y) };
        out.push(`${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(end.x)} ${num(end.y)} c`);
        lastQuadratic = reflectedControl;
        lastControl = null;
        cx = end.x;
        cy = end.y;
        break;
      }
      case 'A': {
        const [rx, ry, rotation, largeArc, sweep, x, y] = v as [number, number, number, number, number, number, number];
        const end = { x: relative ? cx + x : x, y: relative ? cy + y : y };
        for (const [x1, y1, x2, y2, ex, ey] of arcToCubics(cx, cy, Math.abs(rx), Math.abs(ry), rotation, largeArc !== 0, sweep !== 0, end.x, end.y)) {
          out.push(`${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(ex)} ${num(ey)} c`);
        }
        cx = end.x;
        cy = end.y;
        lastControl = null;
        lastQuadratic = null;
        break;
      }
      case 'Z': {
        out.push('h');
        cx = startX;
        cy = startY;
        lastControl = null;
        lastQuadratic = null;
        break;
      }
      default:
        break;
    }
  }
  return out.join('\n');
}

