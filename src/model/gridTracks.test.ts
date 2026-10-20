/**
 * Reordering grid tracks (Figma: drag a track's grabber). The track order and each anchored child's
 * cell are asserted, because a reorder that moves a track but leaves its children behind is the bug.
 */
import { describe, expect, it } from 'vitest';
import { emptyFile } from './validate';
import { createFrameNode, createRectNode } from './factory';
import { moveGridTrack } from './gridTracks';
import { findNode } from './tree';
import type { ContainerNode, GridTrackSize, PigmaFile, SceneNode } from './types';

const FIXED = (value: number): GridTrackSize => ({ type: 'FIXED', value });
const FLEX = (value: number): GridTrackSize => ({ type: 'FLEX', value });

/** A grid frame with three declared columns and one child anchored to each. */
function gridWithAnchoredChildren(): { file: PigmaFile; id: string; children: string[] } {
  const file = emptyFile('Tracks');
  const page = file.document.children[0]!;
  const frame = createFrameNode(file.document, 0, 0, 400, 100);
  frame.autoLayout = {
    layoutMode: 'GRID',
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    gridColumns: [FIXED(100), FLEX(1), FLEX(2)],
    gridRows: [FLEX(1)],
  };
  frame.children = [0, 1, 2].map((column) => {
    const child = createRectNode(file.document, 0, 0, 40, 30);
    child.gridColumnAnchorIndex = column;
    child.gridRowAnchorIndex = 0;
    return child;
  });
  // An auto-placed child: it must not move with any track.
  const auto = createRectNode(file.document, 0, 0, 40, 30);
  frame.children.push(auto);
  page.children = [frame];
  return { file, id: frame.id, children: frame.children.map((child) => child.id) };
}

const childAt = (file: PigmaFile, id: string, index: number): SceneNode =>
  (findNode(file.document, id) as ContainerNode).children[index] as SceneNode;

describe('moveGridTrack', () => {
  it('moves a column and its anchored child, and leaves the other tracks in their order', () => {
    const { file, id, children } = gridWithAnchoredChildren();
    const moved = moveGridTrack(file, id, 'column', 0, 2);
    const frame = findNode(moved.document, id) as ContainerNode & { autoLayout: { gridColumns: GridTrackSize[] } };

    // [100px, 1fr, 2fr] with the first track moved to the end.
    expect(frame.autoLayout.gridColumns).toEqual([FLEX(1), FLEX(2), FIXED(100)]);
    // The child that was in column 0 is now in column 2; the others shift down by one.
    expect(childAt(moved, id, 0).gridColumnAnchorIndex).toBe(2);
    expect(childAt(moved, id, 1).gridColumnAnchorIndex).toBe(0);
    expect(childAt(moved, id, 2).gridColumnAnchorIndex).toBe(1);
    // The auto-placed child keeps no anchor.
    expect(childAt(moved, id, 3).gridColumnAnchorIndex).toBeUndefined();
    expect(children).toHaveLength(4);
  });

  it('moves a row the same way, on the row anchors', () => {
    const file = emptyFile('Rows');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 0, 0, 100, 300);
    frame.autoLayout = {
      layoutMode: 'GRID',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      gridColumns: [FLEX(1)],
      gridRows: [FIXED(50), FIXED(80), FIXED(20)],
    };
    frame.children = [0, 2].map((row) => {
      const child = createRectNode(file.document, 0, 0, 40, 30);
      child.gridRowAnchorIndex = row;
      return child;
    });
    page.children = [frame];

    const moved = moveGridTrack(file, frame.id, 'row', 2, 0);
    const reordered = (findNode(moved.document, frame.id) as ContainerNode & { autoLayout: { gridRows: GridTrackSize[] } }).autoLayout.gridRows;
    expect(reordered).toEqual([FIXED(20), FIXED(50), FIXED(80)]);
    expect(childAt(moved, frame.id, 0).gridRowAnchorIndex).toBe(1);
    // The child on row 2 moves to row 0; the child on row 0 moves to row 1.
    expect(childAt(moved, frame.id, 1).gridRowAnchorIndex).toBe(0);
  });

  it('returns the file unchanged for a move that changes nothing or is not valid', () => {
    const { file, id } = gridWithAnchoredChildren();
    expect(moveGridTrack(file, id, 'column', 1, 1)).toBe(file);
    expect(moveGridTrack(file, id, 'column', 0, 9)).toBe(file);
    expect(moveGridTrack(file, id, 'column', -1, 0)).toBe(file);
    expect(moveGridTrack(file, 'missing', 'column', 0, 1)).toBe(file);
  });

  it('refuses a frame that is not a grid', () => {
    const file = emptyFile('Not grid');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 0, 0, 100, 100);
    frame.autoLayout = {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    };
    page.children = [frame];
    expect(moveGridTrack(file, frame.id, 'column', 0, 1)).toBe(file);
  });
});
