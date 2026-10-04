import type { AnyNode, ImagePaint, PigmaFile, Rect, SceneNode, TransformMatrix } from './types';
import { createRectNode } from './factory';
import { findNode, insertChild, updateNode } from './tree';
import { applyNodePatchToAll, type NodePatch } from './ops';
import { roundTo } from './matrix';

/**
 * Image placement.
 *
 * Images live as `IMAGE` paints carrying an inline `dataUrl`, so they render in
 * the SVG canvas, survive JSON/localStorage persistence and need no asset
 * pipeline. `placeImage` creates a rectangle node sized to the image; applying
 * an image to an existing node just swaps its fill.
 */

export const IMAGE_MAX_PLACEMENT = 640;

/** Placement box for an image of `naturalWidth` x `naturalHeight`, capped to a sane size. */
export function fitImageBox(
  naturalWidth: number,
  naturalHeight: number,
  center: { x: number; y: number },
  max = IMAGE_MAX_PLACEMENT,
): Rect {
  const width = naturalWidth > 0 ? naturalWidth : 1;
  const height = naturalHeight > 0 ? naturalHeight : 1;
  const scale = Math.min(1, max / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2), width: w, height: h };
}

/** Natural size of a decoded bitmap, when the caller knows it. */
export interface ImageSize {
  width: number;
  height: number;
}

/** The natural-size fields a paint carries, when the decoded size is known. */
function naturalSizeFields(size?: ImageSize): Pick<ImagePaint, 'naturalWidth' | 'naturalHeight'> {
  return size && size.width > 0 && size.height > 0
    ? { naturalWidth: Math.round(size.width), naturalHeight: Math.round(size.height) }
    : {};
}

export function imagePaint(
  dataUrl: string,
  scaleMode: ImagePaint['scaleMode'] = 'FILL',
  size?: ImageSize,
): ImagePaint {
  return {
    type: 'IMAGE',
    dataUrl,
    scaleMode,
    opacity: 1,
    // Recorded so TILE can repeat the bitmap at its own size.
    ...naturalSizeFields(size),
  };
}

/** Give every listed node an image fill (Figma's "use as fill"). */
export function withImageFill(
  file: PigmaFile,
  ids: Iterable<string>,
  dataUrl: string,
  scaleMode: ImagePaint['scaleMode'] = 'FILL',
  size?: ImageSize,
): PigmaFile {
  return applyNodePatchToAll(file, ids, { fills: [imagePaint(dataUrl, scaleMode, size)] } as NodePatch);
}

/**
 * Create an image node in `parentId` at `box`. The node is a plain RECTANGLE
 * with an IMAGE fill so every existing tool (resize, rotate, opacity, effects,
 * export) keeps working on it.
 */
export function placeImage(
  file: PigmaFile,
  parentId: string,
  dataUrl: string,
  box: Rect,
  scaleMode: ImagePaint['scaleMode'] = 'FILL',
  size?: ImageSize,
): { file: PigmaFile; node: SceneNode } {
  const node = createRectNode(file.document, box.x, box.y, box.width, box.height);
  node.name = 'Image';
  node.fills = [imagePaint(dataUrl, scaleMode, size)];
  node.cornerRadius = 0;
  const document = insertChild(file.document, parentId, node);
  return { file: { ...file, document }, node };
}

/** True when the node paints an image anywhere in its fills. */
export function hasImageFill(node: AnyNode): boolean {
  return node.type !== 'DOCUMENT' && node.type !== 'CANVAS' && node.fills.some((paint) => paint.type === 'IMAGE');
}

export function imageDataUrlOf(node: AnyNode): string | null {
  if (node.type === 'DOCUMENT' || node.type === 'CANVAS') return null;
  for (const paint of node.fills) {
    if (paint.type === 'IMAGE' && paint.dataUrl) return paint.dataUrl;
  }
  return null;
}

