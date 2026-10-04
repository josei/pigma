import type { Effect, Node, SceneNode, ShadowEffect, BlurEffect } from './types';
import { findNode, updateNode } from './tree';
import type { PigmaFile } from './types';

/**
 * Effect list editing. Effects live on every node as Figma stores them
 * (`DROP_SHADOW` / `INNER_SHADOW` / `LAYER_BLUR` / `BACKGROUND_BLUR`), so the
 * panel edits are pure list operations on `node.effects`.
 */

export const EFFECT_TYPES = ['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'] as const;
export type EffectKind = (typeof EFFECT_TYPES)[number];

export function defaultEffect(kind: EffectKind): Effect {
  switch (kind) {
    case 'DROP_SHADOW':
    case 'INNER_SHADOW':
      return {
        type: kind,
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 0, y: 4 },
        radius: 12,
        spread: 0,
        visible: true,
      } as ShadowEffect;
    case 'LAYER_BLUR':
    case 'BACKGROUND_BLUR':
      return { type: kind, radius: 8, visible: true } as BlurEffect;
    default:
      return { type: 'LAYER_BLUR', radius: 8, visible: true } as BlurEffect;
  }
}

export function isShadow(effect: Effect): effect is ShadowEffect {
  return effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW';
}

export function isBlur(effect: Effect): effect is BlurEffect {
  return effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR';
}

/** Human label for the panel and toasts. */
export function effectLabel(kind: EffectKind): string {
  switch (kind) {
    case 'DROP_SHADOW':
      return 'Drop shadow';
    case 'INNER_SHADOW':
      return 'Inner shadow';
    case 'LAYER_BLUR':
      return 'Layer blur';
    case 'BACKGROUND_BLUR':
      return 'Background blur';
    default:
      return 'Effect';
  }
}

function effectsOf(node: Node): Effect[] {
  if (node.type === 'DOCUMENT' || node.type === 'CANVAS') return [];
  return node.effects ?? [];
}

/** Add an effect to every listed node (skipping locked ones). */
export function addEffectToNodes(file: PigmaFile, ids: Iterable<string>, kind: EffectKind): PigmaFile {
  return patchEffects(file, ids, (effects) => [...effects, defaultEffect(kind)]);
}

export function removeEffectAt(file: PigmaFile, ids: Iterable<string>, index: number): PigmaFile {
  return patchEffects(file, ids, (effects) => effects.filter((_, position) => position !== index));
}

export function updateEffectAt(
  file: PigmaFile,
  ids: Iterable<string>,
  index: number,
  patch: Partial<ShadowEffect> & Partial<BlurEffect>,
): PigmaFile {
  return patchEffects(file, ids, (effects) =>
    effects.map((effect, position) => (position === index ? ({ ...effect, ...patch } as Effect) : effect)),
  );
}

export function toggleEffectAt(file: PigmaFile, ids: Iterable<string>, index: number): PigmaFile {
  return patchEffects(file, ids, (effects) =>
    effects.map((effect, position) => (position === index ? { ...effect, visible: effect.visible === false } : effect)),
  );
}

function patchEffects(
  file: PigmaFile,
  ids: Iterable<string>,
  transform: (effects: Effect[]) => Effect[],
): PigmaFile {
  let document = file.document;
  let changed = false;
  for (const id of ids) {
    const node = findNode(document, id);
    if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS' || node.locked) continue;
    const next = transform(effectsOf(node));
    document = updateNode(document, id, (target) => ({ ...target, effects: next }) as SceneNode);
    changed = true;
  }
  return changed ? { ...file, document } : file;
}

/** True when the node blurs whatever is painted behind it. */
export function hasBackgroundBlur(node: Node): boolean {
  if (node.type === 'DOCUMENT' || node.type === 'CANVAS') return false;
  return (node.effects ?? []).some((effect) => effect.type === 'BACKGROUND_BLUR' && effect.visible !== false);
}

export function backgroundBlurRadius(node: Node): number {
  if (node.type === 'DOCUMENT' || node.type === 'CANVAS') return 0;
  for (const effect of node.effects ?? []) {
    if (effect.type === 'BACKGROUND_BLUR' && effect.visible !== false && 'radius' in effect) {
      return typeof effect.radius === 'number' ? effect.radius : 0;
    }
  }
  return 0;
}
