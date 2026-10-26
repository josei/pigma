import type { AnyNode, Rect } from './types';
import { absoluteBounds } from './tree';

/**
 * The visible children of a container whose bounds intersect a rectangle, in child order.
 * The marquee and keyboard box selection share this rule: a layer is selected when any part
 * of it lies inside the box.
 */
export function layersInRect(
  document: AnyNode,
  container: { children: ReadonlyArray<{ id: string; visible?: boolean }> },
  rect: Rect,
): string[] {
  const ids: string[] = [];
  for (const child of container.children) {
    if (child.visible === false) continue;
    const bounds = absoluteBounds(document, child.id);
    if (!bounds) continue;
    const intersects =
      bounds.x < rect.x + rect.width &&
      rect.x < bounds.x + bounds.width &&
      bounds.y < rect.y + rect.height &&
      rect.y < bounds.y + bounds.height;
    if (intersects) ids.push(child.id);
  }
  return ids;
}
