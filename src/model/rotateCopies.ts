import { fromTRS, invert, multiply, translate } from './matrix';
import { duplicateNodes } from './ops';
import type { AnyNode, PigmaFile, Transform } from './types';
import { absoluteBounds, findNode, parentAndIndex, parentWorldTransform, unionRects, updateNode, worldTransform } from './tree';

/**
 * The pivot of a selection: the bottom-centre of its bounds. One layer fans its copies out from its base, and a group turns
 * about one shared point.
 */
function pivotOf(file: PigmaFile, ids: readonly string[]): { x: number; y: number } | null {
  const box = ids
    .map((id) => absoluteBounds(file.document, id))
    .filter((rect) => rect !== null)
    .reduce<ReturnType<typeof unionRects> | null>((all, rect) => unionRects(all, rect), null);
  return box ? { x: box.x + box.width / 2, y: box.y + box.height } : null;
}

/**
 * Rotate copies: each selected layer gets `count` copies, and the k-th copy is turned k × `angle` degrees around the
 * selection's pivot (see `pivotOf`). Locked layers, and anything that is not a layer, are left out. The caller settles the
 * document.
 */
export function rotateCopies(file: PigmaFile, ids: readonly string[], options: { count: number; angle: number }): PigmaFile {
  if (!Number.isFinite(options.angle) || !Number.isFinite(options.count)) return file;
  const count = Math.min(99, Math.max(1, Math.round(options.count)));
  const originals = ids.filter((id) => {
    const node = findNode(file.document, id);
    return !!node && node.type !== 'DOCUMENT' && node.type !== 'CANVAS' && !node.locked;
  });
  const pivot = pivotOf(file, originals);
  if (!pivot) return file;

  let next = file;
  for (const id of originals) {
    const world = worldTransform(file.document, id);
    for (let step = 1; step <= count; step += 1) {
      // A duplicate lands right after its original, so the copy is the sibling just after it. The original is never turned.
      const duplicated = duplicateNodes(next, [id]).file;
      const location = parentAndIndex(duplicated.document, id);
      const copy = location?.parent.children[location.index + 1];
      if (!location || !copy) continue;
      const turn = multiply(translate(pivot.x, pivot.y), multiply(fromTRS(0, 0, step * options.angle), translate(-pivot.x, -pivot.y)));
      const local: Transform = multiply(invert(parentWorldTransform(duplicated.document, copy.id)), multiply(turn, world));
      next = {
        ...duplicated,
        document: updateNode(duplicated.document, copy.id, (node) => ({ ...node, transform: local }) as AnyNode),
        lastModified: Date.now(),
      };
    }
  }
  return next;
}
