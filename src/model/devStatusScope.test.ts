/**
 * Which node kinds can carry a development status.
 *
 * Figma's Dev Mode guide lists FRAMES, COMPONENTS, INSTANCES and SECTIONS as
 * markable assets. The Inspect panel used to gate the controls on a top-level
 * FRAME only, so a component, an instance or a section could not be marked even
 * though the layers badge shows a status wherever it appears. Deliberately NOT
 * markable: anything that is not a hand-off asset — a rectangle, text, a group,
 * a vector — and the document/page containers themselves.
 */
import { describe, expect, it } from 'vitest';
import { canHaveDevStatus } from './types';
import { emptyFile } from './validate';
import { createComponentNode, createEllipseNode, createFrameNode, createGroupNode, createRectNode, createTextNode } from './factory';

describe('development status scope', () => {
  const file = emptyFile('Dev status');
  const document = file.document;
  const page = document.children[0]!;

  it('marks the kinds Figma marks', () => {
    expect(canHaveDevStatus(createFrameNode(document, 0, 0, 10, 10))).toBe(true);
    expect(canHaveDevStatus(createComponentNode(document, createRectNode(document, 0, 0, 10, 10)))).toBe(true);
    const component = createComponentNode(document, createRectNode(document, 0, 0, 10, 10));
    expect(
      canHaveDevStatus({ ...component, type: 'INSTANCE', componentId: component.id } as never),
    ).toBe(true);
    expect(canHaveDevStatus({ ...createFrameNode(document, 0, 0, 10, 10), type: 'SECTION' } as never)).toBe(true);
  });

  it('does not mark anything that is not a hand-off asset', () => {
    expect(canHaveDevStatus(createRectNode(document, 0, 0, 10, 10))).toBe(false);
    expect(canHaveDevStatus(createEllipseNode(document, 0, 0, 10, 10))).toBe(false);
    expect(canHaveDevStatus(createTextNode(document, 0, 0, 'Text'))).toBe(false);
    expect(canHaveDevStatus(createGroupNode([]))).toBe(false);
    expect(canHaveDevStatus(document), 'the document is not an asset').toBe(false);
    expect(canHaveDevStatus(page), 'a page is not an asset').toBe(false);
    expect(canHaveDevStatus(null)).toBe(false);
    expect(canHaveDevStatus(undefined)).toBe(false);
  });

  it('marks a NESTED frame or component, not only a top-level one', () => {
    // The badge shows wherever the node appears, so the panel must not require
    // the node to sit directly on the canvas.
    const outer = createFrameNode(document, 0, 0, 100, 100);
    const inner = createFrameNode(document, 0, 0, 10, 10);
    outer.children = [inner];
    page.children = [outer];
    expect(canHaveDevStatus(inner)).toBe(true);
    expect(canHaveDevStatus(outer)).toBe(true);
  });
});
