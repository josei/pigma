import type { AnyNode, PigmaFile, TextNode } from './types';
import { hasChildren } from './types';
import { walk } from './tree';
import { layoutText } from '../render/textMetrics';

/**
 * Keep auto-sized text nodes in sync with their measured content so selection
 * boxes, hit testing and export all agree with what is rendered.
 */
export function syncTextSizes(file: PigmaFile): PigmaFile {
  let document = file.document;
  const updates: Array<{ id: string; width: number; height: number }> = [];

  walk(document, (node) => {
    if (node.type !== 'TEXT') return;
    const text = node as TextNode;
    const mode = text.style.textAutoResize ?? 'WIDTH_AND_HEIGHT';
    if (mode === 'NONE' || mode === 'TRUNCATE') return;
    const wrap = mode === 'HEIGHT';
    const layout = layoutText(text.characters, text.style, text.width, wrap);
    const width = wrap ? text.width : Math.max(1, Math.ceil(layout.width));
    const height = Math.max(1, Math.ceil(layout.height));
    if (Math.abs(width - text.width) > 0.01 || Math.abs(height - text.height) > 0.01) {
      updates.push({ id: text.id, width, height });
    }
  });

  if (updates.length === 0) return file;
  // One pass over the tree applies every measured box. Applying them one
  // `updateNode` at a time was O(changed x nodes): each call rebuilt the whole
  // path, so settling a document with thousands of auto-sized text nodes grew
  // superlinearly. The measurements above are unchanged, and a node whose box is
  // already right is returned untouched, so nothing churns.
  const sizes = new Map(updates.map((update) => [update.id, update]));
  return { ...file, document: applySizes(document, sizes) };
}

/** Apply measured boxes in a single traversal, preserving identity where unchanged. */
function applySizes<T extends AnyNode>(root: T, sizes: Map<string, { width: number; height: number }>): T {
  const size = sizes.get(root.id);
  let node: T = size ? ({ ...root, ...size } as T) : root;
  if (!hasChildren(node)) return node;
  const source = node.children as AnyNode[];
  const children = source.map((child) => applySizes(child, sizes));
  if (children.every((child, index) => child === source[index])) return node;
  return { ...node, children } as T;
}
