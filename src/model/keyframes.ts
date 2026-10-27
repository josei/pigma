import type { AnimatableProperty, AnyNode, Keyframe, KeyEasing, KeyframeTrack, PigmaFile } from './types';
import { withRotation } from './matrix';
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
    if (!isUsableKey(key)) continue;
    const easing = key.easing === 'EASE_IN_OUT' ? 'EASE_IN_OUT' : undefined;
    byTime.set(key.time, { time: key.time, value: key.value, ...(easing ? { easing } : {}) });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Smoothstep: 0 at 0, 1 at 1, eased at both ends. Pigma's own ease-in-out, not CSS's cubic-bezier. */
export function smoothstep(fraction: number): number {
  return fraction * fraction * (3 - 2 * fraction);
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
      const linear = (time - from.time) / (to.time - from.time);
      const fraction = from.easing === 'EASE_IN_OUT' ? smoothstep(linear) : linear;
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

/**
 * Apply a layer's keys at `time`: its opacity becomes the opacity track's value at that time (clamped to 0 to 1), and its rotation
 * the rotation track's, keeping its position and scale. A property with no track keeps its value. This is an ordinary edit, so
 * the layer reads the animated values until something else changes them. A layer with no tracks, or that does not exist, is left
 * unchanged.
 */
export function applyKeysOp(file: PigmaFile, id: string, time: number): PigmaFile {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return file;
  const values = valuesAt(node as { keyframes?: KeyframeTrack[] }, time);
  if (values.opacity === undefined && values.rotation === undefined) return file;
  return {
    ...file,
    document: updateNode(file.document, id, (current) => {
      const patch: Partial<AnyNode> = {};
      if (values.opacity !== undefined) patch.opacity = Math.min(1, Math.max(0, values.opacity));
      if (values.rotation !== undefined && 'transform' in current) {
        patch.transform = withRotation(current.transform, values.rotation);
      }
      return { ...current, ...patch } as AnyNode;
    }),
  };
}

/**
 * Set the easing of a layer's key at `time` for `property`: an ease-in-out key eases the segment that leaves it. A key with no
 * easing is linear. A layer with no key at that time leaves the file unchanged.
 */
export function setKeyEasingOp(file: PigmaFile, id: string, property: AnimatableProperty, time: number, easing: KeyEasing): PigmaFile {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return file;
  const tracks = (node as AnyNode & { keyframes?: KeyframeTrack[] }).keyframes ?? [];
  const track = tracks.find((entry) => entry.property === property);
  if (!track || !track.keys.some((key) => key.time === time)) return file;
  const keys = track.keys.map((key) => (key.time === time ? { time: key.time, value: key.value, ...(easing === 'EASE_IN_OUT' ? { easing } : {}) } : key));
  const next = tracks.map((entry) => (entry.property === property ? { ...entry, keys: normalizeKeys(keys) } : entry));
  return {
    ...file,
    document: updateNode(file.document, id, (current) => ({ ...current, keyframes: next }) as AnyNode),
  };
}

/** The span of the Animation section's timeline, in milliseconds: the strip runs from 0 to this time. */
export const TIMELINE_SPAN_MS = 2000;

/**
 * The time a point across the timeline strip stands for: `fraction` of the way along (0 to 1, clamped), in steps of 10 ms. A
 * fraction that is not a number stands for 0.
 */
export function timeAtFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round((clamped * TIMELINE_SPAN_MS) / 10) * 10;
}

/** The position of a time along the timeline strip, from 0 to 1, clamped to the span. */
export function fractionAtTime(time: number): number {
  return Math.min(1, Math.max(0, time / TIMELINE_SPAN_MS));
}

