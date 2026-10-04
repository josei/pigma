/**
 * Document invariants every WRITE PATH enforces before committing.
 *
 * They live in the model, not under `mcp/`, because they are not an MCP concern:
 * the MCP session, the live-editor session and the in-app plugin runner all
 * refuse the same states, through this one implementation. A plugin script — run
 * through the MCP or from the editor's own panel — cannot commit a document the
 * rest of the system assumes is impossible. The editor's own actions cannot
 * produce these states (its ops clamp and validate), which is why a script needs
 * a guard of its own.
 *
 * Scope is deliberate — **only states a script can actually reach**:
 *
 * - **geometry**: a negative or non-finite width/height. `node.resize(-10, -10)`
 *   committed it before; NaN/Infinity are already rejected by the host, and 0 is
 *   legitimate (a line, an empty frame).
 * - **opacity**: outside 0..1. `node.opacity = 42` committed it before.
 * - **colours**: a paint or effect colour with a non-finite channel or a channel
 *   outside 0..1 — `node.fills = [{ type: 'SOLID', color: { r: 'x', … } }]` and a
 *   hand-written `effects` array both committed before, and both reach the
 *   renderer as `NaN` in the SVG.
 *
 * Deliberately **not** checked, because no script can reach them (so a check would
 * be dead code): duplicate node ids (the host assigns ids and `id` is read-only),
 * a document without pages (no API removes a page), a `TEXT` node with children
 * (appendChild refuses a non-container), characters on a non-text node, and an
 * unknown node in the selection (all four fail loudly already).
 */
import type { AnyNode, PigmaFile, SceneNode } from '../model/types';
import { hasChildren } from '../model/types';

/**
 * The message prefix for a node. Built only when a problem is actually found:
 * every legitimate write used to pay for one template literal per node plus one
 * per paint, which was most of the scan's cost (and its GC noise).
 */
function label(node: AnyNode, detail: string): string {
  return `${node.type} "${node.name}" (${node.id})${detail}`;
}

const DIMENSIONS = ['width', 'height'] as const;
const COLOUR_CHANNELS = ['r', 'g', 'b', 'a'] as const;

/** Human-readable problems, in document order. Empty means the document is fine. */
export function documentProblems(file: PigmaFile): string[] {
  const problems: string[] = [];

  /** `kind` names the list a colour came from, so no message is built until one is needed. */
  const checkColour = (value: unknown, node: AnyNode, kind: string, index: number, stop?: number): void => {
    const at = `${kind}[${index}]${stop === undefined ? '' : `.stop[${stop}]`}`;
    if (!value || typeof value !== 'object') {
      problems.push(label(node, ` ${at}: colour is not an object`));
      return;
    }
    const colour = value as Record<string, unknown>;
    for (const channel of COLOUR_CHANNELS) {
      const raw = colour[channel];
      if (raw === undefined) continue; // RGB has no alpha; RGBA does.
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        problems.push(label(node, ` ${at}: colour.${channel} must be a finite number (got ${String(raw)})`));
      } else if (raw < 0 || raw > 1) {
        problems.push(label(node, ` ${at}: colour.${channel} must be between 0 and 1 (got ${raw})`));
      }
    }
  };

  const checkPaint = (value: unknown, node: AnyNode, kind: string, index: number): void => {
    if (!value || typeof value !== 'object') return; // the host validates paint shape
    const paint = value as Record<string, unknown>;
    if (paint.type === 'SOLID') checkColour(paint.color, node, kind, index);
    if (typeof paint.type === 'string' && paint.type.startsWith('GRADIENT') && Array.isArray(paint.gradientStops)) {
      const stops = paint.gradientStops as unknown[];
      for (let stop = 0; stop < stops.length; stop += 1) {
        const entry = stops[stop];
        if (entry && typeof entry === 'object') checkColour((entry as { color?: unknown }).color, node, kind, index, stop);
      }
    }
  };

  const visit = (node: AnyNode): void => {
    if (node.type !== 'DOCUMENT' && node.type !== 'CANVAS') {
      const scene = node as SceneNode;
      for (const dimension of DIMENSIONS) {
        const value = scene[dimension];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          problems.push(label(node, `: ${dimension} must be a finite number (got ${String(value)})`));
        } else if (value < 0) {
          problems.push(label(node, `: ${dimension} must not be negative (got ${value})`));
        }
      }
      if (typeof scene.opacity !== 'number' || !Number.isFinite(scene.opacity)) {
        problems.push(label(node, `: opacity must be a finite number (got ${String(scene.opacity)})`));
      } else if (scene.opacity < 0 || scene.opacity > 1) {
        problems.push(label(node, `: opacity must be between 0 and 1 (got ${scene.opacity})`));
      }
      // Plain loops, not `forEach`: a callback per list per node is one closure
      // allocation per node, and this runs on every write.
      for (let index = 0; index < scene.fills.length; index += 1) checkPaint(scene.fills[index], node, 'fill', index);
      for (let index = 0; index < scene.strokes.length; index += 1) checkPaint(scene.strokes[index], node, 'stroke', index);
      const effects = scene.effects;
      if (effects) {
        for (let index = 0; index < effects.length; index += 1) {
          const effect = effects[index];
          if (effect && typeof effect === 'object' && 'color' in effect) {
            checkColour((effect as { color?: unknown }).color, node, 'effect', index);
          }
        }
      }
    }
    if (hasChildren(node)) for (const child of node.children) visit(child);
  };

  visit(file.document);
  return problems;
}

/** `true` when the document satisfies the invariants above. */
export function isCommittable(file: PigmaFile): boolean {
  return documentProblems(file).length === 0;
}
