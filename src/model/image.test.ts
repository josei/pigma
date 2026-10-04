import { describe, expect, it } from 'vitest';
import {
  IMAGE_MAX_PLACEMENT,
  fitImageBox,
  hasImageFill,
  imageDataUrlOf,
  imagePaint,
  placeImage,
  replaceImage,
  withImageFill,
} from './image';
import { createRectNode } from './factory';
import type { PigmaFile } from './types';
import { emptyFile } from './validate';
import {
  DEFAULT_CROP,
  cropOf,
  cropTransform,
  imageFillsOf,
  setImageCrop,
  setImageScaleMode,
} from './image';
import { parseFile, serializeFile } from './serialize';
import { findNode } from './tree';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

function setup() {
  const file = emptyFile('Images');
  const page = file.document.children[0]!;
  const rect = createRectNode(null, 100, 100, 200, 100);
  page.children = [rect];
  return { file, pageId: page.id, rectId: rect.id };
}

describe('image placement', () => {
  it('fits an image box to a sane size, preserving aspect ratio', () => {
    const small = fitImageBox(120, 60, { x: 0, y: 0 });
    expect(small).toEqual({ x: -60, y: -30, width: 120, height: 60 });

    const huge = fitImageBox(4000, 2000, { x: 100, y: 100 });
    expect(huge.width).toBe(IMAGE_MAX_PLACEMENT);
    expect(huge.height).toBe(IMAGE_MAX_PLACEMENT / 2);
    expect(huge.x).toBe(100 - IMAGE_MAX_PLACEMENT / 2);

    expect(fitImageBox(0, 0, { x: 0, y: 0 })).toMatchObject({ width: 1, height: 1 });
  });

  it('creates a rectangle node carrying an image fill', () => {
    const { file, pageId } = setup();
    const { file: placed, node } = placeImage(file, pageId, DATA_URL, { x: 40, y: 60, width: 300, height: 150 });
    expect(node.type).toBe('RECTANGLE');
    expect(node.name).toBe('Image');
    expect(node.width).toBe(300);
    expect(node.height).toBe(150);
    expect(node.transform.tx).toBe(40);
    expect(node.transform.ty).toBe(60);
    expect(hasImageFill(node)).toBe(true);
    expect(imageDataUrlOf(node)).toBe(DATA_URL);
    expect(findNode(placed.document, node.id)).not.toBeNull();
  });

  it('applies an image as a fill on the given nodes', () => {
    const { file, rectId } = setup();
    const filled = withImageFill(file, [rectId], DATA_URL, 'FIT');
    const node = findNode(filled.document, rectId)!;
    expect(hasImageFill(node)).toBe(true);
    if (node.type !== 'DOCUMENT' && node.type !== 'CANVAS') {
      expect(node.fills[0]).toMatchObject({ type: 'IMAGE', scaleMode: 'FIT', dataUrl: DATA_URL });
      expect(node.width).toBe(200);
    }
  });

  it('leaves locked nodes alone and reports missing images', () => {
    const { file, rectId } = setup();
    const locked = { ...file, document: { ...file.document, children: file.document.children.map((page) => ({ ...page, children: page.children.map((child) => ({ ...child, locked: true })) })) } };
    expect(withImageFill(locked, [rectId], DATA_URL).document).toBe(locked.document);
    expect(imageDataUrlOf(findNode(file.document, rectId)!)).toBeNull();
    expect(replaceImage(file, rectId, DATA_URL).document).toBe(file.document);
  });

  it('replaces the bytes of an existing image without moving it', () => {
    const { file, pageId, rectId } = setup();
    const filled = withImageFill(file, [rectId], DATA_URL);
    const replaced = replaceImage(filled, rectId, 'data:image/png;base64,OTHER');
    const node = findNode(replaced.document, rectId)!;
    expect(imageDataUrlOf(node)).toBe('data:image/png;base64,OTHER');
    if (node.type !== 'DOCUMENT' && node.type !== 'CANVAS') {
      expect(node.width).toBe(200);
      expect(node.transform.tx).toBe(100);
    }
    void pageId;
  });

  it('keeps image bytes through JSON persistence', () => {
    const { file, pageId } = setup();
    const { file: placed, node } = placeImage(file, pageId, DATA_URL, { x: 0, y: 0, width: 64, height: 64 });
    const restored = parseFile(serializeFile(placed));
    expect(restored.ok).toBe(true);
    const roundTripped = findNode(restored.file!.document, node.id)!;
    expect(imageDataUrlOf(roundTripped)).toBe(DATA_URL);
    expect(hasImageFill(roundTripped)).toBe(true);
  });

  it('builds image paints with the requested scale mode', () => {
    expect(imagePaint(DATA_URL, 'CROP')).toEqual({ type: 'IMAGE', dataUrl: DATA_URL, scaleMode: 'CROP', opacity: 1 });
  });
});

