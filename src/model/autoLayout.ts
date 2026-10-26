import { clampSize } from './sizing';
import { firstVisibleFill } from './paint';
import type { AnyNode, AutoLayout, GridTrackSize, PigmaFile, SceneNode } from './types';
import { hasChildren } from './types';
import { findNode, findParent, updateNode } from './tree';

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

/**
 * How many rows a grid uses: the declared ones, or more when auto-placement or a
 * manual anchor needs them. Shared by the layout pass and the panel's row count.
 */
export function gridRowCount(children: SceneNode[], layout: AutoLayout): number {
  const columnCount = Math.max(1, (layout.gridColumns ?? []).length);
  // Auto-placement can need more rows than declared; a manual anchor can too.
  const neededRows = children.reduce((max, child) => Math.max(max, Math.round(child.gridRowAnchorIndex ?? 0) + Math.max(1, Math.round(child.gridRowSpan ?? 1))), 0);
  const autoRows = Math.max(1, Math.ceil(children.length / columnCount));
  return Math.max(1, (layout.gridRows ?? []).length, neededRows, autoRows);
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
  const rowCount = gridRowCount(children, layout);

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
    let probe = layout.gridDense ? { column: 0, row: 0 } : cursor;
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
      const inset = 2 * boxInset(entry.child, layout);
      return Math.max(max, (axis === 'column' ? entry.child.width : entry.child.height) + inset);
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
    // The cell is the child's box: with strokes in the layout, the geometry fills the cell less the stroke, inset by one side.
    const inset = boxInset(child, layout);
    const tx = (columnOffsets[cell.column] ?? pad.left) + inset;
    const ty = (rowOffsets[cell.row] ?? pad.top) + inset;
    const targetWidth = spanWidth - 2 * inset;
    const targetHeight = spanHeight - 2 * inset;
    const moved = child.transform.tx !== tx || child.transform.ty !== ty;
    const resized = child.width !== targetWidth || child.height !== targetHeight;
    if (!moved && !resized) return child;
    changed = true;
    // A grid child fills its cell, exactly as a stretched auto-layout child does.
    const placed = { ...child, width: targetWidth, height: targetHeight, transform: { ...child.transform, tx, ty } };
    return resized ? reflowTree(pinAxis(placed, child.width !== targetWidth, child.height !== targetHeight)) : placed;
  });

  if (!changed) return node;
  return { ...node, width, height, children: nextChildren } as T;
}

/**
 * How far a child's visible stroke reaches past its geometry on each side: none for an inside stroke, half the weight for
 * a centred one, the full weight for an outside one. A child with no visible stroke reaches nowhere.
 */
export function strokeInsetOf(node: SceneNode): number {
  if (!firstVisibleFill(node.strokes)) return 0;
  const weight = node.strokeWeight ?? 1;
  const align = node.strokeAlign ?? 'CENTER';
  if (align === 'INSIDE') return 0;
  return align === 'OUTSIDE' ? weight : weight / 2;
}

/** The stroke reach a child adds to its layout box, when its container counts strokes; zero otherwise. */
function boxInset(child: SceneNode, layout: AutoLayout): number {
  return layout.strokesIncludedInLayout ? strokeInsetOf(child) : 0;
}

/**
 * The box each share child takes along one axis: its percent of the inner size on that axis, less the spacing between
 * children, clamped to the child's own limits. The box includes the stroke reach, as `primaryOf` and `counterOf` do.
 */
