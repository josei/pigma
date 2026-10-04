import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { renderSvgDocument } from './svgExport';
import { emptyFile } from '../model/validate';
import { createFrameNode } from '../model/factory';
import { parseFile } from '../model/serialize';
import { serializeFile } from '../model/serialize';
import { createEllipseNode, createRectNode } from '../model/factory';
import type { PigmaFile, SceneNode } from '../model/types';

/**
 * Layer masks (Figma's "Use as mask").
 *
 * A mask clips the siblings **above** it in the parent, so the checks that matter
 * are geometric: a pixel inside the mask outline shows the masked layer, a pixel
 * outside it does not. Markup alone would not prove that, so these tests
 * rasterise and sample pixels.
 */

// --- a solid 4x4 PNG, built here so the test owns its fixture ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A 4x4 red PNG. */
function redPng(): string {
  const size = 4;
  const raw = new Uint8Array(size * (1 + size * 3));
  for (let y = 0; y < size; y += 1) {
    const row = y * (1 + size * 3);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const at = row + 1 + x * 3;
      raw[at] = 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(chunk('IHDR', ihdr)),
    Buffer.from(chunk('IDAT', new Uint8Array(deflateSync(raw)))),
    Buffer.from(chunk('IEND', new Uint8Array())),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** A black 100x100 mask and a 200x200 red square above it. */
function scene(): { file: PigmaFile; maskId: string; topId: string } {
  const file = emptyFile('Mask');
  const page = file.document.children[0]!;
  const mask = createRectNode(file.document, 0, 0, 100, 100);
  mask.name = 'Mask';
  mask.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
  const top = createRectNode(file.document, 0, 0, 200, 200);
  top.name = 'Top';
  top.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
  page.children = [mask, top];
  return { file, maskId: mask.id, topId: top.id };
}

/**
 * Rasterise a scene and hand back a pixel reader in its own coordinates.
 *
 * resvg exposes RGBA pixels directly, so nothing here decodes a PNG.
 */
function raster(file: PigmaFile, nodes: SceneNode[], width: number) {
  const svg = renderSvgDocument(file, nodes);
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render();
  const rgba = rendered.pixels;
  return {
    svg,
    pixels: (x: number, y: number): [number, number, number] => {
      const at = (y * rendered.width + x) * 4;
      return [rgba[at]!, rgba[at + 1]!, rgba[at + 2]!];
    },
  };
}

/**
 * Every `<defs>` entry must be referenced, and every reference must resolve —
 * the same two-way check the import QA makes. A mask with nothing to clip used
 * to emit a dead `clipPath` here.
 */
function defAudit(svg: string): { defs: string[]; refs: string[]; dead: string[]; missing: string[] } {
  const defs = [...svg.matchAll(/<(?:clipPath|mask|linearGradient|radialGradient|filter|pattern)\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]!);
  const refs = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]!);
  return {
    defs,
    refs,
    dead: defs.filter((id) => !refs.includes(id)),
    missing: refs.filter((id) => !defs.includes(id)),
  };
}

