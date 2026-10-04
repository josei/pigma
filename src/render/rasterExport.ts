import { renderVectorPdf } from './pdfVector';
import type { PigmaFile, SceneNode } from '../model/types';
import { findNode } from '../model/tree';

/**
 * Raster export.
 *
 * The scene is already a single self-contained SVG string (the canvas and the
 * exporter share one renderer), so PNG export rasterizes that exact markup
 * through an <img>, which keeps shapes, gradients, filters, clipping and text
 * identical to what is on screen.
 *
 * Two extras make the raster faithful:
 *  - webfonts are inlined as base64 so text does not fall back to a generic
 *    sans-serif inside the image context;
 *  - background blur (a compositing effect SVG cannot express) is applied to the
 *    raster afterwards by blurring the backdrop region behind each such node.
 */

export interface BackgroundBlurRegion {
  /** Region in the exported SVG's coordinate space (the viewBox origin is 0,0). */
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  cornerRadius: number;
}

export interface RasterOptions {
  /** Embed the webfont in the SVG before rasterizing (default true). */
  embedFont?: boolean;
  svg: string;
  /** ViewBox the SVG was rendered with. */
  viewBox: { x: number; y: number; width: number; height: number };
  scale: number;
  background?: string;
  backgroundBlurs?: BackgroundBlurRegion[];
}

let fontCssCache: Promise<string> | null = null;

/**
 * Fetch the app's webfont once and inline it, so rasterized text keeps the same
 * metrics as the canvas. Best effort: on failure the SVG still rasterizes.
 */
/** The webfont fetch must never hold an export hostage. */
const FONT_FETCH_TIMEOUT_MS = 400;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function inlinedFontCss(): Promise<string> {
  if (fontCssCache) return fontCssCache;
  fontCssCache = (async () => {
    const cssUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap';
    const css = await fetch(cssUrl).then((response) => response.text());
    const urls = [...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map((match) => match[1] as string);
    if (urls.length === 0) return '';
    const font = urls[0] as string;
    const bytes = new Uint8Array(await (await fetch(font)).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2');}`;
  })().catch(() => '');
  return fontCssCache;
}

function withEmbeddedFont(svg: string, fontCss: string): string {
  if (!fontCss) return svg;
  const style = `<style>${fontCss}</style>`;
  const openTagEnd = svg.indexOf('>', svg.indexOf('<svg'));
  if (openTagEnd < 0) return svg;
  return `${svg.slice(0, openTagEnd + 1)}${style}${svg.slice(openTagEnd + 1)}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Could not rasterize the scene'));
  image.src = url;
  return promise;
}

/** Rasterize an SVG string into a canvas at `scale`. */
export async function rasterizeScene(options: RasterOptions): Promise<HTMLCanvasElement> {
  const { svg, viewBox, scale } = options;
  const width = Math.max(1, Math.round(viewBox.width * scale));
  const height = Math.max(1, Math.round(viewBox.height * scale));

  // A slow or blocked font CDN must not delay the export: fall back to the
  // system stack after a short budget (the SVG already names a font family).
  const fontCss = options.embedFont === false ? '' : await withTimeout(inlinedFontCss(), FONT_FETCH_TIMEOUT_MS, '');
  const markup = withEmbeddedFont(svg, fontCss);
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  let image: HTMLImageElement;
  try {
    image = await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');

  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(image, 0, 0, width, height);

  // Background blur: blur the already-rendered backdrop inside each region.
  for (const region of options.backgroundBlurs ?? []) {
    if (region.radius <= 0) continue;
    const x = Math.round((region.x - viewBox.x) * scale);
    const y = Math.round((region.y - viewBox.y) * scale);
    const w = Math.round(region.width * scale);
    const h = Math.round(region.height * scale);
    if (w <= 0 || h <= 0) continue;
    const region_ = document.createElement('canvas');
    region_.width = Math.max(1, w);
    region_.height = Math.max(1, h);
    const regionCtx = region_.getContext('2d');
    if (!regionCtx) continue;
    regionCtx.filter = `blur(${region.radius * scale}px)`;
    regionCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    regionCtx.filter = 'none';

    ctx.save();
    const radius = region.cornerRadius * scale;
    if (radius > 0) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.clip();
    } else {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
    }
    ctx.drawImage(region_, x, y);
    ctx.restore();
  }

  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))),
    type,
    quality,
  );
  return promise;
}

/** PNG bytes for the scene at the requested scale. */
export async function renderScenePng(options: RasterOptions): Promise<Blob> {
  const canvas = await rasterizeScene(options);
  return canvasToBlob(canvas, 'image/png');
}

/**
 * Vector PDF: paths and text are written as PDF operators (no raster page).
 *
 * Returns the blob plus everything the format could not express, so the UI can
 * report approximations instead of hiding them.
 */
export function renderSceneVectorPdf(
  file: PigmaFile,
  nodeIds: string[],
  options: { viewBox: { x: number; y: number; width: number; height: number }; title?: string; background?: string },
): { blob: Blob; warnings: string[] } {
  const nodes = nodeIds
    .map((id) => findNode(file.document, id))
    .filter((node): node is SceneNode => !!node && node.type !== 'DOCUMENT' && node.type !== 'CANVAS');
  const result = renderVectorPdf(file, nodes, {
    width: options.viewBox.width,
    height: options.viewBox.height,
    offsetX: options.viewBox.x,
    offsetY: options.viewBox.y,
    ...(options.title ? { title: options.title } : {}),
    ...(options.background ? { background: options.background } : {}),
  });
  return { blob: new Blob([result.bytes.buffer as ArrayBuffer], { type: 'application/pdf' }), warnings: result.warnings };
}
