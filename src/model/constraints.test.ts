import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTRAINTS, applyConstraints, constraintLabel, defaultLayoutGrid, gridBands } from './constraints';
import { emptyFile, validatePigmaFile } from './validate';
import { serializeFile, parseFile } from './serialize';
import { createFrameNode } from './factory';

describe('constraints', () => {
  const old = { width: 200, height: 200 };
  const next = { width: 400, height: 300 };
  const box = { x: 20, y: 20, width: 100, height: 60 };

  it('keeps MIN children anchored to the top-left', () => {
    const resolved = applyConstraints(box, { horizontal: 'MIN', vertical: 'MIN' }, old, next);
    expect(resolved).toEqual(box);
  });

  it('keeps MAX children anchored to the bottom-right', () => {
    const resolved = applyConstraints(box, { horizontal: 'MAX', vertical: 'MAX' }, old, next);
    expect(resolved.x).toBeCloseTo(220);
    expect(resolved.y).toBeCloseTo(120);
    expect(resolved.width).toBe(100);
  });

  it('keeps CENTER children proportionally centred', () => {
    const resolved = applyConstraints({ x: 50, y: 70, width: 100, height: 60 }, { horizontal: 'CENTER', vertical: 'CENTER' }, old, next);
    expect(resolved.x + resolved.width / 2).toBeCloseTo((100 / 200) * 400);
    expect(resolved.y + resolved.height / 2).toBeCloseTo((100 / 200) * 300);
  });

  it('stretches children by the container delta', () => {
    const resolved = applyConstraints(box, { horizontal: 'STRETCH', vertical: 'STRETCH' }, old, next);
    expect(resolved.width).toBeCloseTo(300);
    expect(resolved.height).toBeCloseTo(160);
    expect(resolved.x).toBeCloseTo(20);
  });

  it('scales children proportionally', () => {
    const resolved = applyConstraints(box, { horizontal: 'SCALE', vertical: 'SCALE' }, old, next);
    expect(resolved.x).toBeCloseTo(40);
    expect(resolved.width).toBeCloseTo(200);
    expect(resolved.height).toBeCloseTo(90);
  });

  it('falls back to MIN/MIN without constraints and survives a zero-sized container', () => {
    expect(applyConstraints(box, undefined, old, next)).toEqual(box);
    const resolved = applyConstraints(box, { horizontal: 'SCALE', vertical: 'SCALE' }, { width: 0, height: 0 }, next);
    expect(Number.isFinite(resolved.x)).toBe(true);
    expect(resolved.width).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_CONSTRAINTS).toEqual({ horizontal: 'MIN', vertical: 'MIN' });
    expect(constraintLabel('STRETCH')).toBe('Stretch');
  });
});

describe('layout grids', () => {
  it('tiles a uniform grid across the extent', () => {
    const bands = gridBands({ pattern: 'GRID', sectionSize: 10 }, 25);
    expect(bands).toEqual([
      { start: 0, size: 10 },
      { start: 10, size: 10 },
      { start: 20, size: 5 },
    ]);
    expect(gridBands({ pattern: 'GRID', sectionSize: 10 }, 0)).toEqual([]);
  });

  it('stretches columns across the frame with gutters', () => {
    const bands = gridBands({ pattern: 'COLUMNS', sectionSize: 80, count: 4, gutterSize: 20, alignment: 'STRETCH' }, 400);
    expect(bands).toHaveLength(4);
    expect(bands[0]).toEqual({ start: 0, size: 85 });
    expect(bands[1]!.start).toBeCloseTo(105);
    expect(bands[3]!.start + bands[3]!.size).toBeCloseTo(400);
  });

  it('honours a fixed section size and offset', () => {
    const bands = gridBands({ pattern: 'ROWS', sectionSize: 30, count: 3, gutterSize: 10, offset: 5 }, 200);
    expect(bands[0]).toEqual({ start: 5, size: 30 });
    expect(bands[1]!.start).toBeCloseTo(45);
    expect(bands).toHaveLength(3);
  });

  it('builds sensible defaults per pattern', () => {
    expect(defaultLayoutGrid('COLUMNS')).toMatchObject({ pattern: 'COLUMNS', count: 6, gutterSize: 20 });
    expect(defaultLayoutGrid('GRID')).toMatchObject({ pattern: 'GRID', sectionSize: 8 });
  });

  it('round-trips layout grids through JSON persistence', () => {
    const file = emptyFile('Grids');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 400, 300, { name: 'Frame' });
    frame.layoutGrids = [defaultLayoutGrid('COLUMNS'), defaultLayoutGrid('GRID')];
    page.children = [frame];

    const restored = parseFile(serializeFile(file));
    expect(restored.ok).toBe(true);
    const grids = (restored.file!.document.children[0]!.children[0] as { layoutGrids?: unknown[] }).layoutGrids;
    expect(grids).toHaveLength(2);
    expect(grids?.[0]).toMatchObject({ pattern: 'COLUMNS', count: 6 });
  });

  it('keeps unknown grid fields instead of dropping them into raw', () => {
    const result = validatePigmaFile({
      document: {
        id: '0:0',
        type: 'DOCUMENT',
        children: [
          {
            id: '1:0',
            type: 'CANVAS',
            name: 'Page',
            children: [
              {
                id: '1:1',
                type: 'FRAME',
                width: 100,
                height: 100,
                children: [],
                layoutGrids: [{ pattern: 'COLUMNS', sectionSize: 90, count: 3, gutterSize: 10, visible: false }],
              },
            ],
          },
        ],
      },
    });
    const frame = result.file!.document.children[0]!.children[0] as { layoutGrids?: Array<Record<string, unknown>>; raw?: unknown };
    expect(frame.layoutGrids?.[0]).toMatchObject({ pattern: 'COLUMNS', sectionSize: 90, visible: false });
    expect(frame.raw).toBeUndefined();
  });
});
