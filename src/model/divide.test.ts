import { describe, expect, it } from 'vitest';
import { divideNodes } from './boolean';
import { createFrameNode, createRectNode } from './factory';
import { solidPaint } from './paint';
import { emptyFile } from './validate';
import { findNode } from './tree';
import type { PigmaFile, SceneNode } from './types';

const RED = solidPaint({ r: 1, g: 0, b: 0 });
const BLUE = solidPaint({ r: 0, g: 0, b: 1 });

/** Two 100 x 100 rectangles on the page: the first (red) lies at (0, 0), the second (blue) at the given corner. */
function pair(second: [number, number]): { file: PigmaFile; ids: [string, string] } {
  const file = emptyFile('Divide');
  const page = file.document.children[0]!;
  const lower = createRectNode(null, 0, 0, 100, 100);
  lower.fills = [RED];
  const upper = createRectNode(null, second[0], second[1], 100, 100);
  upper.fills = [BLUE];
  page.children = [lower, upper];
  return { file, ids: [lower.id, upper.id] };
}

const layers = (file: PigmaFile) => file.document.children[0]!.children as SceneNode[];

describe('divide', () => {
  it('turns two overlapping shapes into their three regions, each a flat vector', () => {
    // The overlap of (0..100) and (50..150) is a 50 x 50 square; each shape keeps an L-shaped region of 100 x 100.
    const { file, ids } = pair([50, 50]);
    const divided = divideNodes(file, ids);
    expect(divided.reason).toBeUndefined();
    expect(divided.nodeIds).toHaveLength(3);
    const pieces = layers(divided.file);
    expect(pieces.map((piece) => piece.type)).toEqual(['VECTOR', 'VECTOR', 'VECTOR']);
    expect(pieces.map((piece) => [piece.width, piece.height])).toEqual([
      [100, 100],
      [50, 50],
      [100, 100],
    ]);
    expect(pieces.find((piece) => piece.width === 50)!.transform).toMatchObject({ tx: 50, ty: 50 });
  });

  it('paints the overlap with the upper shape, and the lower-only region with the lower shape', () => {
    const { file, ids } = pair([50, 50]);
    const pieces = layers(divideNodes(file, ids).file);
    expect(pieces[0]!.fills).toEqual([RED]);
    expect(pieces[1]!.fills).toEqual([BLUE]);
    expect(pieces[2]!.fills).toEqual([BLUE]);
  });

  it('removes both originals, and places the regions where the lower shape was', () => {
    const { file, ids } = pair([50, 50]);
    const divided = divideNodes(file, ids);
    for (const id of ids) expect(findNode(divided.file.document, id)).toBeNull();
    expect(layers(divided.file).map((piece) => piece.id)).toEqual(divided.nodeIds);
  });

  it('refuses shapes that do not overlap, and leaves the file as it was', () => {
    const { file, ids } = pair([300, 0]);
    const divided = divideNodes(file, ids);
    expect(divided.reason).toBe('The shapes do not overlap, so there is nothing to divide');
    expect(divided.file).toBe(file);
  });

  it('refuses fewer than two shapes, or more than six', () => {
    const { file, ids } = pair([50, 50]);
    expect(divideNodes(file, [ids[0]!]).reason).toBe('Divide takes two to 6 shapes');
    const page = file.document.children[0]!;
    const extra = [0, 1, 2, 3, 4].map((i) => createRectNode(null, 10 + i * 5, 10, 20, 20));
    page.children = [...page.children, ...extra];
    expect(divideNodes(file, [...ids, ...extra.map((rect) => rect.id)]).reason).toBe('Divide takes two to 6 shapes');
  });

  it('divides five and six overlapping shapes into one region per distinct set of covering shapes', () => {
    // An independent count: sample each unit cell of the shapes' bounds, and count the distinct sets of shapes covering the cells.
    // The shapes sit on whole numbers, so every region is a union of unit cells and the count is exact.
    const offsets: Array<[number, number]> = [
      [0, 0],
      [40, 0],
      [0, 40],
      [40, 40],
      [20, 20],
      [60, 60],
    ];
    for (const count of [5, 6]) {
      const file = emptyFile('Divide');
      const page = file.document.children[0]!;
      const shapes = offsets.slice(0, count).map(([x, y], i) => {
        const rect = createRectNode(null, x, y, 100, 100);
        rect.fills = [solidPaint({ r: i / 6, g: 0.5, b: 1 - i / 6 })];
        return rect;
      });
      page.children = shapes;
      const sets = new Set<number>();
      for (let x = 0; x < 160; x += 1) {
        for (let y = 0; y < 160; y += 1) {
          let mask = 0;
          offsets.slice(0, count).forEach(([ox, oy], i) => {
            if (x + 0.5 >= ox && x + 0.5 <= ox + 100 && y + 0.5 >= oy && y + 0.5 <= oy + 100) mask |= 1 << i;
          });
          if (mask) sets.add(mask);
        }
      }
      const divided = divideNodes(file, shapes.map((rect) => rect.id));
      expect(divided.reason).toBeUndefined();
      expect(layers(divided.file)).toHaveLength(sets.size);
      expect(layers(divided.file).every((piece) => piece.type === 'VECTOR')).toBe(true);
    }
  });

  it('divides three overlapping shapes into the five regions they make, painted by the top-most shape that covers each', () => {
    // A spans x 0..100, B spans 50..150 and C spans 25..125, all 100 tall. The regions are, from the left: A alone (25 wide),
    // A and C (25), all three (50), B and C (25), and B alone (25).
    const file = emptyFile('Divide');
    const page = file.document.children[0]!;
    const colours = [RED, BLUE, solidPaint({ r: 0, g: 1, b: 0 })];
    const shapes = [0, 50, 25].map((x, i) => {
      const rect = createRectNode(null, x, 0, 100, 100);
      rect.fills = [colours[i]!];
      return rect;
    });
    page.children = shapes;
    const divided = divideNodes(file, shapes.map((rect) => rect.id));
    expect(divided.reason).toBeUndefined();
    const pieces = layers(divided.file);
    expect(pieces.map((piece) => piece.width)).toEqual([25, 25, 50, 25, 25]);
    // The all-three region sits at x 50 and takes C's paint, the top-most shape.
    const allThree = pieces.find((piece) => piece.width === 50)!;
    expect(allThree.transform).toMatchObject({ tx: 50 });
    expect(allThree.fills).toEqual([colours[2]]);
  });

  it('refuses two shapes in different parents', () => {
    const file = emptyFile('Divide');
    const page = file.document.children[0]!;
    const lower = createRectNode(null, 0, 0, 100, 100);
    const upper = createRectNode(null, 50, 50, 100, 100);
    const frame = createFrameNode(null, 0, 0, 200, 200);
    frame.children = [upper];
    page.children = [lower, frame];
    expect(divideNodes(file, [lower.id, upper.id]).reason).toBe('Divide needs shapes in the same frame or group');
  });
});
