import { clampSize } from './sizing';
import type { AnyNode, AutoLayout, GridTrackSize, SceneNode } from './types';
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

/**
 * Resolve one axis of tracks against the space available.
 *
 * Figma's order: FIXED tracks take their pixel size, and what is left after the
 * fixed tracks and the gaps is shared by the FLEX tracks in proportion to their
 * `fr` weights. `available` is the content box; when a track list runs out the
 * last track repeats, so a child placed past the declared columns still lands.
 */
function trackSizes(tracks: GridTrackSize[], available: number, gap: number, count: number): number[] {
  const list = tracks.length > 0 ? tracks : [{ type: 'FLEX' as const, value: 1 }];
  // The last declared track repeats, so a child past the declared tracks lands.
  const picked: GridTrackSize[] = [];
  for (let index = 0; index < count; index += 1) picked.push(list[Math.min(index, list.length - 1)]!);
  const gaps = gap * Math.max(0, count - 1);
  const fixed = picked.reduce((sum, track) => sum + (track.type === 'FIXED' ? track.value : 0), 0);
  const weight = picked.reduce((sum, track) => sum + (track.type === 'FLEX' ? track.value : 0), 0);
  const flexible = Math.max(0, available - gaps - fixed);
  return picked.map((track) => {
    if (track.type === 'FIXED') return track.value;
    if (weight <= 0) return 0;
    return (flexible * track.value) / weight;
  });
}

/** The grid cell a child occupies, resolved to a track index and a span. */
function gridCell(child: SceneNode, columnCount: number, rowCount: number): { column: number; row: number; columnSpan: number; rowSpan: number } {
  const columnSpan = Math.max(1, Math.min(columnCount, Math.round(child.gridColumnSpan ?? 1)));
  const rowSpan = Math.max(1, Math.min(rowCount, Math.round(child.gridRowSpan ?? 1)));
  return {
    column: Math.max(0, Math.min(columnCount - columnSpan, Math.round(child.gridColumnAnchorIndex ?? 0))),
    row: Math.max(0, Math.min(rowCount - rowSpan, Math.round(child.gridRowAnchorIndex ?? 0))),
    columnSpan,
    rowSpan,
  };
}

