import type { SceneNode } from '../model/types';
import { hasChildren } from '../model/types';

/**
 * The layer ids in the order the Layers panel draws them, top to bottom: each level is listed reversed (the
 * panel shows the last child first), and a row's children follow it only while the row is expanded. Shift-click
 * selects the rows between the anchor and the clicked row in this order (Figma's range select).
 */
export function layerRowOrder(children: readonly SceneNode[], expanded: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  for (const child of [...children].reverse()) {
    ids.push(child.id);
    if (hasChildren(child) && child.children.length > 0 && expanded.has(child.id)) {
      ids.push(...layerRowOrder(child.children as SceneNode[], expanded));
    }
  }
  return ids;
}
