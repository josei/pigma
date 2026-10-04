import { describe, expect, it } from 'vitest';
import { renderSvgDocument } from './svgExport';
import { createFrameNode, createRectNode, createTextNode } from '../model/factory';
import { emptyFile } from '../model/validate';
import { syncTextSizes } from '../model/textSync';
import type { PigmaFile, SceneNode } from '../model/types';
import { parseFile, serializeFile } from '../model/serialize';

function scene(): { file: PigmaFile; nodes: SceneNode[] } {
  const file = emptyFile('Render');
  const page = file.document.children[0]!;
  const frame = createFrameNode(null, 0, 0, 200, 100, { name: 'Card' });
  frame.cornerRadius = 12;
  frame.effects = [
    { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 12, spread: 0, visible: true },
  ];
  const rect = createRectNode(null, 10, 10, 80, 40);
  rect.fills = [
    {
      type: 'GRADIENT_LINEAR',
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0 } },
        { position: 1, color: { r: 0, g: 0, b: 1 } },
      ],
    },
  ];
  const text = createTextNode(null, 10, 60, 'Hello\nworld');
  const hidden = createRectNode(null, 0, 0, 10, 10);
  hidden.visible = false;
  frame.children = [rect, text, hidden];
  page.children = [frame];
  return { file: syncTextSizes(file), nodes: [frame] };
}

describe('SVG export', () => {
  it('emits a standalone SVG sized to the exported bounds', () => {
    const { file, nodes } = scene();
    const svg = renderSvgDocument(file, nodes);
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="100"');
    expect(svg).toContain('viewBox="0 0 200 100"');
  });

  it('renders gradients, shadows, clipping and text content', () => {
    const { file, nodes } = scene();
    const svg = renderSvgDocument(file, nodes);
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('url(#pigma-fill-');
    expect(svg).toContain('feGaussianBlur');
    expect(svg).toContain('feFlood');
    expect(svg).toContain('<clipPath');
    expect(svg).toContain('<tspan');
    expect(svg).toContain('Hello');
    expect(svg).toContain('world');
  });

  it('skips hidden nodes entirely', () => {
    const { file, nodes } = scene();
    const svg = renderSvgDocument(file, nodes);
    expect(svg).not.toContain('width="10" height="10"');
  });

  it('applies transforms as SVG matrices', () => {
    const { file, nodes } = scene();
    const svg = renderSvgDocument(file, nodes);
    expect(svg).toContain('transform="matrix(1, 0, 0, 1, 0, 0)"');
  });

  it('renders inner shadows and layer blur as filter chains', () => {
    const file = emptyFile('Effects');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 40, 40);
    rect.effects = [
      { type: 'INNER_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.4 }, offset: { x: 0, y: 2 }, radius: 6, visible: true },
      { type: 'LAYER_BLUR', radius: 4, visible: true },
    ];
    page.children = [rect];
    const svg = renderSvgDocument(file, [rect]);
    expect(svg).toContain('feComponentTransfer');
    expect(svg).toContain('feGaussianBlur');
    expect(svg).toContain('color-interpolation-filters="sRGB"');
  });

  it('renders vector path data and star/polygon geometry', () => {
    const file = emptyFile('Shapes');
    const page = file.document.children[0]!;
    const vector = createRectNode(null, 0, 0, 20, 20);
    vector.type = 'VECTOR';
    vector.pathData = 'M 0 0 L 20 0 L 20 20 Z';
    vector.windingRule = 'EVENODD';
    page.children = [vector];
    const svg = renderSvgDocument(file, [vector]);
    expect(svg).toContain('M 0 0 L 20 0 L 20 20 Z');
    expect(svg).toContain('fill-rule="evenodd"');
  });
});