describe('image editing (M2)', () => {
  const DATA_URL = 'data:image/png;base64,AAAA';

  function withImage(): { file: PigmaFile; id: string } {
    const file = emptyFile('Images');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 200, 100);
    rect.fills = [imagePaint(DATA_URL, 'FILL')];
    page.children = [rect];
    return { file, id: rect.id };
  }

  it('switches the scale mode and seeds a crop transform', () => {
    const { file, id } = withImage();
    const fit = setImageScaleMode(file, [id], 'FIT');
    expect(imageFillsOf(fit.document.children[0]!.children[0]!)[0]!.paint.scaleMode).toBe('FIT');
    // CROP needs a transform so the bitmap has somewhere to start.
    const cropped = setImageScaleMode(fit, [id], 'CROP');
    const paint = imageFillsOf(cropped.document.children[0]!.children[0]!)[0]!.paint;
    expect(paint.scaleMode).toBe('CROP');
    expect(paint.imageTransform).toEqual(cropTransform(DEFAULT_CROP));
    // Leaving CROP keeps the transform for when the user returns.
    const back = setImageScaleMode(cropped, [id], 'TILE');
    expect(imageFillsOf(back.document.children[0]!.children[0]!)[0]!.paint.imageTransform).toBeDefined();
  });

  it('round-trips crop controls through the transform', () => {
    const { file, id } = withImage();
    const cropped = setImageCrop(file, [id], { scale: 2, offsetX: 0.25, offsetY: -0.1 });
    const paint = imageFillsOf(cropped.document.children[0]!.children[0]!)[0]!.paint;
    expect(paint.scaleMode).toBe('CROP');
    expect(cropOf(paint)).toEqual({ scale: 2, offsetX: 0.25, offsetY: -0.1 });

    // A bigger scale shows a smaller part of the image (a = 1/scale).
    const [[a, , tx]] = paint.imageTransform!;
    expect(a).toBe(0.5);
    expect(tx).toBeCloseTo(0.5 - 0.25 * 0.5, 5);
    expect(cropOf({ type: 'IMAGE', dataUrl: DATA_URL })).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it('ignores nodes without image fills', () => {
    const file = emptyFile('Plain');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 10, 10);
    page.children = [rect];
    expect(setImageScaleMode(file, [rect.id], 'FIT')).toBe(file);
    expect(setImageCrop(file, [rect.id], { scale: 2, offsetX: 0, offsetY: 0 })).toBe(file);
    expect(setImageScaleMode(file, ['missing'], 'FIT')).toBe(file);
  });

  it('replaces the bytes and keeps the box, mode and crop', () => {
    const { file, id } = withImage();
    const cropped = setImageCrop(file, [id], { scale: 3, offsetX: 0.1, offsetY: 0.2 });
    const replaced = replaceImage(cropped, id, 'data:image/png;base64,BBBB');
    const node = replaced.document.children[0]!.children[0]!;
    const paint = imageFillsOf(node)[0]!.paint;
    expect(paint.dataUrl).toBe('data:image/png;base64,BBBB');
    expect(paint.scaleMode).toBe('CROP');
    expect(paint.imageTransform).toEqual(cropTransform({ scale: 3, offsetX: 0.1, offsetY: 0.2 }));
    expect(node.width).toBe(200);
    expect(node.height).toBe(100);
  });
});
