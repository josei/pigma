import { clampSize } from './sizing';
import type { AnyNode, AutoLayout, SceneNode } from './types';
import { hasChildren } from './types';

/**
 * Auto-layout reflow.
 *
 * Implements the Figma layout model: children are laid out along the primary
 * axis in order, with padding, item spacing, primary/counter axis alignment,
 * `layoutGrow` on the primary axis and `layoutAlign: 'STRETCH'` on the counter
 * axis. `primaryAxisSizingMode`/`counterAxisSizingMode` = `AUTO` make the frame
 * hug its content.
 *
 * With `layoutWrap: 'WRAP'` the children are packed into lines that fit the
 * available primary space; each line is aligned independently, lines are stacked
 * with `counterAxisSpacing`, and a hugging counter axis grows to fit every line.
 * A hugging primary axis only wraps when something limits it (a fixed size or a
 * max-width/min-width limit), which is exactly Figma's behaviour.
 *
 * The pass is bottom-up and idempotent: running it twice produces the same
 * document, and untouched nodes keep their identity so undo/redo comparisons and
 * React re-renders stay cheap.
 */

export function autoLayoutOf(node: AnyNode): AutoLayout | null {
  if (!hasChildren(node)) return null;
  const layout = (node as { autoLayout?: AutoLayout }).autoLayout;
  if (!layout || layout.layoutMode === 'NONE') return null;
  return layout;
}

