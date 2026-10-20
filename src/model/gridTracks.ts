import type { PigmaFile } from './types';
import { findNode, updateNode } from './tree';

export type GridAxis = 'column' | 'row';

/**
 * Move one declared track of a grid frame to another position (Figma: drag a track's grabber to
 * reorder it). The track keeps its size; every child anchored to a track follows it to its new
 * index, and children that are auto-placed are unchanged.
 *
 * Returns the file unchanged when the frame is not a grid, a track does not exist, or the move
 * would not change the order.
 */
export function moveGridTrack(file: PigmaFile, frameId: string, axis: GridAxis, from: number, to: number): PigmaFile {
  const frame = findNode(file.document, frameId);
  if (!frame || !('autoLayout' in frame) || frame.autoLayout?.layoutMode !== 'GRID') return file;
  const key = axis === 'column' ? 'gridColumns' : 'gridRows';
  const anchorKey = axis === 'column' ? 'gridColumnAnchorIndex' : 'gridRowAnchorIndex';
  const tracks = frame.autoLayout[key];
  if (!tracks || from === to || from < 0 || to < 0 || from >= tracks.length || to >= tracks.length) return file;

  // The new order: the track at `from` is taken out and reinserted at `to`.
  const order = tracks.map((_, index) => index);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved!);
  // newIndex[old] is where the track formerly at `old` now sits.
  const newIndex: number[] = [];
  order.forEach((old, position) => (newIndex[old] = position));

  return {
    ...file,
    document: updateNode(file.document, frameId, (node) => {
      if (!('autoLayout' in node) || !node.autoLayout) return node;
      const reordered = order.map((old) => tracks[old]!);
      const children = ('children' in node ? node.children : []).map((child) => {
        const anchor = (child as unknown as Record<string, unknown>)[anchorKey];
        if (typeof anchor !== 'number' || anchor < 0 || anchor >= tracks.length) return child;
        return { ...child, [anchorKey]: newIndex[anchor] };
      });
      return { ...node, autoLayout: { ...node.autoLayout, [key]: reordered }, children } as typeof node;
    }),
  };
}
