import { describe, expect, it } from 'vitest';
import { deflateSync, inflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { renderSvgDocument } from './svgExport';
import { emptyFile } from '../model/validate';
import { createRectNode } from '../model/factory';
import { imagePaint } from '../model/image';
import type { PigmaFile, SceneNode } from '../model/types';

/**
 * TILE image fills.
 *
 * The roadmap listed "TILE renders as cover" as a known limitation: the mode was
 * offered and stored, but the pattern tile was the node box, so the image was
 * stretched over the fill area once instead of repeating. These tests prove the
 * repetition by *sampling pixels*, which is the only thing that tells tiling
 * apart from cover.
 */

// --- a tiny 2x2 checkerboard PNG, built here so the test owns its fixture ---

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
  const crcInput = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

/** A 2x2 PNG: red, green / blue, white — four different pixels, so any offset shows. */
function checkerboardPng(): string {
  const width = 2;
  const height = 2;
  const raw = new Uint8Array(height * (1 + width * 3));
  const pixels: Array<[number, number, number]> = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ];
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixels[y * width + x]!;
      const at = rowStart + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(chunk('IHDR', ihdr)),
    Buffer.from(chunk('IDAT', new Uint8Array(deflateSync(raw)))),
    Buffer.from(chunk('IEND', new Uint8Array())),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const DATA_URL = checkerboardPng();

/** A square node with one image fill, rendered to SVG and rasterised. */
function rasterize(options: {
  scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE';
  size: number;
  naturalWidth?: number;
  naturalHeight?: number;
  scalingFactor?: number;
}): { svg: string; pixels: (x: number, y: number) => [number, number, number] } {
  const file: PigmaFile = emptyFile('Tile');
  const page = file.document.children[0]!;
  const node = createRectNode(file.document, 0, 0, options.size, options.size);
  const paint = imagePaint(DATA_URL, options.scaleMode, {
    width: options.naturalWidth ?? 2,
    height: options.naturalHeight ?? 2,
  });
  if (options.scalingFactor !== undefined) paint.scalingFactor = options.scalingFactor;
  node.fills = [paint];
  page.children = [node];

  const svg = renderSvgDocument(file, [node as SceneNode]);
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: options.size } }).render();
  const png = rendered.asPng();
  const { width, height } = rendered;
  // Decode the raster back to pixels (RGBA, 8-bit, no interlace).
  const image = decodePng(png, width, height);
  return { svg, pixels: image };
}

/** Minimal PNG reader for the raster resvg produces (8-bit RGBA, filter types 0-4). */
function decodePng(png: Buffer, width: number, height: number): (x: number, y: number) => [number, number, number] {
  const raw = inflateChunks(png);
  const stride = width * 4;
  const out = new Uint8Array(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos]!;
    pos += 1;
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const previous = y > 0 ? out.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    const target = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? target[i - 4]! : 0;
      const up = previous[i]!;
      const upLeft = i >= 4 ? previous[i - 4]! : 0;
      const value = row[i]!;
      let result: number;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + up;
          break;
        case 3:
          result = value + ((left + up) >> 1);
          break;
        default: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          result = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
        }
      }
      target[i] = result & 0xff;
    }
  }
  return (x, y) => {
    const at = y * stride + x * 4;
    return [out[at]!, out[at + 1]!, out[at + 2]!];
  };
}

/** Concatenate and inflate the IDAT chunks of a PNG. */
function inflateChunks(png: Buffer): Uint8Array {
  const parts: Buffer[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') parts.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return new Uint8Array(inflateRaw(Buffer.concat(parts)));
}

function inflateRaw(bytes: Buffer): Buffer {
  // resvg writes a zlib stream; node's inflateSync handles the header.
  return inflateSync(bytes);
}

describe('TILE image fills repeat the bitmap', () => {
  it('repeats: a pixel matches one tile period away and differs half a tile away', () => {
    const { pixels } = rasterize({ scaleMode: 'TILE', size: 8, naturalWidth: 2, naturalHeight: 2 });

    // The tile is 2x2, so x and x+2 show the same pixel of the bitmap...
    expect(pixels(0, 0), 'a pixel one tile period away did not match').toEqual(pixels(2, 0));
    expect(pixels(1, 0), 'a pixel one tile period away did not match').toEqual(pixels(3, 0));
    // ...and x+1 shows a different one. Cover would make every pixel unique, so
    // this pair of assertions is what proves repetition rather than stretching.
    expect(pixels(0, 0), 'half a tile away looked the same: nothing was tiled').not.toEqual(pixels(1, 0));
    // The pattern also repeats vertically.
    expect(pixels(0, 0)).toEqual(pixels(0, 2));
  });

  it('honours the scaling factor, which changes the tile period', () => {
    const { svg, pixels } = rasterize({
      scaleMode: 'TILE',
      size: 8,
      naturalWidth: 2,
      naturalHeight: 2,
      scalingFactor: 2,
    });
    // A 2x scaled tile is 4px, so the repeat period is 4.
    expect(svg).toContain('width="4" height="4"');
    expect(pixels(0, 0)).toEqual(pixels(4, 0));
    expect(pixels(0, 0)).not.toEqual(pixels(2, 0));
  });

  it('exports a userSpaceOnUse pattern sized to the image, not the box', () => {
    const { svg } = rasterize({ scaleMode: 'TILE', size: 8, naturalWidth: 2, naturalHeight: 2 });
    expect(svg).toContain('patternUnits="userSpaceOnUse"');
    // The tile is the bitmap's size; the box is 8, so a box-sized tile would be
    // the "renders as cover" bug this closes.
    expect(svg).toContain('width="2" height="2"');
    expect(svg).not.toContain('width="8" height="8"><image');
  });

  it('leaves FILL, FIT and CROP unchanged', () => {
    for (const scaleMode of ['FILL', 'FIT', 'CROP'] as const) {
      const { svg } = rasterize({ scaleMode, size: 8, naturalWidth: 2, naturalHeight: 2 });
      // These modes stretch the bitmap over the node box: one tile, box-sized.
      expect(svg, scaleMode).toContain('patternUnits="userSpaceOnUse"');
      expect(svg, scaleMode).toContain('width="8" height="8"');
      expect(svg, scaleMode).toContain(scaleMode === 'FIT' ? 'xMidYMid meet' : 'xMidYMid slice');
      // ...and no repeat: the pattern's tile is the box, so the fill is one copy.
      expect(svg, scaleMode).not.toContain('width="2" height="2"><image');
    }
  });

  it('falls back to the box when the natural size was never recorded', () => {
    const file = emptyFile('Unknown');
    const page = file.document.children[0]!;
    const node = createRectNode(file.document, 0, 0, 8, 8);
    node.fills = [{ type: 'IMAGE', dataUrl: DATA_URL, scaleMode: 'TILE', opacity: 1 }];
    page.children = [node];
    const svg = renderSvgDocument(file, [node as SceneNode]);
    // Nothing to repeat at: the tile stays the box rather than inventing a size.
    expect(svg).toContain('width="8" height="8"');
    expect(svg).toContain('patternUnits="userSpaceOnUse"');
  });
});
