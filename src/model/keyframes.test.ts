import { describe, expect, it } from 'vitest';
import { addKeyframe, advanceTime, animateFile, applyKeysOp, easeFraction, fractionAtTime, isKeyEasing, nextEasing, normalizeKeys, removeKeyframe, removeKeyframeOp, sampleTrack, setKeyEasingOp, setKeyframeOp, smoothstep, TIMELINE_SPAN_MS, timeAtFraction, valuesAt } from './keyframes';
import { createFrameNode, createRectNode } from './factory';
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

  it('applyKeysOp sets opacity and rotation to their values at the time, and leaves a property with no track alone', () => {
    const { file, id } = rectangle();
    let keyed = setKeyframeOp(file, id, 'opacity', 500, 1);
    keyed = setKeyframeOp(keyed, id, 'opacity', 900, 0.4);
    keyed = setKeyframeOp(keyed, id, 'rotation', 0, 0);
    keyed = setKeyframeOp(keyed, id, 'rotation', 1000, 90);
    const applied = applyKeysOp(keyed, id, 700);
    const node = findNode(applied.document, id) as { opacity?: number; transform: { a: number; b: number } };
    // Opacity between 1 at 500 and 0.4 at 900 is 0.7 at 700; rotation between 0 and 90 over 0..1000 is 63 degrees.
    expect(node.opacity).toBeCloseTo(0.7, 9);
    expect(Math.atan2(node.transform.b, node.transform.a) * 180 / Math.PI).toBeCloseTo(63, 6);
  });

  it('applyKeysOp leaves a layer with no tracks, or a missing one, as it was', () => {
    const { file, id } = rectangle();
    expect(applyKeysOp(file, id, 500)).toBe(file);
    expect(applyKeysOp(file, 'missing', 500)).toBe(file);
  });

  it('an ease-in-out key eases the segment that leaves it, and a linear key does not', () => {
    // A quarter of the way from 0 to 1 is 0.25 linearly, and smoothstep(0.25) = 0.15625 eased.
    const linear = opacity([
      [0, 0],
      [400, 1],
    ]);
    const eased = { ...linear, keys: [{ time: 0, value: 0, easing: 'EASE_IN_OUT' as const }, linear.keys[1]!] };
    expect(sampleTrack(linear, 100)).toBeCloseTo(0.25, 9);
    expect(sampleTrack(eased, 100)).toBeCloseTo(0.15625, 9);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
  });

  it('ease-in starts slow and ease-out ends slow, each a quadratic curve through the same endpoints', () => {
    // A quarter of the way: ease-in is 0.25 squared, ease-out is 1 - 0.75 squared, and both meet 0 and 1 at the ends.
    expect(easeFraction('EASE_IN', 0.25)).toBeCloseTo(0.0625, 9);
    expect(easeFraction('EASE_OUT', 0.25)).toBeCloseTo(0.4375, 9);
    expect(easeFraction('EASE_IN', 0)).toBe(0);
    expect(easeFraction('EASE_IN', 1)).toBe(1);
    expect(easeFraction('EASE_OUT', 0)).toBe(0);
    expect(easeFraction('EASE_OUT', 1)).toBe(1);
    expect(easeFraction(undefined, 0.25)).toBe(0.25);
    expect(easeFraction('LINEAR', 0.25)).toBe(0.25);

    const { file, id } = rectangle();
    const keyed = setKeyframeOp(setKeyframeOp(file, id, 'opacity', 0, 0), id, 'opacity', 400, 1);
    const ease = (easing: 'EASE_IN' | 'EASE_OUT') => setKeyEasingOp(keyed, id, 'opacity', 0, easing);
    const track = (f: PigmaFile) => (findNode(f.document, id) as { keyframes?: KeyframeTrack[] }).keyframes![0]!;
    expect(sampleTrack(track(ease('EASE_IN')), 100)).toBeCloseTo(0.0625, 9);
    expect(sampleTrack(track(ease('EASE_OUT')), 100)).toBeCloseTo(0.4375, 9);
  });

  it('steps an easing through linear, ease-in-out, ease-in, ease-out, and back to linear', () => {
    expect(nextEasing(undefined)).toBe('EASE_IN_OUT');
    expect(nextEasing('LINEAR')).toBe('EASE_IN_OUT');
    expect(nextEasing('EASE_IN_OUT')).toBe('EASE_IN');
    expect(nextEasing('EASE_IN')).toBe('EASE_OUT');
    expect(nextEasing('EASE_OUT')).toBe('LINEAR');
    expect(isKeyEasing('EASE_OUT')).toBe(true);
    expect(isKeyEasing('BOUNCE')).toBe(false);
    expect(isKeyEasing(undefined)).toBe(false);
  });

  it('setKeyEasingOp sets the easing of the key at a time, and a linear easing removes it', () => {
    const { file, id } = rectangle();
    const keyed = setKeyframeOp(setKeyframeOp(file, id, 'opacity', 0, 0), id, 'opacity', 400, 1);
    const eased = setKeyEasingOp(keyed, id, 'opacity', 0, 'EASE_IN_OUT');
    const track = (findNode(eased.document, id) as { keyframes?: KeyframeTrack[] }).keyframes![0]!;
    expect(track.keys[0]).toEqual({ time: 0, value: 0, easing: 'EASE_IN_OUT' });
    expect(track.keys[1]).toEqual({ time: 400, value: 1 });
    const linear = setKeyEasingOp(eased, id, 'opacity', 0, 'LINEAR');
    expect((findNode(linear.document, id) as { keyframes?: KeyframeTrack[] }).keyframes![0]!.keys[0]).toEqual({ time: 0, value: 0 });
    expect(setKeyEasingOp(keyed, id, 'opacity', 123, 'EASE_IN_OUT')).toBe(keyed);
  });

  it('keeps an ease-in-out key through a save and a load, and drops an unknown easing', () => {
    const { file, id } = rectangle();
    const eased = setKeyEasingOp(setKeyframeOp(file, id, 'opacity', 0, 0), id, 'opacity', 0, 'EASE_IN_OUT');
    const node = findNode(eased.document, id) as unknown as Record<string, unknown>;
    node.keyframes = [{ property: 'opacity', keys: [{ time: 0, value: 0, easing: 'BOUNCE' }, { time: 200, value: 1, easing: 'EASE_IN_OUT' }] }];
    const restored = parseFile(serializeFile(eased));
    const keys = ((findNode(restored.file!.document, id) as { keyframes?: KeyframeTrack[] }).keyframes ?? [])[0]!.keys;
    expect(keys).toEqual([
      { time: 0, value: 0 },
      { time: 200, value: 1, easing: 'EASE_IN_OUT' },
    ]);
  });

  it('keeps ease-in and ease-out keys through a save and a load, and turns a stored linear key into no easing', () => {
    const { file, id } = rectangle();
    const keyed = setKeyEasingOp(setKeyframeOp(file, id, 'opacity', 0, 0), id, 'opacity', 0, 'EASE_OUT');
    const node = findNode(keyed.document, id) as unknown as Record<string, unknown>;
    node.keyframes = [{ property: 'opacity', keys: [{ time: 0, value: 0, easing: 'EASE_OUT' }, { time: 200, value: 1, easing: 'EASE_IN' }, { time: 400, value: 0, easing: 'LINEAR' }] }];
    const restored = parseFile(serializeFile(keyed));
    const keys = ((findNode(restored.file!.document, id) as { keyframes?: KeyframeTrack[] }).keyframes ?? [])[0]!.keys;
    expect(keys).toEqual([
      { time: 0, value: 0, easing: 'EASE_OUT' },
      { time: 200, value: 1, easing: 'EASE_IN' },
      { time: 400, value: 0 },
    ]);
  });

  it('maps a point on the timeline to a time in 10 ms steps, and back, clamped to the span', () => {
    expect(timeAtFraction(0)).toBe(0);
    expect(timeAtFraction(0.5)).toBe(TIMELINE_SPAN_MS / 2);
    expect(timeAtFraction(0.3333)).toBe(670);
    expect(timeAtFraction(-1)).toBe(0);
    expect(timeAtFraction(3)).toBe(TIMELINE_SPAN_MS);
    expect(timeAtFraction(Number.NaN)).toBe(0);
    expect(fractionAtTime(500)).toBe(0.25);
    expect(fractionAtTime(-5)).toBe(0);
    expect(fractionAtTime(TIMELINE_SPAN_MS * 2)).toBe(1);
  });

  it('animateFile shows keyed values in a layer inside a frame, and leaves the stored file as it was', () => {
    const file = emptyFile('Preview');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 300, 300);
    const layer = createRectNode(null, 0, 0, 10, 10);
    frame.children = [layer];
    page.children = [frame];
    const keyed = setKeyframeOp(setKeyframeOp(file, layer.id, 'opacity', 0, 1), layer.id, 'opacity', 1000, 0);
    const shown = animateFile(keyed, 250);
    const shownLayer = findNode(shown.document, layer.id) as { opacity?: number };
    expect(shownLayer.opacity).toBeCloseTo(0.75, 9);
    // The stored file is not changed by the preview: the layer keeps the opacity the factory gave it.
    expect((findNode(keyed.document, layer.id) as { opacity?: number }).opacity).toBe(1);
  });

  it('animateFile returns the same file when nothing is keyed', () => {
    const { file } = rectangle();
    expect(animateFile(file, 500)).toBe(file);
  });

  it('advances playback time, wrapping at the span, and leaves it where it is for a bad step', () => {
    expect(advanceTime(0, 16)).toBe(16);
    expect(advanceTime(1990, 20)).toBeCloseTo(10, 9);
    expect(advanceTime(500, -5)).toBe(500);
    expect(advanceTime(500, Number.NaN)).toBe(500);
  });
});