interface Paddings {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function paddings(layout: AutoLayout): Paddings {
  return {
    top: layout.paddingTop ?? 0,
    right: layout.paddingRight ?? 0,
    bottom: layout.paddingBottom ?? 0,
    left: layout.paddingLeft ?? 0,
  };
}

/**
 * Pin the axes a parent just sized, so the child's own reflow cannot hug them
 * back. The parent's orientation is irrelevant here: what matters is which
 * dimension changed, mapped onto the child's own primary/counter axes.
 */
function pinAxis<T extends AnyNode>(child: T, widthChanged: boolean, heightChanged: boolean): T {
  const layout = autoLayoutOf(child);
  if (!layout) return child;
  const vertical = layout.layoutMode === 'VERTICAL';
  const next: AutoLayout = { ...layout };
  if (widthChanged) {
    if (vertical) next.counterAxisSizingMode = 'FIXED';
    else next.primaryAxisSizingMode = 'FIXED';
  }
  if (heightChanged) {
    if (vertical) next.primaryAxisSizingMode = 'FIXED';
    else next.counterAxisSizingMode = 'FIXED';
  }
  return { ...child, autoLayout: next } as T;
}

/** Lay out one auto-layout container. Returns the same node when nothing moved. */
function layoutContainer<T extends AnyNode>(node: T, layout: AutoLayout): T {
  if (!hasChildren(node)) return node;
  const children = node.children as SceneNode[];
  if (children.length === 0) return node;

  const horizontal = layout.layoutMode === 'HORIZONTAL';
  const pad = paddings(layout);
  const spacing = layout.itemSpacing ?? 0;
  const primaryPadding = horizontal ? pad.left + pad.right : pad.top + pad.bottom;
  const counterPadding = horizontal ? pad.top + pad.bottom : pad.left + pad.right;

  const primaryOf = (child: SceneNode) => (horizontal ? child.width : child.height);
  const counterOf = (child: SceneNode) => (horizontal ? child.height : child.width);

  const naturalPrimary = children.reduce((sum, child) => sum + primaryOf(child), 0) + spacing * (children.length - 1);
  const naturalCounter = Math.max(0, ...children.map(counterOf));

  // Sizing modes are named after the axes, not the orientation.
  const primaryAuto = layout.primaryAxisSizingMode === 'AUTO';
  const counterAuto = layout.counterAxisSizingMode === 'AUTO';

  let width = node.width;
  let height = node.height;
  if (horizontal) {
    if (primaryAuto) width = primaryPadding + naturalPrimary;
  } else if (primaryAuto) {
    height = primaryPadding + naturalPrimary;
  }
  // The counter axis may hug a single line, or every wrapped line; resolve it
  // after wrapping, so a first pass uses the single-line height.
  if (horizontal) {
    if (counterAuto) height = counterPadding + naturalCounter;
  } else if (counterAuto) {
    width = counterPadding + naturalCounter;
  }
  // Min/max limits clamp a hug (Figma: the frame stops at its maximum and the
  // content overflows rather than growing further).
  ({ width, height } = clampSize(node, width, height));

  const availablePrimary = Math.max(0, (horizontal ? width : height) - primaryPadding);

  // Pack the children into lines. Without WRAP, or when nothing limits the
  // primary axis, everything fits on one line.
  const wrap = layout.layoutWrap === 'WRAP';
  const lines: SceneNode[][] = [];
  if (wrap) {
    let line: SceneNode[] = [];
    let used = 0;
    for (const child of children) {
      const size = primaryOf(child);
      const needed = line.length === 0 ? size : used + spacing + size;
      if (line.length > 0 && needed > availablePrimary) {
        lines.push(line);
        line = [child];
        used = size;
        continue;
      }
      line.push(child);
      used = needed;
    }
    if (line.length > 0) lines.push(line);
  } else {
    lines.push(children);
  }

  const lineCounterSpacing = layout.counterAxisSpacing ?? 0;
  const lineHeightOf = (line: SceneNode[]) => Math.max(0, ...line.map(counterOf));
  const lineHeights = lines.map(lineHeightOf);

  if (wrap && counterAuto) {
    // A hugging counter axis grows to fit every line plus the line spacing.
    const stacked = lineHeights.reduce((sum, value) => sum + value, 0) + lineCounterSpacing * (lines.length - 1);
    if (horizontal) height = counterPadding + stacked;
    else width = counterPadding + stacked;
    ({ width, height } = clampSize(node, width, height));
  }

  const availableCounter = Math.max(0, (horizontal ? height : width) - counterPadding);
  const counterAlign = layout.counterAxisAlignItems ?? 'MIN';
  const primaryAlign = layout.primaryAxisAlignItems ?? 'MIN';
  let changed = width !== node.width || height !== node.height;
  const nextChildren: SceneNode[] = [];
  // Counter cursor is relative to the padded content box; padding is applied once
  // at the placement site.
  let cursorCounter = 0;

  lines.forEach((line, lineIndex) => {
    const lineHeight = lineHeights[lineIndex] ?? 0;
    // `layoutGrow` only absorbs slack on the last line, like Figma.
    const isLastLine = lineIndex === lines.length - 1;
    const lineNatural = line.reduce((sum, child) => sum + primaryOf(child), 0) + spacing * (line.length - 1);
    const lineExtra = isLastLine ? availablePrimary - lineNatural : 0;
    const growers = isLastLine ? line.filter((child) => (child.layoutGrow ?? 0) > 0) : [];
    const growShare = growers.length > 0 && lineExtra > 0 ? lineExtra / growers.length : 0;
    const primarySize = (child: SceneNode) => {
      const base = primaryOf(child);
      if (growShare === 0 || (child.layoutGrow ?? 0) <= 0) return base;
      return base + growShare;
    };
    const counterSize = (child: SceneNode) => {
      if (child.layoutAlign !== 'STRETCH') return counterOf(child);
      // In a wrapped line a stretched child fills the line, not the whole frame.
      return wrap ? lineHeight : availableCounter;
    };
    const primaryTotal = line.reduce((sum, child) => sum + primarySize(child), 0) + spacing * (line.length - 1);

    let cursorPrimary = horizontal ? pad.left : pad.top;
    let gap = spacing;
    if (primaryAlign === 'CENTER') cursorPrimary += Math.max(0, availablePrimary - primaryTotal) / 2;
    else if (primaryAlign === 'MAX') cursorPrimary += Math.max(0, availablePrimary - primaryTotal);
    else if (primaryAlign === 'SPACE_BETWEEN' && line.length > 1) {
      gap = spacing + Math.max(0, availablePrimary - primaryTotal) / (line.length - 1);
    }

    for (const child of line) {
      const cross = counterSize(child);
      const main = primarySize(child);
      // Counter placement is inside the line, so wrapped lines align
      // independently; an unwrapped frame aligns inside its own counter space.
      const counterExtent = wrap ? lineHeight : availableCounter;
      const crossStart =
        child.layoutAlign === 'STRETCH' || counterAlign === 'MIN' || counterAlign === 'BASELINE'
          ? 0
          : counterAlign === 'CENTER'
            ? (counterExtent - cross) / 2
            : counterExtent - cross;

      const tx = horizontal ? cursorPrimary : cursorCounter + crossStart + pad.left;
      const ty = horizontal ? cursorCounter + crossStart + pad.top : cursorPrimary;
      const targetWidth = horizontal ? main : cross;
      const targetHeight = horizontal ? cross : main;

      const moved = child.transform.tx !== tx || child.transform.ty !== ty;
      const resized = child.width !== targetWidth || child.height !== targetHeight;
      if (moved || resized) {
        changed = true;
        const stretched = { ...child, width: targetWidth, height: targetHeight, transform: { ...child.transform, tx, ty } };
        // A stretched child may itself be an auto-layout frame: pin the axis the
        // parent controls (Figma turns it into a fixed/FILL sizing), then settle
        // its contents for the new size in the same pass.
        nextChildren.push(
          resized
            ? reflowTree(pinAxis(stretched, child.width !== targetWidth, child.height !== targetHeight))
            : stretched,
        );
      } else {
        nextChildren.push(child);
      }
      cursorPrimary += main + gap;
    }
    cursorCounter += lineHeight + lineCounterSpacing;
  });

  if (!changed) return node;
  return { ...node, width, height, children: nextChildren } as T;
}

/**
 * Reflow every auto-layout container in the subtree, deepest first so nested
 * layouts settle before their parents measure them.
 */
export function reflowTree<T extends AnyNode>(root: T): T {
  if (!hasChildren(root)) return root;
  const source = root.children as AnyNode[];
  let changed = false;
  const children = source.map((child) => {
    const reflowed = reflowTree(child);
    if (reflowed !== child) changed = true;
    return reflowed;
  });

  const withChildren = changed ? ({ ...root, children } as T) : root;
  const layout = autoLayoutOf(withChildren);
  if (!layout) return withChildren;
  return layoutContainer(withChildren, layout);
}

export function defaultAutoLayout(mode: 'HORIZONTAL' | 'VERTICAL'): AutoLayout {
  return {
    layoutMode: mode,
    primaryAxisSizingMode: 'AUTO',
    counterAxisSizingMode: 'AUTO',
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'MIN',
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    itemSpacing: 12,
  };
}
