import { describe, expect, it } from 'vitest';
import { nodeExportFileName } from './FileActions';
import { applyNodePatch } from '../model/ops';
import { createRectNode } from '../model/factory';
import { emptyFile } from '../model/validate';
import { findNode } from '../model/tree';

describe('per-layer export settings', () => {
  it('names a PNG from the layer, its suffix and the extension', () => {
    expect(nodeExportFileName('Rectangle 1', { format: 'PNG', scale: 2, suffix: '-2x' })).toBe('Rectangle-1-2x.png');
  });

  it('names an SVG with no suffix from the layer alone', () => {
    expect(nodeExportFileName('Rectangle 1', { format: 'SVG', scale: 1, suffix: '' })).toBe('Rectangle-1.svg');
  });

  it('stores the settings on the layer, and an empty list clears them', () => {
    const file = emptyFile('Exports');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 10, 10);
    page.children = [rect];
    const withSettings = applyNodePatch(file, rect.id, { exportSettings: [{ format: 'SVG', scale: 1, suffix: '' }] });
    expect(findNode(withSettings.document, rect.id)?.exportSettings).toEqual([{ format: 'SVG', scale: 1, suffix: '' }]);
    const cleared = applyNodePatch(withSettings, rect.id, { exportSettings: [] });
    expect(findNode(cleared.document, rect.id)?.exportSettings).toEqual([]);
  });
});
