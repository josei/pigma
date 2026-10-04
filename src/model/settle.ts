import type { PigmaFile } from './types';
import { reflowTree } from './autoLayout';
import { syncInstances } from './instances';
import { syncTextSizes } from './textSync';
import { refreshBooleans } from './boolean';

/**
 * Bring a document back to a consistent state after an edit:
 *
 *  1. auto-sized text is re-measured (layout and hit testing need real boxes),
 *  2. instances pick up component changes,
 *  3. every auto-layout frame reflows around its new contents,
 *  4. every boolean operation is re-evaluated from its operands, so moving or
 *     resizing an operand changes the result (the geometry is still a flattened
 *     polygon set, but it is computed live rather than baked at creation).
 *
 * Each pass returns its input when nothing changed, so calling this after every
 * mutation costs a walk and never creates spurious undo entries.
 */
export function settleDocument(file: PigmaFile): PigmaFile {
  const measured = syncTextSizes(file);
  const synced = syncInstances(measured.document);
  const reflowed = reflowTree(synced);
  const document = refreshBooleans(reflowed);
  if (document === file.document) return file;
  return { ...file, document };
}