/** Replace the image bytes of an existing image node, keeping its box. */
export function replaceImage(file: PigmaFile, id: string, dataUrl: string, size?: ImageSize): PigmaFile {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return file;
  const fills = node.fills.map((paint) =>
    paint.type === 'IMAGE'
      ? {
          ...paint,
          dataUrl,
          // A replacement bitmap has its own size, and TILE repeats at it.
          ...naturalSizeFields(size),
        }
      : paint,
  );
  if (fills.every((paint, index) => paint === node.fills[index])) return file;
  return {
    ...file,
    document: updateNode(file.document, id, (target) => ({ ...target, fills }) as SceneNode),
  };
}

/**
 * Image editing (M2).
 *
 * `scaleMode` decides how the bitmap meets the box, and for CROP a transform in
 * unit space (Figma's `imageTransform`) says which part of the image shows. The
 * panel edits scale/offset and this module turns them into that matrix, so the
 * renderer, the PDF and the tests share one definition.
 */

export interface ImageCrop {
  /** 1 = the image exactly covers the box; larger crops in. */
  scale: number;
  /** Offset of the image inside the box, in fractions of the box (-0.5 … 0.5). */
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_CROP: ImageCrop = { scale: 1, offsetX: 0, offsetY: 0 };

/** Read the crop controls back out of an image paint. */
export function cropOf(paint: ImagePaint): ImageCrop {
  const transform = paint.imageTransform;
  if (!transform) return { ...DEFAULT_CROP };
  const [[a, , tx], [, , ty]] = transform;
  const scale = a > 0 ? 1 / a : 1;
  return {
    scale: roundTo(scale, 3),
    // Inverse of `cropTransform`: tx = 0.5 - offsetX * a, so offsetX = (0.5 - tx) * scale.
    offsetX: roundTo((0.5 - tx) * scale, 3),
    offsetY: roundTo((0.5 - ty) * scale, 3),
  };
}

/** Unit-space matrix for a crop: the image is scaled about the box centre. */
export function cropTransform(crop: ImageCrop): TransformMatrix {
  const scale = crop.scale > 0 ? crop.scale : 1;
  const a = 1 / scale;
  const tx = 0.5 - crop.offsetX * a;
  const ty = 0.5 - crop.offsetY * a;
  return [
    [a, 0, tx],
    [0, a, ty],
  ];
}

/** Set the scale mode of every image fill on the given nodes. */
export function setImageScaleMode(file: PigmaFile, ids: Iterable<string>, mode: NonNullable<ImagePaint['scaleMode']>): PigmaFile {
  let next = file;
  for (const id of ids) {
    next = updateImagePaint(next, id, (paint) => ({
      ...paint,
      scaleMode: mode,
      // CROP needs a transform; leaving CROP keeps whatever the user set.
      ...(mode === 'CROP' ? { imageTransform: paint.imageTransform ?? cropTransform(DEFAULT_CROP) } : {}),
    }));
  }
  return next;
}

/** Edit the crop of every image fill on the given nodes (switches to CROP). */
export function setImageCrop(file: PigmaFile, ids: Iterable<string>, crop: ImageCrop): PigmaFile {
  let next = file;
  for (const id of ids) {
    next = updateImagePaint(next, id, (paint) => ({
      ...paint,
      scaleMode: 'CROP',
      imageTransform: cropTransform(crop),
    }));
  }
  return next;
}

function updateImagePaint(file: PigmaFile, id: string, update: (paint: ImagePaint) => ImagePaint): PigmaFile {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return file;
  if (!node.fills.some((paint) => paint.type === 'IMAGE')) return file;
  const fills = node.fills.map((paint) => (paint.type === 'IMAGE' ? update(paint) : paint));
  return { ...file, document: updateNode(file.document, id, (target) => ({ ...target, fills }) as typeof target) };
}

/** Image fills of a node, with the index needed to address one. */
export function imageFillsOf(node: AnyNode): Array<{ index: number; paint: ImagePaint }> {
  if (node.type === 'DOCUMENT' || node.type === 'CANVAS') return [];
  return node.fills
    .map((paint, index) => ({ index, paint }))
    .filter((entry): entry is { index: number; paint: ImagePaint } => entry.paint.type === 'IMAGE');
}