function shareBoxes(
  children: SceneNode[],
  key: 'layoutPercent' | 'layoutCounterPercent',
  axis: 'width' | 'height',
  inner: number,
  spacing: number,
  insetOf: (child: SceneNode) => number,
): Map<SceneNode, number> {
  const boxes = new Map<SceneNode, number>();
  const shared = Math.max(0, inner - spacing * (children.length - 1));
  for (const child of children) {
    const percent = child[key];
    if (percent === undefined) continue;
    const inset = insetOf(child);
    const share = (shared * percent) / 100 - 2 * inset;
    const limited = clampSize(child, axis === 'width' ? share : child.width, axis === 'height' ? share : child.height);
    boxes.set(child, limited[axis] + 2 * inset);
  }
  return boxes;
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

  // With strokes in the layout, a child's box is its geometry plus its stroke on both sides; the geometry is placed inside.
  const insetOf = (child: SceneNode) => boxInset(child, layout);
  // Sizing modes are named after the axes, not the orientation.
  const primaryAuto = layout.primaryAxisSizingMode === 'AUTO';
  const counterAuto = layout.counterAxisSizingMode === 'AUTO';

  // A percent child takes its share of a fixed primary axis. A hugging axis has no size to share, and wrapping breaks lines
  // on the sizes the children already have, so in both cases every child keeps its own size.
  const fixed = clampSize(node, node.width, node.height);
  const innerPrimary = (horizontal ? fixed.width : fixed.height) - primaryPadding;
  const innerCounter = (horizontal ? fixed.height : fixed.width) - counterPadding;
  const wrapping = layout.layoutWrap === 'WRAP';
  const shares =
    primaryAuto || wrapping
      ? new Map<SceneNode, number>()
      : shareBoxes(children, 'layoutPercent', horizontal ? 'width' : 'height', innerPrimary, spacing, insetOf);
  // A child's cross share is no spacing, since spacing only separates children along the primary axis.
  const counterShares =
    counterAuto || wrapping
      ? new Map<SceneNode, number>()
      : shareBoxes(children, 'layoutCounterPercent', horizontal ? 'height' : 'width', innerCounter, 0, insetOf);
  const primaryOf = (child: SceneNode) => shares.get(child) ?? (horizontal ? child.width : child.height) + 2 * insetOf(child);
  const counterOf = (child: SceneNode) => counterShares.get(child) ?? (horizontal ? child.height : child.width) + 2 * insetOf(child);

  const naturalPrimary = children.reduce((sum, child) => sum + primaryOf(child), 0) + spacing * (children.length - 1);
  const naturalCounter = Math.max(0, ...children.map(counterOf));

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
      if (counterShares.has(child) || child.layoutAlign !== 'STRETCH') return counterOf(child);
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

      // The box is measured with the stroke; the geometry is the box less the stroke on both sides, inset by one side.
      const inset = insetOf(child);
      const tx = horizontal ? cursorPrimary + inset : cursorCounter + crossStart + pad.left + inset;
      const ty = horizontal ? cursorCounter + crossStart + pad.top + inset : cursorPrimary + inset;
      const targetWidth = (horizontal ? main : cross) - 2 * inset;
      const targetHeight = (horizontal ? cross : main) - 2 * inset;

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

/**
 * Which part of an auto layout parent's layout a child's width or height falls under: the parent's main axis (`primary`,
 * fill is `layoutGrow`) or its cross axis (`counter`, fill is `layoutAlign: 'STRETCH'`). Null when the parent does not lay
 * the child out on that axis: no parent layout, or a grid, where a child already fills its own cell.
 */
export function fillAxisOf(parent: AutoLayout | null | undefined, axis: 'width' | 'height'): 'primary' | 'counter' | null {
  if (!parent || parent.layoutMode === 'NONE' || parent.layoutMode === 'GRID') return null;
  const horizontal = parent.layoutMode === 'HORIZONTAL';
  return (axis === 'width') === horizontal ? 'primary' : 'counter';
}

/** Whether a child fills its auto layout parent on one axis: "Fill container" in Figma. */
export function childFillsAxis(child: SceneNode, parent: AutoLayout | null | undefined, axis: 'width' | 'height'): boolean {
  const kind = fillAxisOf(parent, axis);
  if (kind === 'primary') return (child.layoutGrow ?? 0) > 0;
  if (kind === 'counter') return child.layoutAlign === 'STRETCH';
  return false;
}

/**
 * The fields that make a child fill, or stop filling, on one axis of its auto layout parent. Figma: "Fill container can be
 * applied only to child objects of auto layout frames", and "Fixed" is the other choice. Null where the parent does not
 * lay the child out on that axis.
 */
export function fillPatchOf(
  parent: AutoLayout | null | undefined,
  axis: 'width' | 'height',
  fill: boolean,
): Pick<SceneNode, 'layoutGrow' | 'layoutAlign'> | null {
  const kind = fillAxisOf(parent, axis);
  if (kind === 'primary') return { layoutGrow: fill ? 1 : 0 };
  if (kind === 'counter') return { layoutAlign: fill ? 'STRETCH' : 'INHERIT' };
  return null;
}

/**
 * Set Fill container, or Fixed, on one axis of each node that an auto layout parent lays out on that axis. A node whose
 * parent does not lay it out on that axis is left as it is. A parent that hugs the axis a child fills becomes Fixed there,
 * as Figma's help says: "the parent frame will no longer hug contents and become Fixed for the axis". The caller settles
 * the document.
 */
export function setChildFill(file: PigmaFile, nodeIds: readonly string[], axis: 'width' | 'height', fill: boolean): PigmaFile {
  return nodeIds.reduce((next, id) => {
    const parent = findParent(next.document, id);
    const layout = parent ? autoLayoutOf(parent) : null;
    const patch = fillPatchOf(layout, axis, fill);
    if (!parent || !layout || !patch) return next;
    let document = updateNode(next.document, id, (node) => {
      const updated = { ...node, ...patch } as SceneNode;
      // A share takes the place of Fill on its axis, so either choice there clears that axis's share.
      const kind = fillAxisOf(layout, axis);
      if (kind === 'primary') delete updated.layoutPercent;
      if (kind === 'counter') delete updated.layoutCounterPercent;
      return updated as AnyNode;
    });
    const sizing = fillAxisOf(layout, axis) === 'primary' ? 'primaryAxisSizingMode' : 'counterAxisSizingMode';
    if (fill && layout[sizing] === 'AUTO') {
      document = updateNode(document, parent.id, (node) => ({ ...node, autoLayout: { ...layout, [sizing]: 'FIXED' } }) as AnyNode);
    }
    return { ...next, document };
  }, file);
}

/**
 * Whether a child of this parent can take a share of the primary axis: a non-wrapping row or column. Grids keep their
 * own cell sizes, and a wrapped line is packed on the sizes its children already have.
 */
export function canShareChild(parent: AutoLayout | null | undefined): boolean {
  if (!parent) return false;
  return (parent.layoutMode === 'HORIZONTAL' || parent.layoutMode === 'VERTICAL') && parent.layoutWrap !== 'WRAP';
}

/**
 * Set the share of the primary axis each node takes, 0 to 100, or clear it with null or 0. A share replaces Fill on that
 * axis, so Fill is cleared with it. A parent whose primary axis hugs becomes Fixed there, as Fill does, since a share needs
 * a size to take. A node whose parent cannot share is left as it is. The caller settles the document.
 */
export function setChildPercent(file: PigmaFile, nodeIds: readonly string[], percent: number | null): PigmaFile {
  return setShareOp(file, nodeIds, 'primary', percent);
}

/**
 * Set the share of the cross axis each node takes, 0 to 100, or clear it with null or 0. It replaces stretch on that axis,
 * and a parent whose cross axis hugs becomes Fixed there. The same rules as `setChildPercent` otherwise.
 */
export function setChildCounterPercent(file: PigmaFile, nodeIds: readonly string[], percent: number | null): PigmaFile {
  return setShareOp(file, nodeIds, 'counter', percent);
}

function setShareOp(file: PigmaFile, nodeIds: readonly string[], kind: 'primary' | 'counter', percent: number | null): PigmaFile {
  const share = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const key = kind === 'primary' ? 'layoutPercent' : 'layoutCounterPercent';
  const sizing = kind === 'primary' ? 'primaryAxisSizingMode' : 'counterAxisSizingMode';
  return nodeIds.reduce((next, id) => {
    const parent = findParent(next.document, id);
    const layout = parent ? autoLayoutOf(parent) : null;
    if (!parent || !layout || !canShareChild(layout)) return next;
    let document = updateNode(next.document, id, (node) => {
      const updated = { ...node } as SceneNode;
      if (share > 0) {
        if (kind === 'primary') {
          updated.layoutPercent = share;
          updated.layoutGrow = 0;
        } else {
          updated.layoutCounterPercent = share;
          updated.layoutAlign = 'INHERIT';
        }
      } else {
        delete updated[key];
      }
      return updated as AnyNode;
    });
    if (share > 0 && layout[sizing] === 'AUTO') {
      document = updateNode(document, parent.id, (node) => ({ ...node, autoLayout: { ...layout, [sizing]: 'FIXED' } }) as AnyNode);
    }
    return { ...next, document };
  }, file);
}

/**
 * Figma: "Dragging a layer's edge or typing a width or height switches that axis to Fixed." A child that fills an auto layout
 * parent on an axis the edit changed stops filling it, so the layout does not put its size back on the next settle. The
 * axes are compared between `before` and `after`, and the fill is cleared in `after`. Callers pass `after` before it is
 * settled, since settling is what would undo the new size.
 */
export function fixResizedAxes(before: PigmaFile, after: PigmaFile, nodeIds: readonly string[]): PigmaFile {
  return nodeIds.reduce((next, id) => {
    const was = findNode(before.document, id);
    const now = findNode(next.document, id);
    if (!was || !now) return next;
    const changed: Array<'width' | 'height'> = [];
    if (was.width !== now.width) changed.push('width');
    if (was.height !== now.height) changed.push('height');
    return changed.reduce((current, axis) => {
      const parent = findParent(current.document, id);
      const layout = parent ? autoLayoutOf(parent) : null;
      const node = findNode(current.document, id);
      const kind = fillAxisOf(layout, axis);
      const shares =
        (kind === 'primary' && (node as SceneNode | undefined)?.layoutPercent !== undefined) ||
        (kind === 'counter' && (node as SceneNode | undefined)?.layoutCounterPercent !== undefined);
      if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS' || (!childFillsAxis(node as SceneNode, layout, axis) && !shares)) {
        return current;
      }
      return setChildFill(current, [id], axis, false);
    }, next);
  }, after);
}
