import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { mapDevStatus } from '../../src/figma/convert/mappers';
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

describe('REST dev status and component property references', () => {
  it('maps a ready-for-dev status to the model\'s status, and a completed one as it is', () => {
    expect(convertedNode('1:2', { devStatus: { type: 'READY_FOR_DEV' } }).devStatus).toBe('READY_FOR_DEVELOPMENT');
    expect(convertedNode('1:2', { devStatus: { type: 'COMPLETED', description: 'Shipped' } }).devStatus).toBe('COMPLETED');
  });

  it('adds no status for no status, or for a type Pigma does not know', () => {
    expect(convertedNode('1:2', { devStatus: null }).devStatus).toBeUndefined();
    expect(convertedNode('1:2', { devStatus: { type: 'SOMETHING_ELSE' } }).devStatus).toBeUndefined();
    expect(mapDevStatus(undefined)).toBeUndefined();
    expect(mapDevStatus('READY_FOR_DEV')).toBeUndefined();
  });

  it('keeps a layer\'s component property references, as the model names them', () => {
    const card = convertedNode('1:4', { componentPropertyReferences: { visible: 'Show card' } });
    expect(card.componentPropertyReferences).toEqual({ visible: 'Show card' });
  });

  it('adds no references to a layer that has none', () => {
    expect(convertedNode('1:4', {}).componentPropertyReferences).toBeUndefined();
  });
});
