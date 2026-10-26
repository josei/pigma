import type { AnyNode, PigmaFile } from './types';
import { findNode, updateNode } from './tree';

export type GridAxis = 'column' | 'row';

/**
 * The tracks that move together when `from` is dragged: `from` itself, plus every track a child
 * spans that includes one of them, repeated until nothing new joins (Figma: "if a cell object spans
 * into other tracks, those tracks move along with it"). Returned in their current order.
 */
function movingGroup(children: AnyNode[], anchorKey: string, spanKey: string, from: number, count: number): number[] {
  const group = new Set([from]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const child of children) {
      const start = (child as unknown as Record<string, unknown>)[anchorKey];
      if (typeof start !== 'number' || start < 0 || start >= count) continue;
      const span = Math.max(1, Math.min(count - start, ((child as unknown as Record<string, unknown>)[spanKey] as number | undefined) ?? 1));
      const covered = Array.from({ length: span }, (_, i) => start + i);
      if (!covered.some((index) => group.has(index))) continue;
      for (const index of covered) {
        if (!group.has(index)) {
          group.add(index);
          grew = true;
        }
      }
    }
  }
  return [...group].sort((a, b) => a - b);
}

/**
 * Move a declared row or column of a grid frame to another position (Figma: drag a track's grabber
 * to reorder it). The track keeps its size. A child that spans several tracks takes them along, so
 * its span stays together; every anchored child follows its track to the new index, and children
 * that are auto-placed are unchanged.
 *
 * `to` is the position the moved tracks start at, after they are taken out.
 *
 * Returns the file unchanged when the frame is not a grid, a track does not exist, or the move
 * would not change the order.
 */
export function moveGridTrack(file: PigmaFile, frameId: string, axis: GridAxis, from: number, to: number): PigmaFile {
  const frame = findNode(file.document, frameId);
  if (!frame || !('autoLayout' in frame) || frame.autoLayout?.layoutMode !== 'GRID') return file;
  const key = axis === 'column' ? 'gridColumns' : 'gridRows';
  const anchorKey = axis === 'column' ? 'gridColumnAnchorIndex' : 'gridRowAnchorIndex';
  const spanKey = axis === 'column' ? 'gridColumnSpan' : 'gridRowSpan';
  const tracks = frame.autoLayout[key];
  if (!tracks || from === to || from < 0 || to < 0 || from >= tracks.length || to >= tracks.length) return file;

  const children = ('children' in frame ? frame.children : []) as AnyNode[];
  const group = movingGroup(children, anchorKey, spanKey, from, tracks.length);
  const rest = tracks.map((_, index) => index).filter((index) => !group.includes(index));
  // The group goes back in at `to`, as one block in its own order.
  const order = [...rest.slice(0, Math.min(to, rest.length)), ...group, ...rest.slice(Math.min(to, rest.length))];
  if (order.every((old, position) => old === position)) return file;
  // newIndex[old] is where the track formerly at `old` now sits.
  const newIndex: number[] = [];
  order.forEach((old, position) => (newIndex[old] = position));

  return {
    ...file,
    document: updateNode(file.document, frameId, (node) => {
      if (!('autoLayout' in node) || !node.autoLayout) return node;
      const reordered = order.map((old) => tracks[old]!);
      const moved = ('children' in node ? node.children : []).map((child) => {
        const anchor = (child as unknown as Record<string, unknown>)[anchorKey];
        if (typeof anchor !== 'number' || anchor < 0 || anchor >= tracks.length) return child;
        return { ...child, [anchorKey]: newIndex[anchor] };
      });
      return { ...node, autoLayout: { ...node.autoLayout, [key]: reordered }, children: moved } as typeof node;
    }),
  };
}
