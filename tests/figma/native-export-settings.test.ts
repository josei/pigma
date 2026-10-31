import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nodeDecompressors } from '../../src/figma/native/node';
import { parseFigArchive } from '../../src/figma/native/parse';
import { toPigmaFile } from '../../src/figma/convert/convert';
import type { SceneNode } from '../../src/model/types';

const NOW = 1_700_000_000_000;
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

/** Every node in the converted tree that carries export settings. */
function nodesWithExports(node: { children?: unknown[] }, found: SceneNode[] = []): SceneNode[] {
  if ((node as { exportSettings?: unknown[] }).exportSettings) found.push(node as unknown as SceneNode);
  for (const child of node.children ?? []) nodesWithExports(child as { children?: unknown[] }, found);
  return found;
}

describe('native .fig export settings', () => {
  it('keeps the SVG export setting of a Figma-made file at its content scale', () => {
    const { file } = toPigmaFile(parseFigArchive(fixture('openfigs.fig'), nodeDecompressors), { now: () => NOW });
    const exported = nodesWithExports(file.document as never);
    expect(exported.length).toBeGreaterThan(0);
    expect(exported[0]!.exportSettings).toEqual([{ format: 'SVG', scale: 1, suffix: '' }]);
  });
});
