import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import type { SceneNode } from '../../src/model/types';

const NOW = 1_700_000_000_000;
const json = (name: string): any => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

/** The node with this id anywhere in the tree, or undefined. */
function findById(node: { id: string; children?: unknown[] }, id: string): SceneNode | undefined {
  if (node.id === id) return node as unknown as SceneNode;
  for (const child of node.children ?? []) {
    const found = findById(child as { id: string; children?: unknown[] }, id);
    if (found) return found;
  }
  return undefined;
}

/** The fixture's Card rectangle (1:4), with the mask fields the test sets. */
function cardFrom(fields: Record<string, unknown>) {
  const input = json('rest-file.json');
  Object.assign(findById(input.document, '1:4')!, fields);
  const { file } = figmaRestToPigmaFile(parseFigmaRestFile(input), { now: () => NOW });
  return findById(file.document as never, '1:4')!;
}

describe('REST masks', () => {
  it('keeps a layer used as a mask, with its mask type', () => {
    const card = cardFrom({ isMask: true, maskType: 'LUMINANCE' });
    expect(card.isMask).toBe(true);
    expect(card.maskType).toBe('LUMINANCE');
  });

  it('keeps the alpha and vector mask types as well', () => {
    expect(cardFrom({ isMask: true, maskType: 'ALPHA' }).maskType).toBe('ALPHA');
    expect(cardFrom({ isMask: true, maskType: 'VECTOR' }).maskType).toBe('VECTOR');
  });

  it('drops a mask type it does not know, and keeps the mask itself', () => {
    const card = cardFrom({ isMask: true, maskType: 'SOMETHING_ELSE' });
    expect(card.isMask).toBe(true);
    expect(card.maskType).toBeUndefined();
  });

  it('adds no mask fields to a layer that is not a mask', () => {
    const card = cardFrom({});
    expect(card.isMask).toBeUndefined();
    expect(card.maskType).toBeUndefined();
  });
});
