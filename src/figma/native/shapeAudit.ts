/**
 * The shape check: the generalisation of the name sweep.
 *
 * The name sweep catches a field written under a name the schema does not define.
 * It is STRUCTURALLY BLIND to the other half: a field written under the RIGHT name
 * with the WRONG VALUE SHAPE. That happened — `componentPropDefs` was a list on
 * the wire, we wrote a map, and it encoded as an EMPTY LIST, losing every
 * definition with no warning, because the name was right and nothing fired.
 *
 * This audit encodes a message, decodes it, and compares what we wrote against
 * what came back, per node and per field. It reports the three ways a value can
 * fail to cross the wire even when its name is correct:
 *
 *   - `missing`: the field did not come back at all;
 *   - `shape`:   it came back as a different kind of value (list vs object);
 *   - `empty`:   a NON-EMPTY source encoded as an EMPTY collection.
 *
 * `empty` is the `componentPropDefs` case and the one the field check cannot see.
 */

export type ShapeMismatchKind = 'missing' | 'shape' | 'empty';

export interface ShapeMismatch {
  nodeId: string;
  nodeName: string;
  field: string;
  kind: ShapeMismatchKind;
  written: unknown;
  decoded: unknown;
}

/** The coarse shape class a value has on the wire. */
function shapeOf(value: unknown): 'list' | 'object' | 'scalar' | 'null' {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'object') return 'object';
  return 'scalar';
}

function isEmptyCollection(value: unknown): boolean {
  const shape = shapeOf(value);
  if (shape === 'list') return (value as unknown[]).length === 0;
  if (shape === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function isNonEmptyCollection(value: unknown): boolean {
  const shape = shapeOf(value);
  if (shape === 'list') return (value as unknown[]).length > 0;
  if (shape === 'object') return Object.keys(value as object).length > 0;
  return false;
}

/** Fields whose absence is a kiwi default, not a loss. */
const DEFAULTED_FIELDS = new Set(['type', 'guid', 'phase', 'parentIndex']);

/**
 * Compare the message we wrote against the message that came back out of the
 * encoder. `written` and `decoded` are both decoded-message shapes.
 */
export function auditWireShapes(
  written: { nodeChanges?: unknown[] },
  decoded: { nodeChanges?: unknown[] },
): ShapeMismatch[] {
  const mismatches: ShapeMismatch[] = [];
  const writtenChanges = (written.nodeChanges ?? []) as unknown[];
  const decodedChanges = (decoded.nodeChanges ?? []) as unknown[];
  // The written message usually has NO guids (the encoder assigns them), and names
  // are NOT unique — 3712 nodes with repeated names made the old name fallback
  // compare nodes against the wrong counterpart and report 1830 phantom losses. So
  // match by POSITION: the decoder preserves the nodeChanges order, so entry i on
  // the way in is entry i on the way out. If the lengths differ the correspondence
  // cannot be trusted, and then we match on guid only — refusing to claim a loss we
  // cannot attribute rather than crying wolf.
  const aligned = writtenChanges.length === decodedChanges.length;
  const decodedById = new Map<string, Record<string, unknown>>();
  if (!aligned) {
    for (const change of decodedChanges) {
      if (change && typeof change === 'object') {
        const record = change as Record<string, unknown>;
        const id = typeof record.guid === 'string' ? record.guid : null;
        if (id) decodedById.set(id, record);
      }
    }
  }

  for (const [index, change] of writtenChanges.entries()) {
    if (!change || typeof change !== 'object') continue;
    const record = change as Record<string, unknown>;
    const id = typeof record.guid === 'string' ? record.guid : '';
    const name = typeof record.name === 'string' ? record.name : id;
    const decodedEntry = aligned ? decodedChanges[index] : undefined;
    const back =
      decodedEntry && typeof decodedEntry === 'object'
        ? (decodedEntry as Record<string, unknown>)
        : id
          ? decodedById.get(id)
          : undefined;
    if (!back) continue;

    for (const [field, value] of Object.entries(record)) {
      if (DEFAULTED_FIELDS.has(field)) continue;
      const decodedValue = back ? back[field] : undefined;

      if (value === undefined) continue;
      // Nothing to lose: an empty source is not a loss whatever comes back.
      if (isEmptyCollection(value)) continue;

      if (isNonEmptyCollection(value) && (decodedValue === undefined || isEmptyCollection(decodedValue))) {
        mismatches.push({ nodeId: id, nodeName: name, field, kind: 'empty', written: value, decoded: decodedValue ?? null });
        continue;
      }
      if (decodedValue === undefined) {
        // A scalar the schema defaulted is not a loss; a collection that vanished
        // entirely is caught by the `empty` branch above.
        if (shapeOf(value) === 'scalar') continue;
        mismatches.push({ nodeId: id, nodeName: name, field, kind: 'missing', written: value, decoded: null });
        continue;
      }
      const writtenShape = shapeOf(value);
      const decodedShape = shapeOf(decodedValue);
      if (writtenShape !== decodedShape && writtenShape !== 'null' && decodedShape !== 'null') {
        mismatches.push({ nodeId: id, nodeName: name, field, kind: 'shape', written: value, decoded: decodedValue });
      }
    }
  }
  return mismatches;
}
