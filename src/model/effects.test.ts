import { describe, expect, it } from 'vitest';
import {
  addEffectToNodes,
  backgroundBlurRadius,
  defaultEffect,
  effectLabel,
  hasBackgroundBlur,
  isBlur,
  isShadow,
  removeEffectAt,
  toggleEffectAt,
  updateEffectAt,
} from './effects';
import { createRectNode } from './factory';
import { emptyFile } from './validate';
import { findNode } from './tree';
import { parseFile, serializeFile } from './serialize';
import type { BlurEffect, SceneNode, ShadowEffect } from './types';

function setup() {
  const file = emptyFile('Effects');
  const page = file.document.children[0]!;
  const rect = createRectNode(null, 0, 0, 100, 100);
  page.children = [rect];
  return { file, rectId: rect.id };
}

const effectsOf = (file: ReturnType<typeof setup>['file'], id: string) => {
  const node = findNode(file.document, id) as SceneNode;
  return node.effects ?? [];
};

describe('effects', () => {
  it('creates sensible defaults per effect type', () => {
    const shadow = defaultEffect('DROP_SHADOW') as ShadowEffect;
    expect(shadow.offset).toEqual({ x: 0, y: 4 });
    expect(shadow.radius).toBe(12);
    expect(isShadow(shadow)).toBe(true);
    const blur = defaultEffect('LAYER_BLUR') as BlurEffect;
    expect(blur.radius).toBe(8);
    expect(isBlur(blur)).toBe(true);
    expect(effectLabel('BACKGROUND_BLUR')).toBe('Background blur');
  });

  it('adds, updates, toggles and removes effects on the selection', () => {
    const { file, rectId } = setup();
    const withShadow = addEffectToNodes(file, [rectId], 'DROP_SHADOW');
    expect(effectsOf(withShadow, rectId)).toHaveLength(1);

    const blurred = addEffectToNodes(withShadow, [rectId], 'LAYER_BLUR');
    expect(effectsOf(blurred, rectId).map((effect) => effect.type)).toEqual(['DROP_SHADOW', 'LAYER_BLUR']);

    const tuned = updateEffectAt(blurred, [rectId], 0, { radius: 30, offset: { x: 5, y: 6 } });
    const shadow = effectsOf(tuned, rectId)[0] as ShadowEffect;
    expect(shadow.radius).toBe(30);
    expect(shadow.offset).toEqual({ x: 5, y: 6 });

    const hidden = toggleEffectAt(tuned, [rectId], 0);
    expect(effectsOf(hidden, rectId)[0]!.visible).toBe(false);

    const removed = removeEffectAt(hidden, [rectId], 0);
    expect(effectsOf(removed, rectId).map((effect) => effect.type)).toEqual(['LAYER_BLUR']);
  });

  it('skips locked nodes and keeps other nodes untouched', () => {
    const { file, rectId } = setup();
    const locked = { ...file, document: { ...file.document, children: file.document.children.map((page) => ({ ...page, children: page.children.map((child) => ({ ...child, locked: true })) })) } };
    expect(addEffectToNodes(locked, [rectId], 'DROP_SHADOW').document).toBe(locked.document);
  });

  it('detects background blur and reports its radius', () => {
    const { file, rectId } = setup();
    expect(hasBackgroundBlur(findNode(file.document, rectId)!)).toBe(false);
    const blurred = addEffectToNodes(file, [rectId], 'BACKGROUND_BLUR');
    const node = findNode(blurred.document, rectId)!;
    expect(hasBackgroundBlur(node)).toBe(true);
    expect(backgroundBlurRadius(node)).toBe(8);

    const hidden = toggleEffectAt(blurred, [rectId], 0);
    expect(hasBackgroundBlur(findNode(hidden.document, rectId)!)).toBe(false);
    expect(backgroundBlurRadius(findNode(hidden.document, rectId)!)).toBe(0);
  });

  it('round-trips every effect kind through JSON persistence', () => {
    const { file, rectId } = setup();
    let next = file;
    for (const kind of ['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'] as const) {
      next = addEffectToNodes(next, [rectId], kind);
    }
    const restored = parseFile(serializeFile(next));
    expect(restored.ok).toBe(true);
    const effects = effectsOf(restored.file!, rectId);
    expect(effects.map((effect) => effect.type)).toEqual(['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR']);
  });
});
