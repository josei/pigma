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

/** The fixture's Card (1:4) with export settings, converted; the report comes with it. */
function convertedCard(exportSettings: unknown) {
  const input = json('rest-file.json');
  Object.assign(findById(input.document, '1:4')!, { exportSettings });
  const { file, report } = figmaRestToPigmaFile(parseFigmaRestFile(input), { now: () => NOW });
  return { card: findById(file.document as never, '1:4')!, report };
}

describe('REST export settings', () => {
  it('keeps a PNG or SVG setting at a scale, with its suffix', () => {
    const { card } = convertedCard([
      { suffix: '@2x', format: 'PNG', constraint: { type: 'SCALE', value: 2 } },
      { suffix: '', format: 'SVG', constraint: { type: 'SCALE', value: 1 } },
    ]);
    expect(card.exportSettings).toEqual([
      { format: 'PNG', scale: 2, suffix: '@2x' },
      { format: 'SVG', scale: 1, suffix: '' },
    ]);
  });

  it('drops a setting Pigma cannot write, and reports it', () => {
    const { card, report } = convertedCard([
      { suffix: '', format: 'PNG', constraint: { type: 'SCALE', value: 2 } },
      { suffix: '', format: 'PDF', constraint: { type: 'SCALE', value: 1 } },
      { suffix: '', format: 'PNG', constraint: { type: 'WIDTH', value: 100 } },
    ]);
    expect(card.exportSettings).toEqual([{ format: 'PNG', scale: 2, suffix: '' }]);
    // The fixture has its own unsupported items; only the export settings are checked here.
    const features = report.unsupported.map((item) => item.feature).filter((feature) => feature.startsWith('exportSetting:'));
    expect(features).toEqual(['exportSetting:PDF', 'exportSetting:PNG:WIDTH']);
  });

  it('adds no export settings to a layer that has none, or whose settings are all unsupported', () => {
    expect(convertedCard(undefined).card.exportSettings).toBeUndefined();
    expect(convertedCard([{ suffix: '', format: 'JPG', constraint: { type: 'SCALE', value: 1 } }]).card.exportSettings).toBeUndefined();
  });
});
