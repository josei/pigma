import type { AnimatableProperty, AnyNode, Keyframe, KeyframeTrack, PigmaFile } from './types';
import { findNode, updateNode } from './tree';

/**
 * Keyframe tracks (the data model for keyframe animation).
 *
 * A track animates one numeric property of a layer. Its keys are sorted by time, in milliseconds, and no two share a time. A
 * value between two keys is a straight line between them; before the first key and after the last, the nearest key's value
 * holds. Easing, the motion timeline and any playback are not modelled here yet: this is the data they will read.
 *
 * Everything in this module is pure data, so it is unit tested without a browser.
 */

export const ANIMATABLE_PROPERTIES: readonly AnimatableProperty[] = ['opacity', 'rotation'];

export function isAnimatableProperty(value: unknown): value is AnimatableProperty {
  return typeof value === 'string' && (ANIMATABLE_PROPERTIES as readonly string[]).includes(value);
}

/** A key is usable when its time is a finite, non-negative number and its value is a finite number. */
export function isUsableKey(key: Keyframe): boolean {
  return Number.isFinite(key.time) && key.time >= 0 && Number.isFinite(key.value);
}

/**
 * The keys sorted by time, with a later key replacing an earlier one at the same time. Keys that are not usable are dropped.
 */
export function normalizeKeys(keys: Keyframe[]): Keyframe[] {
  const byTime = new Map<number, Keyframe>();
  for (const key of keys) {
    if (isUsableKey(key)) byTime.set(key.time, { time: key.time, value: key.value });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** The track with a key at `time`: added, or replacing the key already there. A key that is not usable leaves it unchanged. */
export function addKeyframe(track: KeyframeTrack, time: number, value: number): KeyframeTrack {
  const key = { time, value };
  if (!isUsableKey(key)) return track;
  return { ...track, keys: normalizeKeys([...track.keys, key]) };
}

/** The track without its key at `time`. */
export function removeKeyframe(track: KeyframeTrack, time: number): KeyframeTrack {
  return { ...track, keys: track.keys.filter((key) => key.time !== time) };
}

/**
 * The value of a track at `time`: the nearest key's value before the first key and after the last, a straight line between two
 * keys otherwise. `null` for a track with no keys, since it then sets nothing.
 */
export function sampleTrack(track: KeyframeTrack, time: number): number | null {
  const keys = track.keys;
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return null;
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const from = keys[index]!;
    const to = keys[index + 1]!;
    if (time >= from.time && time <= to.time) {
      const fraction = (time - from.time) / (to.time - from.time);
      return from.value + (to.value - from.value) * fraction;
    }
  }
  return last.value;
}

/** The value of every animated property of a layer at `time`. A property with no keys is absent from the result. */
export function valuesAt(node: { keyframes?: KeyframeTrack[] }, time: number): Partial<Record<AnimatableProperty, number>> {
  const values: Partial<Record<AnimatableProperty, number>> = {};
  for (const track of node.keyframes ?? []) {
    const value = sampleTrack(track, time);
    if (value !== null) values[track.property] = value;
  }
  return values;
}

/**
 * Set a key on a layer's track for `property`, creating the track if the layer has none for it. Keys that are not usable, and
 * a layer that does not exist, leave the file unchanged.
 */
export function setKeyframeOp(file: PigmaFile, id: string, property: AnimatableProperty, time: number, value: number): PigmaFile {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS' || !isUsableKey({ time, value })) return file;
  return {
    ...file,
    document: updateNode(file.document, id, (current) => {
      const tracks = (current as AnyNode & { keyframes?: KeyframeTrack[] }).keyframes ?? [];
      const existing = tracks.find((track) => track.property === property) ?? { property, keys: [] };
      const others = tracks.filter((track) => track.property !== property);
      return { ...current, keyframes: [...others, addKeyframe(existing, time, value)] } as AnyNode;
    }),
  };
}

/**
 * Remove a layer's key for `property` at `time`. A track left with no keys is removed, and a layer left with no tracks loses its
 * `keyframes` field. A layer with no key at that time, or a layer that does not exist, leaves the file unchanged.
 */
export function removeKeyframeOp(file: PigmaFile, id: string, property: AnimatableProperty, time: number): PigmaFile {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return file;
  const tracks = (node as AnyNode & { keyframes?: KeyframeTrack[] }).keyframes ?? [];
  const track = tracks.find((entry) => entry.property === property);
  if (!track || !track.keys.some((key) => key.time === time)) return file;
  const kept = removeKeyframe(track, time);
  const others = tracks.filter((entry) => entry.property !== property);
  const next = kept.keys.length > 0 ? [...others, kept] : others;
  return {
    ...file,
    document: updateNode(file.document, id, (current) => {
      const { keyframes: _dropped, ...rest } = current as AnyNode & { keyframes?: KeyframeTrack[] };
      return (next.length > 0 ? { ...rest, keyframes: next } : rest) as AnyNode;
    }),
  };
}
