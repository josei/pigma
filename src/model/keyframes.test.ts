import { describe, expect, it } from 'vitest';
import { addKeyframe, normalizeKeys, removeKeyframe, removeKeyframeOp, sampleTrack, setKeyframeOp, valuesAt } from './keyframes';
import { createRectNode } from './factory';
import { parseFile, serializeFile } from './serialize';
import { emptyFile } from './validate';
import { findNode } from './tree';
import type { KeyframeTrack, PigmaFile } from './types';

const opacity = (keys: Array<[number, number]>): KeyframeTrack => ({
  property: 'opacity',
  keys: keys.map(([time, value]) => ({ time, value })),
});

/** A page with one rectangle, returned with its id. */
function rectangle(): { file: PigmaFile; id: string } {
  const file = emptyFile('Keys');
  const rect = createRectNode(null, 0, 0, 10, 10);
  file.document.children[0]!.children = [rect];
  return { file, id: rect.id };
}

describe('keyframe tracks', () => {
  it('a track with no keys sets nothing', () => {
    expect(sampleTrack(opacity([]), 500)).toBeNull();
  });

  it('holds the first key before it and the last key after it', () => {
    const track = opacity([
      [100, 0.2],
      [300, 0.8],
    ]);
    expect(sampleTrack(track, 0)).toBe(0.2);
    expect(sampleTrack(track, 1000)).toBe(0.8);
  });

  it('is a straight line between two keys, and exact at a key', () => {
    const track = opacity([
      [0, 0],
      [400, 1],
    ]);
    expect(sampleTrack(track, 100)).toBeCloseTo(0.25, 9);
    expect(sampleTrack(track, 400)).toBe(1);
  });

  it('takes the segment its time falls in, with three keys', () => {
    const track = opacity([
      [0, 0],
      [100, 1],
      [300, 0],
    ]);
    expect(sampleTrack(track, 200)).toBeCloseTo(0.5, 9);
  });

  it('adds a key in time order, and a key at an existing time replaces it', () => {
    let track = opacity([[300, 0.5]]);
    track = addKeyframe(track, 100, 0.1);
    expect(track.keys.map((key) => key.time)).toEqual([100, 300]);
    track = addKeyframe(track, 300, 0.9);
    expect(track.keys).toEqual([
      { time: 100, value: 0.1 },
      { time: 300, value: 0.9 },
    ]);
  });

  it('refuses a key with a negative or non-finite time or value, and leaves the track as it was', () => {
    const track = opacity([[100, 0.5]]);
    expect(addKeyframe(track, -1, 0.2)).toBe(track);
    expect(addKeyframe(track, Number.NaN, 0.2)).toBe(track);
    expect(addKeyframe(track, 200, Number.POSITIVE_INFINITY)).toBe(track);
  });

  it('removes the key at a time, and leaves the others', () => {
    const track = opacity([
      [0, 0],
      [100, 1],
    ]);
    expect(removeKeyframe(track, 0).keys).toEqual([{ time: 100, value: 1 }]);
  });

  it('normalises keys: sorted, with the later of two at one time kept, and unusable keys dropped', () => {
    expect(
      normalizeKeys([
        { time: 300, value: 1 },
        { time: 100, value: 2 },
        { time: 100, value: 3 },
        { time: -5, value: 4 },
      ]),
    ).toEqual([
      { time: 100, value: 3 },
      { time: 300, value: 1 },
    ]);
  });

  it('values at a time hold both properties, and leave out a property with no track', () => {
    const node = {
      keyframes: [
        opacity([
          [0, 1],
          [1000, 0],
        ]),
        { property: 'rotation' as const, keys: [{ time: 0, value: 90 }] },
      ],
    };
    expect(valuesAt(node, 500)).toEqual({ opacity: 0.5, rotation: 90 });
    expect(valuesAt({}, 500)).toEqual({});
  });

  it('setKeyframeOp creates a layer\'s track for a property, keeps its other tracks, and ignores a layer that does not exist', () => {
    const { file, id } = rectangle();
    const keyed = setKeyframeOp(file, id, 'opacity', 0, 1);
    const withRotation = setKeyframeOp(keyed, id, 'rotation', 0, 45);
    const later = setKeyframeOp(withRotation, id, 'opacity', 500, 0);
    const tracks = (findNode(later.document, id) as { keyframes?: KeyframeTrack[] }).keyframes ?? [];
    expect(tracks.map((track) => track.property).sort()).toEqual(['opacity', 'rotation']);
    expect(tracks.find((track) => track.property === 'opacity')!.keys).toEqual([
      { time: 0, value: 1 },
      { time: 500, value: 0 },
    ]);
    expect(setKeyframeOp(file, 'missing', 'opacity', 0, 1)).toBe(file);
  });

  it('keeps the tracks through a save and a load, and drops a malformed track or key', () => {
    const { file, id } = rectangle();
    const keyed = setKeyframeOp(setKeyframeOp(file, id, 'opacity', 0, 1), id, 'opacity', 800, 0);
    const node = findNode(keyed.document, id) as unknown as Record<string, unknown>;
    // A track for a property that cannot be animated, and a key with a negative time, are written by hand, as a file from elsewhere might.
    node.keyframes = [
      ...(node.keyframes as KeyframeTrack[]),
      { property: 'fontSize', keys: [{ time: 0, value: 12 }] },
      { property: 'rotation', keys: [{ time: -10, value: 30 }, { time: 40, value: 60 }] },
    ];
    const restored = parseFile(serializeFile(keyed));
    expect(restored.ok).toBe(true);
    const tracks = (findNode(restored.file!.document, id) as { keyframes?: KeyframeTrack[] }).keyframes ?? [];
    expect(tracks.map((track) => track.property)).toEqual(['opacity', 'rotation']);
    expect(tracks.find((track) => track.property === 'opacity')!.keys).toEqual([
      { time: 0, value: 1 },
      { time: 800, value: 0 },
    ]);
    expect(tracks.find((track) => track.property === 'rotation')!.keys).toEqual([{ time: 40, value: 60 }]);
  });

  it('removeKeyframeOp removes one key, drops a track left with no keys, and leaves a missing key alone', () => {
    const { file, id } = rectangle();
    const keyed = setKeyframeOp(setKeyframeOp(file, id, 'opacity', 0, 1), id, 'opacity', 500, 0);
    const oneLeft = removeKeyframeOp(keyed, id, 'opacity', 0);
    expect((findNode(oneLeft.document, id) as { keyframes?: KeyframeTrack[] }).keyframes).toEqual([
      { property: 'opacity', keys: [{ time: 500, value: 0 }] },
    ]);
    const empty = removeKeyframeOp(oneLeft, id, 'opacity', 500);
    expect((findNode(empty.document, id) as { keyframes?: KeyframeTrack[] }).keyframes).toBeUndefined();
    expect(removeKeyframeOp(keyed, id, 'rotation', 0)).toBe(keyed);
    expect(removeKeyframeOp(keyed, id, 'opacity', 123)).toBe(keyed);
  });
});