describe('layer masks', () => {
  it('emits no def for a mask with nothing above it', () => {
    const file = emptyFile('Topmost');
    const page = file.document.children[0]!;
    const mask = createRectNode(file.document, 0, 0, 100, 100);
    (mask as { isMask?: boolean }).isMask = true;
    page.children = [mask];

    const { svg } = raster(file, [mask], 200);
    const audit = defAudit(svg);
    expect(audit.dead, `dead defs: ${JSON.stringify(audit.dead)}`).toEqual([]);
    expect(svg).not.toContain('pigma-mask-');
    // Still a legal layer: it renders its own fill.
    expect(svg).toContain('<rect x="0" y="0" width="100" height="100"');
  });

  it('emits no defs when both siblings are masks', () => {
    const file = emptyFile('Both');
    const page = file.document.children[0]!;
    const first = createRectNode(file.document, 0, 0, 100, 100);
    const second = createRectNode(file.document, 0, 0, 100, 100);
    (first as { isMask?: boolean }).isMask = true;
    (second as { isMask?: boolean }).isMask = true;
    page.children = [first, second];

    const { svg } = raster(file, page.children, 200);
    const audit = defAudit(svg);
    expect(audit.dead, `dead defs: ${JSON.stringify(audit.dead)}`).toEqual([]);
    expect(svg).not.toContain('pigma-mask-');
  });

  it('gives each mask its own run, with no dead defs', () => {
    const file = emptyFile('Runs');
    const page = file.document.children[0]!;
    const outer = createRectNode(file.document, 0, 0, 100, 100);
    (outer as { isMask?: boolean }).isMask = true;
    const underOuter = createRectNode(file.document, 0, 0, 200, 200);
    underOuter.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 }];
    const inner = createRectNode(file.document, 0, 0, 40, 40);
    (inner as { isMask?: boolean }).isMask = true;
    const underInner = createRectNode(file.document, 0, 0, 200, 200);
    underInner.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    page.children = [outer, underOuter, inner, underInner];

    const { svg, pixels } = raster(file, page.children, 200);
    const audit = defAudit(svg);
    expect(audit.dead, `dead defs: ${JSON.stringify(audit.dead)}`).toEqual([]);
    expect(audit.missing, `missing defs: ${JSON.stringify(audit.missing)}`).toEqual([]);
    expect(audit.defs).toHaveLength(2);
    // Each mask clips its own run: the inner 40x40 area shows red, the ring
    // around it inside the outer mask shows blue, and beyond the outer mask the
    // run paints nothing.
    expect(pixels(20, 20)).toEqual([255, 0, 0]);
    expect(pixels(60, 60)).toEqual([0, 0, 255]);
    expect(pixels(150, 150)).not.toEqual([0, 0, 255]);
  });

  it('keeps a mask that has a run, and drops one that does not', () => {
    const file = emptyFile('Mixed');
    const page = file.document.children[0]!;
    const top = createRectNode(file.document, 0, 0, 200, 200);
    top.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    const lonely = createRectNode(file.document, 0, 0, 50, 50);
    (lonely as { isMask?: boolean }).isMask = true;
    const lower = createRectNode(file.document, 0, 0, 100, 100);
    (lower as { isMask?: boolean }).isMask = true;
    page.children = [lower, top, lonely];

    const { svg } = raster(file, page.children, 200);
    const audit = defAudit(svg);
    expect(audit.dead, `dead defs: ${JSON.stringify(audit.dead)}`).toEqual([]);
    expect(audit.defs, 'only the mask with a sibling above should emit a def').toHaveLength(1);
    expect(svg).toContain(`pigma-mask-${lower.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  });

  it('clips the siblings above it to the mask outline', () => {
    const { file, maskId, topId } = scene();
    const mask = file.document.children[0]!.children.find((node) => node.id === maskId)!;
    (mask as { isMask?: boolean }).isMask = true;
    const top = file.document.children[0]!.children.find((node) => node.id === topId)!;

    const { svg, pixels } = raster(file, [mask, top], 200);
    // A fully opaque mask is exactly equivalent as a clip, so it stays one.
    expect(svg).toContain('clip-path="url(#pigma-mask-');
    // Inside the 100x100 mask: the red square shows.
    expect(pixels(50, 50)).toEqual([255, 0, 0]);
    // Outside it: the square is clipped away, so the canvas background shows.
    expect(pixels(150, 150), 'the masked layer was not clipped').not.toEqual([255, 0, 0]);
  });

  it('restores the full layer when the mask is removed', () => {
    const { file, maskId, topId } = scene();
    const mask = file.document.children[0]!.children.find((node) => node.id === maskId)!;
    const top = file.document.children[0]!.children.find((node) => node.id === topId)!;

    const { pixels } = raster(file, [mask, top], 200);
    expect(pixels(150, 150), 'an unmasked layer was clipped anyway').toEqual([255, 0, 0]);
  });

  it('clips only the siblings above the mask, not the ones below', () => {
    const { file, maskId, topId } = scene();
    const page = file.document.children[0]!;
    const below = createRectNode(file.document, 0, 0, 200, 200);
    below.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 }];
    const mask = page.children.find((node) => node.id === maskId)!;
    (mask as { isMask?: boolean }).isMask = true;
    const top = page.children.find((node) => node.id === topId)!;
    // Order: below, mask, top — the mask clips only what follows it.
    page.children = [below, mask, top];

    const { pixels } = raster(file, [below, mask, top], 200);
    // The blue square below the mask is untouched outside the mask outline.
    expect(pixels(150, 150)).toEqual([0, 0, 255]);
    // The red square above it is clipped to the mask.
    expect(pixels(50, 50)).toEqual([255, 0, 0]);
  });

  it('works inside a frame, and the mask stays a layer', () => {
    const file = emptyFile('Frame');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 0, 0, 300, 300);
    const mask = createRectNode(file.document, 0, 0, 100, 100);
    const top = createRectNode(file.document, 0, 0, 300, 300);
    top.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    (mask as { isMask?: boolean }).isMask = true;
    frame.children = [mask, top];
    page.children = [frame];

    const { svg, pixels } = raster(file, [frame], 300);
    // A fully opaque mask is exactly equivalent as a clip, so it stays one.
    expect(svg).toContain('clip-path="url(#pigma-mask-');
    expect(pixels(50, 50)).toEqual([255, 0, 0]);
    expect(pixels(250, 250)).not.toEqual([255, 0, 0]);
    // The mask is still a node in the document, with its own id.
    expect(mask.id).toBeTruthy();
  });

  it('nests: a mask inside a masked run clips only its own siblings', () => {
    const file = emptyFile('Nested');
    const page = file.document.children[0]!;
    const outerMask = createRectNode(file.document, 0, 0, 100, 100);
    (outerMask as { isMask?: boolean }).isMask = true;
    const middle = createRectNode(file.document, 0, 0, 200, 200);
    middle.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 }];
    const innerMask = createRectNode(file.document, 0, 0, 40, 40);
    (innerMask as { isMask?: boolean }).isMask = true;
    const top = createRectNode(file.document, 0, 0, 200, 200);
    top.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    page.children = [outerMask, middle, innerMask, top];

    const { pixels } = raster(file, page.children, 200);
    // The inner mask sits in the outer mask's run and clips the red square to a
    // 40x40 area, so inside it the red shows...
    expect(pixels(20, 20)).toEqual([255, 0, 0]);
    // ...and just outside it the red is gone, showing the blue beneath.
    expect(pixels(60, 60)).toEqual([0, 0, 255]);
    // The outer mask still clips everything above it: its own 100x100 outline
    // ends there, and outside it nothing of the run paints.
    expect(pixels(150, 150)).not.toEqual([0, 0, 255]);
  });

  it('round-trips through JSON', () => {
    const { file, maskId } = scene();
    const page = file.document.children[0]!;
    (page.children.find((node) => node.id === maskId) as { isMask?: boolean }).isMask = true;
    const reloaded = parseFile(serializeFile(file)).file!;
    const mask = reloaded.document.children[0]!.children.find((node) => node.id === maskId)!;
    expect((mask as { isMask?: boolean }).isMask).toBe(true);
  });

  it('uses an image fill and a shaped mask without special casing', () => {
    const file = emptyFile('Shaped');
    const page = file.document.children[0]!;
    const mask = createEllipseNode(file.document, 0, 0, 100, 100);
    (mask as { isMask?: boolean }).isMask = true;
    const top = createRectNode(file.document, 0, 0, 200, 200);
    top.fills = [{ type: 'IMAGE', dataUrl: redPng(), scaleMode: 'FILL', naturalWidth: 4, naturalHeight: 4, opacity: 1 }];
    page.children = [mask, top];

    const { svg, pixels } = raster(file, [mask, top], 200);
    // The clip is the ellipse's own path, not its bounding box.
    expect(svg).toMatch(/clipPath id="pigma-mask-[^"]+"><path d="M 0 50 A 50 50/);
    expect(pixels(50, 50)).toEqual([255, 0, 0]);
    expect(pixels(5, 5), 'the ellipse mask was applied as its bounding box').not.toEqual([255, 0, 0]);
  });
});

describe('alpha masks', () => {
  it('masks correctly when the mask is placed away from the origin', () => {
    // The mask region lives in the parent's coordinate space: a mask that is not
    // at the origin used to blank its whole run, because the region was built at
    // the origin instead of around the mask's transformed box.
    const file = emptyFile('Placed');
    const page = file.document.children[0]!;
    const mask = createRectNode(file.document, 300, 200, 100, 100);
    mask.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
    (mask as { isMask?: boolean }).isMask = true;
    const under = createRectNode(file.document, 0, 0, 600, 600);
    under.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 }];
    const top = createRectNode(file.document, 0, 0, 600, 600);
    top.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    page.children = [under, mask, top];

    const { pixels } = raster(file, page.children, 600);
    const [r, , b] = pixels(350, 250);
    expect(Math.abs(r - 128), `red ${r} at the mask's own position should be a blend`).toBeLessThan(4);
    expect(Math.abs(b - 63), `blue ${b} at the mask's own position should be a blend`).toBeLessThan(4);
    // Outside the placed mask the top layer is hidden entirely.
    expect(pixels(50, 50)).toEqual([0, 0, 255]);
  });

  it('does not vouch for a gradient that carries a paint-level opacity', () => {
    // The regression: only the stops were checked, so a gradient with opaque
    // stops and paint opacity 0.5 took the clip branch and clipped as if fully
    // opaque. The render path applies paint.opacity to every paint type.
    const file = emptyFile('Gradient opacity');
    const page = file.document.children[0]!;
    const mask = createRectNode(file.document, 0, 0, 100, 100);
    mask.fills = [
      {
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
        ],
        opacity: 0.5,
      },
    ];
    (mask as { isMask?: boolean }).isMask = true;
    const under = createRectNode(file.document, 0, 0, 200, 200);
    under.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 }];
    const top = createRectNode(file.document, 0, 0, 200, 200);
    top.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    page.children = [under, mask, top];

    const { svg, pixels } = raster(file, page.children, 200);
    expect(svg, 'a half-opacity gradient must not clip by geometry').toContain('mask="url(#pigma-mask-');
    expect(svg).not.toContain('clip-path="url(#pigma-mask-');
    // Half the red over the half-painted mask over the blue: measured 128/0/63.
    const [r, , b] = pixels(50, 50);
    expect(Math.abs(r - 128), `red ${r} should be about half`).toBeLessThan(4);
    expect(Math.abs(b - 63), `blue ${b} should be about a quarter`).toBeLessThan(4);
    expect(pixels(150, 150), 'outside the outline nothing shows').toEqual([0, 0, 255]);
  });

  it('is conservative about every way a paint could be less than opaque', () => {
    const cases: Array<[string, unknown[]]> = [
      ['a solid whose colour carries alpha', [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 0.5 }, opacity: 1 }]],
      ['a paint with a blend mode', [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1, blendMode: 'MULTIPLY' }]],
      [
        'a stack with one translucent fill',
        [
          { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 },
          { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.5 },
        ],
      ],
      ['a gradient stop that is not opaque', [{ type: 'GRADIENT_LINEAR', gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 0, a: 0.5 } }], opacity: 1 }]],
      ['a gradient with a translucent paint opacity', [{ type: 'GRADIENT_RADIAL', gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }], opacity: 0.25 }]],
      ['an image fill', [{ type: 'IMAGE', dataUrl: redPng(), scaleMode: 'FILL', naturalWidth: 4, naturalHeight: 4, opacity: 1 }]],
      ['no fill at all', []],
    ];
    for (const [label, fills] of cases) {
      const file = emptyFile('Conservative');
      const page = file.document.children[0]!;
      const mask = createRectNode(file.document, 0, 0, 100, 100);
      (mask as { fills: unknown }).fills = fills;
      (mask as { isMask?: boolean }).isMask = true;
      const top = createRectNode(file.document, 0, 0, 200, 200);
      page.children = [mask, top];
      const { svg } = raster(file, page.children, 200);
      expect(svg, `${label} should take the alpha mask branch`).toContain('mask="url(#pigma-mask-');
      expect(svg, `${label} must not clip by geometry`).not.toContain('clip-path="url(#pigma-mask-');
    }
  });

  it('still clips a shape that carries an empty child list', () => {
    // Imported documents (and the browser fixtures) put `children: []` on plain
    // shapes; an empty list is not container content and must not disqualify it.
    const file = emptyFile('Empty children');
    const page = file.document.children[0]!;
    const mask = createRectNode(file.document, 0, 0, 100, 100);
    (mask as { isMask?: boolean }).isMask = true;
    (mask as unknown as { children: unknown[] }).children = [];
    const top = createRectNode(file.document, 0, 0, 200, 200);
    top.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    page.children = [mask, top];

    const { svg } = raster(file, page.children, 200);
    expect(svg).toContain('clipPath id="pigma-mask-');
    expect(svg, 'an empty child list must not force the alpha branch').not.toContain('<mask');
  });

  it('still clips when a gradient really is opaque', () => {
    const file = emptyFile('Opaque gradient');
    const page = file.document.children[0]!;
    const mask = createRectNode(file.document, 0, 0, 100, 100);
    mask.fills = [
      {
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
        ],
        opacity: 1,
      },
    ];
    (mask as { isMask?: boolean }).isMask = true;
    const top = createRectNode(file.document, 0, 0, 200, 200);
    top.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    page.children = [mask, top];

    const { svg } = raster(file, page.children, 200);
    expect(svg).toContain('clipPath id="pigma-mask-');
    expect(svg).not.toContain('<mask');
  });

  it('masks a container by its content, not by an empty outline', () => {
    // A frame marked as a mask used to contribute no content at all, hiding the
    // whole run; it must mask by what it renders.
    const file = emptyFile('Container mask');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 0, 0, 200, 200);
    // No fill of its own: the mask alpha must come from the frame's content.
    frame.fills = [];
    const shape = createRectNode(file.document, 50, 50, 100, 100);
    shape.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
    frame.children = [shape];
    (frame as { isMask?: boolean }).isMask = true;
    const top = createRectNode(file.document, 0, 0, 200, 200);
    top.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    page.children = [frame, top];

    const { pixels } = raster(file, page.children, 200);
    // Inside the frame's shape the masked layer shows...
    expect(pixels(100, 100)).toEqual([255, 0, 0]);
    // ...and outside it does not.
    expect(pixels(10, 10), 'a container mask should not blank its whole run').not.toEqual([255, 0, 0]);
  });

  it('chooses the mechanism by whether alpha can matter', () => {
    const file = emptyFile('Choice');
    const page = file.document.children[0]!;
    const opaque = createRectNode(file.document, 0, 0, 100, 100);
    (opaque as { isMask?: boolean }).isMask = true;
    const above = createRectNode(file.document, 0, 0, 200, 200);
    page.children = [opaque, above];

    // Opaque fill: the outline and the alpha agree, so it stays a clip path.
    let svg = raster(file, page.children, 200).svg;
    expect(svg).toContain('clipPath id="pigma-mask-');
    expect(svg).toContain('clip-path="url(#pigma-mask-');
    expect(svg, 'an opaque mask needs no alpha mask').not.toContain('<mask');

    // Half-transparent fill: alpha matters, so it becomes an alpha mask.
    (opaque as { fills: unknown }).fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
    svg = raster(file, page.children, 200).svg;
    expect(svg).toContain('mask-type="alpha"');
    expect(svg).toContain('mask="url(#pigma-mask-');
    expect(svg, 'a semi-transparent mask must not clip by geometry').not.toContain('clip-path="url(#pigma-mask-');
    // The def is whitewashed so a luminance-only renderer still resolves alpha.
    expect(svg).toMatch(/<mask[^>]*>[\s\S]*?fill="rgb\(255, 255, 255\)"/);
  });

  /** A black opaque mask over a blue square, with a red square above it. */
  const overBlue = (maskPaint: (node: SceneNode) => void) => {
    const file = emptyFile('Alpha');
    const page = file.document.children[0]!;
    const mask = createRectNode(file.document, 0, 0, 100, 100);
    mask.name = 'Mask';
    maskPaint(mask);
    (mask as { isMask?: boolean }).isMask = true;
    const under = createRectNode(file.document, 0, 0, 200, 200);
    under.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 }];
    const top = createRectNode(file.document, 0, 0, 200, 200);
    top.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    // Order: the blue square below the mask, the mask, then the red square above.
    page.children = [under, mask, top];
    return { file, nodes: page.children, mask, top };
  };

  it('(a) an opaque fill masks exactly as the clip did', () => {
    const { file, nodes } = overBlue((mask) => {
      // Deliberately BLACK: luminance masking would hide everything here.
      mask.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
    });
    const { pixels } = raster(file, nodes, 200);
    expect(pixels(50, 50), 'an opaque black mask must mask fully, not by luminance').toEqual([255, 0, 0]);
    expect(pixels(150, 150), 'outside the mask outline the layer must not show').toEqual([0, 0, 255]);
  });

  it('(b) a 50% fill partially masks', () => {
    const { file, nodes } = overBlue((mask) => {
      mask.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
    });
    const { pixels } = raster(file, nodes, 200);
    const [r, g, b] = pixels(50, 50);
    // Two contributions, exactly as Figma composites them: the mask layer paints
    // its own 50% black over the blue (blue -> 127), then the red square is
    // masked at 50% over that (red -> 128, blue -> 63). What matters is that it
    // is a genuine partial blend: neither the fully-masked red nor the bare blue.
    // Measured 128/0/63.
    expect(Math.abs(r - 128), `red ${r} should be about half of 255`).toBeLessThan(4);
    expect(Math.abs(b - 63), `blue ${b} should be about a quarter`).toBeLessThan(4);
    expect(g).toBe(0);
    expect([r, g, b], 'a 50% mask must not behave like a full mask').not.toEqual([255, 0, 0]);
    // Outside the mask outline the blend does not happen at all.
    expect(pixels(150, 150)).toEqual([0, 0, 255]);
  });

  it('(c) a gradient fill masks by that gradient', () => {
    const { file, nodes } = overBlue((mask) => {
      mask.fills = [
        {
          type: 'GRADIENT_LINEAR',
          gradientStops: [
            { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 0, a: 0 } },
          ],
        },
      ];
    });
    const { pixels } = raster(file, nodes, 200);
    // The gradient runs left to right across the mask's box.
    const [nearOpaque, , nearBlue] = pixels(2, 50);
    expect(nearOpaque, `the opaque end of the gradient should show the red`).toBeGreaterThan(240);
    expect(nearBlue, `the opaque end should hide the blue`).toBeLessThan(15);
    const [farRed, , farBlue] = pixels(98, 50);
    expect(farRed, `the transparent end should hide the red`).toBeLessThan(15);
    expect(farBlue, `the transparent end should show the blue`).toBeGreaterThan(240);
    // Midway: a real blend of the two.
    const [r, , b] = pixels(50, 50);
    expect(Math.abs(r - 128), `mid-gradient red ${r} should be about half`).toBeLessThan(12);
    // The blue is behind both the mask's own half-transparent paint and the
    // half-masked red, so it lands between its two ends — a real ramp.
    expect(b, `mid-gradient blue ${b} should be between the ends`).toBeGreaterThan(40);
    expect(b).toBeLessThan(100);
    // The masked layer never paints outside the mask outline.
    expect(pixels(150, 150)).toEqual([0, 0, 255]);
  });

  it('honours the mask layer opacity as well as its fill alpha', () => {
    const { file, nodes } = overBlue((mask) => {
      mask.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
      (mask as { opacity: number }).opacity = 0.5;
    });
    const { pixels } = raster(file, nodes, 200);
    const [r, , b] = pixels(50, 50);
    expect(Math.abs(r - 128), 'the layer opacity should scale the mask alpha').toBeLessThan(4);
    expect(Math.abs(b - 63)).toBeLessThan(4);
  });
});
