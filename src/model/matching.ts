import type { AnyNode, PigmaFile } from './types';
import { hasChildren } from './types';
import { findNode, findPath } from './tree';

/**
 * Select all matching (Figma's "Select all matching layers"). The search is the top-level layer that holds the
 * selection (its frame, group or section), or the page when the selection is itself top-level. A layer matches when
 * it has the same type and name as the selected one. An instance matches an instance of the same component. The
 * rule is ours where Figma's help does not define it. Returns the matching ids, the selected
 * one included, in document order.
 */
export function matchingLayerIds(file: PigmaFile, id: string): string[] {
  const target = findNode(file.document, id);
  const path = findPath(file.document, id);
  if (!target || !path || path.length < 3) return [];
  // path: document, page, ...layers. The search is the layer under the page that holds the selection, or the page.
  const scope = path.length > 3 ? path[2]! : path[1]!;

  const matches = (node: AnyNode) => {
    if (target.type === 'INSTANCE') {
      return node.type === 'INSTANCE' && node.componentId === target.componentId;
    }
    return node.type === target.type && node.name === target.name;
  };

  const found: string[] = [];
  const walk = (node: AnyNode) => {
    if (matches(node)) found.push(node.id);
    if (hasChildren(node)) for (const child of node.children) walk(child as AnyNode);
  };
  if (hasChildren(scope)) for (const child of scope.children) walk(child as AnyNode);
  if (scope.id === id) found.unshift(id);
  return found;
}
