import { describe, expect, it } from 'vitest';
import { defaultDocument } from './starter';
import { parseFile, serializeFile } from './serialize';
import { syncTextSizes } from './textSync';
import { nodeMap, walk } from './tree';
import { hasChildren } from './types';
import { renderSvgDocument } from '../render/svgExport';
import type { SceneNode } from './types';

describe('starter document', () => {
  it('is a valid, self-contained Pigma file', () => {
    const file = defaultDocument();
    const result = parseFile(serializeFile(file));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('ships four editable frames on one page', () => {
    const file = defaultDocument();
    const page = file.document.children[0]!;
    expect(page.children.map((child) => child.name)).toEqual([
      'Home / Hero',
      'Home / Features',
      'Mobile / Home',
      'Components',
    ]);
    expect(file.prototypeStartNodeId).toBe(page.children[0]!.id);
    expect(page.prototypeStartNodeId).toBe(page.children[0]!.id);
  });

  it('uses unique ids everywhere', () => {
    const file = defaultDocument();
    const ids = [...nodeMap(file.document).keys()];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(50);
  });

  it('contains real text, gradients, effects and corner radii', () => {
    const file = defaultDocument();
    let texts = 0;
    let gradients = 0;
    let shadows = 0;
    let radii = 0;
    walk(file.document, (node) => {
      if (node.type === 'TEXT') texts += 1;
      if (node.fills.some((paint) => paint.type.startsWith('GRADIENT'))) gradients += 1;
      if (node.effects?.some((effect) => effect.type === 'DROP_SHADOW')) shadows += 1;
      if ((node.cornerRadius ?? 0) > 0) radii += 1;
    });
    expect(texts).toBeGreaterThan(20);
    expect(gradients).toBeGreaterThan(0);
    expect(shadows).toBeGreaterThan(0);
    expect(radii).toBeGreaterThan(5);
  });

  it('has no unmeasured auto-width text', () => {
    const file = syncTextSizes(defaultDocument());
    walk(file.document, (node) => {
      if (node.type === 'TEXT') {
        expect(node.width).toBeGreaterThan(0);
        expect(node.height).toBeGreaterThan(0);
      }
    });
    expect(syncTextSizes(file).document).toBe(file.document);
  });

  it('renders to SVG without throwing', () => {
    const file = syncTextSizes(defaultDocument());
    const page = file.document.children[0]!;
    const svg = renderSvgDocument(file, page.children as SceneNode[]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Pigma');
    expect(svg.length).toBeGreaterThan(5000);
  });

  it('keeps every container rectangular and finite', () => {
    const file = defaultDocument();
    walk(file.document, (node) => {
      expect(Number.isFinite(node.width)).toBe(true);
      expect(Number.isFinite(node.height)).toBe(true);
      expect(Number.isFinite(node.transform.tx)).toBe(true);
      expect(Number.isFinite(node.transform.ty)).toBe(true);
      if (hasChildren(node)) expect(Array.isArray(node.children)).toBe(true);
    });
  });
});
