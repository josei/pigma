import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { mapStrokeSideWeights } from '../../src/figma/convert/mappers';
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

describe('REST individual stroke weights', () => {
  it('keeps the four side weights of a stroke in the model, with the uniform weight beside them', () => {
    const input = json('rest-file.json');
    const card = findById(input.document, '1:4')!;
    card.individualStrokeWeights = { top: 6, right: 1, bottom: 3, left: 2 };
    const { file } = figmaRestToPigmaFile(parseFigmaRestFile(input), { now: () => NOW });
    const converted = findById(file.document as never, '1:4');
    expect(converted?.individualStrokeWeights).toEqual({ top: 6, right: 1, bottom: 3, left: 2 });
    expect(converted?.strokeWeight).toBe(2);
  });

  it('adds no side weights to a stroke that the REST file gives none for', () => {
    const { file } = figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => NOW });
    expect(findById(file.document as never, '1:4')?.individualStrokeWeights).toBeUndefined();
  });

  it('accepts four finite, non-negative sides, zero included, and drops a set with any side missing or wrong', () => {
    expect(mapStrokeSideWeights({ top: 0, right: 1, bottom: 2.5, left: 3 })).toEqual({ top: 0, right: 1, bottom: 2.5, left: 3 });
    expect(mapStrokeSideWeights({ top: 1, right: 1, bottom: 1 })).toBeUndefined();
    expect(mapStrokeSideWeights({ top: -1, right: 1, bottom: 1, left: 1 })).toBeUndefined();
    expect(mapStrokeSideWeights({ top: '1', right: 1, bottom: 1, left: 1 })).toBeUndefined();
    expect(mapStrokeSideWeights({ top: Number.NaN, right: 1, bottom: 1, left: 1 })).toBeUndefined();
    expect(mapStrokeSideWeights(undefined)).toBeUndefined();
    expect(mapStrokeSideWeights(4)).toBeUndefined();
  });
});