/** Lay out one grid container. Returns the same node when nothing moved. */
function layoutGridContainer<T extends AnyNode>(node: T, layout: AutoLayout): T {
  if (!hasChildren(node)) return node;
  const children = node.children as SceneNode[];
  if (children.length === 0) return node;

  const pad = paddings(layout);
  const columnGap = layout.gridColumnGap ?? 0;
  const rowGap = layout.gridRowGap ?? 0;
  const declaredColumns = layout.gridColumns ?? [];
  const declaredRows = layout.gridRows ?? [];
  const columnCount = Math.max(1, declaredColumns.length);
  // Auto-placement can need more rows than declared; a manual anchor can too.
  const neededRows = children.reduce((max, child) => Math.max(max, Math.round(child.gridRowAnchorIndex ?? 0) + Math.max(1, Math.round(child.gridRowSpan ?? 1))), 0);
  const autoRows = Math.max(1, Math.ceil(children.length / columnCount));
  const rowCount = Math.max(1, declaredRows.length, neededRows, autoRows);

  // Width hugs when the primary axis is AUTO (a grid has no orientation, so the
  // two sizing modes are read as width and height), and height likewise.
  const hugWidth = layout.primaryAxisSizingMode === 'AUTO';
  const hugHeight = layout.counterAxisSizingMode === 'AUTO';

  // Auto-placement walks row-major and skips cells a manually placed child holds,
  // so an explicit anchor keeps its cell instead of being pushed along.
  const occupied = new Set<string>();
  const cells = children.map((child) => {
    const manual = child.gridColumnAnchorIndex !== undefined || child.gridRowAnchorIndex !== undefined;
    return { child, cell: gridCell(child, columnCount, rowCount), manual };
  });
  for (const { cell, manual } of cells) {
    if (!manual) continue;
    for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) {
      for (let column = cell.column; column < cell.column + cell.columnSpan; column += 1) occupied.add(`${column}:${row}`);
    }
  }
  let cursor = { column: 0, row: 0 };
  const advance = (at: { column: number; row: number }) =>
    at.column + 1 >= columnCount ? { column: 0, row: at.row + 1 } : { column: at.column + 1, row: at.row };
  for (const entry of cells) {
    if (entry.manual) continue;
    const holds = (column: number, row: number): boolean => {
      if (column + entry.cell.columnSpan > columnCount || row + entry.cell.rowSpan > rowCount) return false;
      for (let rowOffset = 0; rowOffset < entry.cell.rowSpan; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < entry.cell.columnSpan; columnOffset += 1) {
          if (occupied.has(`${column + columnOffset}:${row + rowOffset}`)) return false;
        }
      }
      return true;
    };
    // A bounded scan: every cell of the grid is tried once. If nothing fits (a
    // span larger than the grid, or a fully pinned grid) the child takes the
    // cursor cell anyway, so placement always terminates.
    let placedAt: { column: number; row: number } | null = null;
    let probe = cursor;
    for (let tries = 0; tries < columnCount * rowCount + columnCount; tries += 1) {
      if (holds(probe.column, probe.row)) {
        placedAt = probe;
        break;
      }
      probe = advance(probe);
    }
    const cell = placedAt ?? cursor;
    entry.cell = { column: cell.column, row: cell.row, columnSpan: entry.cell.columnSpan, rowSpan: entry.cell.rowSpan };
    for (let rowOffset = 0; rowOffset < entry.cell.rowSpan; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < entry.cell.columnSpan; columnOffset += 1) {
        occupied.add(`${cell.column + columnOffset}:${cell.row + rowOffset}`);
      }
    }
    cursor = advance(cell);
  }

  // Track sizes: fixed px first, then the fr weights against what is left. A
  // hugging axis has no leftover to share, so a FLEX track takes the largest
  // child that lands in it — that is what makes a hugging grid wrap its content.
  const natural = (index: number, axis: 'column' | 'row'): number =>
    cells.reduce((max, entry) => {
      const start = axis === 'column' ? entry.cell.column : entry.cell.row;
      const span = axis === 'column' ? entry.cell.columnSpan : entry.cell.rowSpan;
      if (index < start || index >= start + span) return max;
      return Math.max(max, axis === 'column' ? entry.child.width : entry.child.height);
    }, 0);
  const hugAxis = (tracks: GridTrackSize[], count: number, gap: number, axis: 'column' | 'row'): number => {
    const list = tracks.length > 0 ? tracks : [{ type: 'FLEX' as const, value: 1 }];
    const sizes = trackSizes(list, 0, gap, count);
    return sizes.reduce((sum, size, index) => {
      const track = list[Math.min(index, list.length - 1)]!;
      return sum + (track.type === 'FLEX' ? Math.max(size, natural(index, axis)) : size);
    }, gap * Math.max(0, count - 1));
  };
  const width = hugWidth ? pad.left + pad.right + hugAxis(declaredColumns, columnCount, columnGap, 'column') : node.width;
  const height = hugHeight ? pad.top + pad.bottom + hugAxis(declaredRows, rowCount, rowGap, 'row') : node.height;
  const columnSizes = trackSizes(declaredColumns, Math.max(0, width - (pad.left + pad.right)), columnGap, columnCount);
  const rowSizes = trackSizes(declaredRows, Math.max(0, height - (pad.top + pad.bottom)), rowGap, rowCount);
  const columnOffsets: number[] = [];
  const rowOffsets: number[] = [];
  columnSizes.reduce((offset, size) => (columnOffsets.push(offset), offset + size + columnGap), pad.left);
  rowSizes.reduce((offset, size) => (rowOffsets.push(offset), offset + size + rowGap), pad.top);

  let changed = width !== node.width || height !== node.height;
  const nextChildren = children.map((child, index) => {
    const { cell } = cells[index]!;
    const spanWidth = columnSizes.slice(cell.column, cell.column + cell.columnSpan).reduce((sum, size) => sum + size, 0) + columnGap * (cell.columnSpan - 1);
    const spanHeight = rowSizes.slice(cell.row, cell.row + cell.rowSpan).reduce((sum, size) => sum + size, 0) + rowGap * (cell.rowSpan - 1);
    const tx = columnOffsets[cell.column] ?? pad.left;
    const ty = rowOffsets[cell.row] ?? pad.top;
    const moved = child.transform.tx !== tx || child.transform.ty !== ty;
    const resized = child.width !== spanWidth || child.height !== spanHeight;
    if (!moved && !resized) return child;
    changed = true;
    // A grid child fills its cell, exactly as a stretched auto-layout child does.
    const placed = { ...child, width: spanWidth, height: spanHeight, transform: { ...child.transform, tx, ty } };
    return resized ? reflowTree(pinAxis(placed, child.width !== spanWidth, child.height !== spanHeight)) : placed;
  });

  if (!changed) return node;
  return { ...node, width, height, children: nextChildren } as T;
}

/** Lay out one auto-layout container. Returns the same node when nothing moved. */
function layoutContainer<T extends AnyNode>(node: T, layout: AutoLayout): T {
  if (layout.layoutMode === 'GRID') return layoutGridContainer(node, layout);
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

export function defaultAutoLayout(mode: 'HORIZONTAL' | 'VERTICAL' | 'GRID'): AutoLayout {
  if (mode === 'GRID') {
    // Figma's grid starts as two equal columns with even gaps; a grid with no
    // tracks would be a single implicit column, which is not a useful start.
    return {
      layoutMode: 'GRID',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      gridColumns: [{ type: 'FLEX', value: 1 }, { type: 'FLEX', value: 1 }],
      gridRows: [{ type: 'FLEX', value: 1 }],
      gridColumnGap: 12,
      gridRowGap: 12,
    };
  }
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
