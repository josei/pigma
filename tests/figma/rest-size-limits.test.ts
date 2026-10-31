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

/** A node of the fixture (by id), with the fields the test sets, converted to the model. */
function convertedNode(id: string, fields: Record<string, unknown>) {
  const input = json('rest-file.json');
  Object.assign(findById(input.document, id)!, fields);
  const { file } = figmaRestToPigmaFile(parseFigmaRestFile(input), { now: () => NOW });
  return findById(file.document as never, id)!;
}

describe('REST size limits', () => {
  it('keeps a layer\'s minimum and maximum width and height', () => {
    const hero = convertedNode('1:2', { minWidth: 100, maxWidth: 800, minHeight: 50, maxHeight: 600 });
    expect(hero.minWidth).toBe(100);
    expect(hero.maxWidth).toBe(800);
    expect(hero.minHeight).toBe(50);
    expect(hero.maxHeight).toBe(600);
  });

  it('keeps a single limit on its own', () => {
    const card = convertedNode('1:4', { minWidth: 40 });
    expect(card.minWidth).toBe(40);
    expect(card.maxWidth).toBeUndefined();
    expect(card.minHeight).toBeUndefined();
  });

  it('adds no limits to a layer that has none', () => {
    const card = convertedNode('1:4', {});
    expect(card.minWidth).toBeUndefined();
    expect(card.maxHeight).toBeUndefined();
  });
});