describe('blend modes', () => {
  function blended(mode: 'MULTIPLY' | 'NORMAL' | 'PASS_THROUGH'): string {
    const file = emptyFile('Blend');
    const page = file.document.children[0]!;
    const back = createRectNode(null, 0, 0, 40, 40);
    back.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
    const front = createRectNode(null, 10, 10, 40, 40);
    front.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }];
    front.blendMode = mode;
    page.children = [back, front];
    return renderSvgDocument(file, [back, front]);
  }

  it('writes the blend mode into the exported SVG', () => {
    expect(blended('MULTIPLY')).toContain('mix-blend-mode:multiply');
  });

  it('omits the style for normal and pass-through', () => {
    expect(blended('NORMAL')).not.toContain('mix-blend-mode');
    expect(blended('PASS_THROUGH')).not.toContain('mix-blend-mode');
  });

  it('maps every Figma mode onto a CSS blend keyword', () => {
    const expected: Record<string, string> = {
      SCREEN: 'screen',
      OVERLAY: 'overlay',
      DARKEN: 'darken',
      LIGHTEN: 'lighten',
      COLOR_DODGE: 'color-dodge',
      COLOR_BURN: 'color-burn',
      HARD_LIGHT: 'hard-light',
      SOFT_LIGHT: 'soft-light',
      DIFFERENCE: 'difference',
      EXCLUSION: 'exclusion',
      HUE: 'hue',
      SATURATION: 'saturation',
      COLOR: 'color',
      LUMINOSITY: 'luminosity',
    };
    for (const [mode, css] of Object.entries(expected)) {
      expect(blended(mode as 'MULTIPLY')).toContain(`mix-blend-mode:${css}`);
    }
  });

  it('keeps the blend mode through a JSON round trip', () => {
    const file = emptyFile('Blend');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 10, 10);
    rect.blendMode = 'SCREEN';
    page.children = [rect];
    const restored = parseFile(serializeFile(file));
    expect(restored.ok).toBe(true);
    expect((restored.file!.document.children[0]!.children[0] as SceneNode).blendMode).toBe('SCREEN');
  });
});

describe('stroke and corner polish', () => {
  function styled(patch: { dash?: number[]; radii?: [number, number, number, number] }): string {
    const file = emptyFile('Polish');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 120, 80);
    rect.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    rect.strokeWeight = 2;
    if (patch.dash) rect.dashPattern = patch.dash;
    if (patch.radii) rect.rectangleCornerRadii = patch.radii;
    page.children = [rect];
    return renderSvgDocument(file, [rect]);
  }

  it('exports the dash pattern as stroke-dasharray', () => {
    expect(styled({ dash: [8, 4] })).toContain('stroke-dasharray="8 4"');
    expect(styled({})).not.toContain('stroke-dasharray');
  });

  it('exports independent corner radii as a rounded path', () => {
    const svg = styled({ radii: [40, 0, 8, 0] });
    // Top-left 40, bottom-right 8, the other corners square.
    expect(svg).toContain('M 40 0');
    expect(svg).toContain('A 8 8');
    expect(svg).not.toContain('rx=');
  });

  it('keeps stroke align, dash and radii through a JSON round trip', () => {
    const file = emptyFile('Polish');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 60, 60);
    rect.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    rect.strokeAlign = 'INSIDE';
    rect.dashPattern = [4, 2];
    rect.rectangleCornerRadii = [1, 2, 3, 4];
    page.children = [rect];
    const restored = parseFile(serializeFile(file));
    expect(restored.ok).toBe(true);
    const node = restored.file!.document.children[0]!.children[0] as SceneNode;
    expect(node.strokeAlign).toBe('INSIDE');
    expect(node.dashPattern).toEqual([4, 2]);
    expect(node.rectangleCornerRadii).toEqual([1, 2, 3, 4]);
  });
});

describe('redlines never reach an export', () => {
  it('keeps the measurement overlay out of the exported SVG', () => {
    const file = emptyFile('Redlines');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 40, 30);
    page.children = [rect];
    const svg = renderSvgDocument(file, [rect]);
    expect(svg).not.toContain('canvas__redlines');
    expect(svg).not.toContain('data-testid');
    // The measurement colour is not part of the scene either.
    expect(svg).not.toContain('#f24822');
  });
});

describe('exporting a nested selection', () => {
  function nested() {
    const file = emptyFile('Nested');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 100, 50, 300, 200, { name: 'Frame' });
    const child = createRectNode(null, 40, 30, 80, 40);
    child.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.3, b: 0.5 } }];
    frame.children = [child];
    page.children = [frame];
    return { file, child, frame };
  }

  it('draws a nested node inside its own viewBox', () => {
    const { file, child } = nested();
    const svg = renderSvgDocument(file, [child]);
    // World bounds: frame (100,50) + child (40,30) -> (140,80) 80x40.
    expect(svg).toContain('viewBox="140 80 80 40"');
    expect(svg).toContain('width="80"');
    // The node is re-rooted onto its absolute transform, so it lands at the origin.
    expect(svg).toContain('transform="matrix(1, 0, 0, 1, 140, 80)"');
    expect(svg).not.toContain('matrix(1, 0, 0, 1, 40, 30)');
  });

  it('keeps a top-level node byte-identical', () => {
    const file = emptyFile('Top');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 20, 10, 60, 30);
    page.children = [rect];
    const svg = renderSvgDocument(file, [rect]);
    expect(svg).toContain('transform="matrix(1, 0, 0, 1, 20, 10)"');
    expect(svg).toContain('viewBox="20 10 60 30"');
  });
});
