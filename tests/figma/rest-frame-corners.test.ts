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

/** The fixture's Hero frame (1:2), a vertical auto layout, with the fields a frame can carry set by the test. */
function heroFrom(fields: Record<string, unknown>) {
  const input = json('rest-file.json');
  Object.assign(findById(input.document, '1:2')!, fields);
  const { file } = figmaRestToPigmaFile(parseFigmaRestFile(input), { now: () => NOW });
  return findById(file.document as never, '1:2') as SceneNode & { autoLayout?: Record<string, unknown> };
}

describe('REST frames keep their corners and their wrapped-line gap', () => {
  it('keeps a frame\'s corner radius, per-corner radii and corner smoothing, as it keeps a rectangle\'s', () => {
    const hero = heroFrom({ cornerRadius: 12, rectangleCornerRadii: [12, 12, 0, 0], cornerSmoothing: 0.6 });
    expect(hero.cornerRadius).toBe(12);
    expect(hero.rectangleCornerRadii).toEqual([12, 12, 0, 0]);
    expect(hero.cornerSmoothing).toBe(0.6);
  });

  it('keeps the gap between wrapped lines of an auto layout frame', () => {
    const hero = heroFrom({ layoutWrap: 'WRAP', counterAxisSpacing: 20 });
    expect(hero.autoLayout?.layoutWrap).toBe('WRAP');
    expect(hero.autoLayout?.counterAxisSpacing).toBe(20);
  });

  it('adds no corner fields to a frame that has none', () => {
    const hero = heroFrom({});
    expect(hero.cornerRadius).toBeUndefined();
    expect(hero.cornerSmoothing).toBeUndefined();
    expect(hero.autoLayout?.counterAxisSpacing).toBeUndefined();
  });
});
