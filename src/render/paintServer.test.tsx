import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SceneSvg } from './SceneRenderer';
import { resolvePaint, needsPaintServerDef, rasterGradient } from './paintRender';
import { createFrameNode, createRectNode } from '../model/factory';
import { emptyFile } from '../model/validate';
import type { ImagePaint, Paint, PigmaFile, SceneNode } from '../model/types';
import { cropTransform } from '../model/image';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';

function imageFill(scaleMode: ImagePaint['scaleMode'] = 'FILL'): ImagePaint {
  return { type: 'IMAGE', dataUrl: PNG, scaleMode, opacity: 1 };
}

/** Every `url(#id)` reference in the markup must resolve to a def in the markup. */
function danglingRefs(markup: string): string[] {
  const referenced = [...markup.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]!);
  const defined = new Set([...markup.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]!));
  return [...new Set(referenced)].filter((id) => !defined.has(id));
}

/** Defs that nothing references (dead markup). */
function unreferencedDefs(markup: string): string[] {
  const referenced = new Set([...markup.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]!));
  const defined = [...markup.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]!);
  return defined.filter((id) => !referenced.has(id) && !markup.includes(`clip-path="url(#${id})"`));
}

function sceneWith(paint: Paint): { file: PigmaFile; node: SceneNode } {
  const file = emptyFile('Paint');
  const page = file.document.children[0]!;
  const rect = createRectNode(null, 0, 0, 120, 80);
  rect.fills = [paint];
  page.children = [rect];
  return { file, node: rect };
}

describe('paint servers', () => {
  it('references an image fill through its pattern instead of a raw data URL', () => {
    const { file, node } = sceneWith(imageFill());
    const markup = renderToStaticMarkup(
      <SceneSvg file={file} nodes={[node]} viewBox={{ x: 0, y: 0, width: 120, height: 80 }} width={120} height={80} />,
    );
    expect(markup).not.toContain(`fill="url(${PNG})"`);
    expect(markup).toMatch(/fill="url\(#pigma-fill-[^"]+\)"/);
    expect(markup).toContain('<pattern');
    expect(markup).toContain(`<image href="${PNG}"`);
    expect(danglingRefs(markup)).toEqual([]);
    expect(unreferencedDefs(markup)).toEqual([]);
  });

  it('honours the image scale mode in preserveAspectRatio', () => {
    for (const [mode, expected] of [
      ['FILL', 'xMidYMid slice'],
      ['CROP', 'xMidYMid slice'],
      ['FIT', 'xMidYMid meet'],
    ] as const) {
      const { file, node } = sceneWith(imageFill(mode));
      const markup = renderToStaticMarkup(
        <SceneSvg file={file} nodes={[node]} viewBox={{ x: 0, y: 0, width: 120, height: 80 }} width={120} height={80} />,
      );
      expect(markup).toContain(`preserveAspectRatio="${expected}"`);
    }
  });

  it('paints nothing for an image fill without bytes, and emits no def', () => {
    const { file, node } = sceneWith({ type: 'IMAGE', dataUrl: '', scaleMode: 'FILL', opacity: 1 });
    const markup = renderToStaticMarkup(
      <SceneSvg file={file} nodes={[node]} viewBox={{ x: 0, y: 0, width: 120, height: 80 }} width={120} height={80} />,
    );
    expect(markup).not.toContain('<pattern');
    expect(markup).not.toContain('url(#pigma-fill-');
    expect(danglingRefs(markup)).toEqual([]);
  });

  it('keeps gradient defs referenced and dangling-free', () => {
    const { file, node } = sceneWith({
      type: 'GRADIENT_LINEAR',
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0 } },
        { position: 1, color: { r: 0, g: 0, b: 1 } },
      ],
    });
    const markup = renderToStaticMarkup(
      <SceneSvg file={file} nodes={[node]} viewBox={{ x: 0, y: 0, width: 120, height: 80 }} width={120} height={80} />,
    );
    expect(markup).toContain('<linearGradient');
    expect(danglingRefs(markup)).toEqual([]);
    expect(unreferencedDefs(markup)).toEqual([]);
  });

  it('falls back to a linear ramp for conic gradients without a DOM', () => {
    // No `document` in the Node test environment, so the raster is unavailable.
    expect(rasterGradient({ type: 'GRADIENT_ANGULAR', gradientStops: [] })).toBeNull();
    const { file, node } = sceneWith({
      type: 'GRADIENT_ANGULAR',
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0 } },
        { position: 1, color: { r: 0, g: 1, b: 0 } },
      ],
    });
    const markup = renderToStaticMarkup(
      <SceneSvg file={file} nodes={[node]} viewBox={{ x: 0, y: 0, width: 120, height: 80 }} width={120} height={80} />,
    );
    expect(markup).toContain('<linearGradient');
    expect(danglingRefs(markup)).toEqual([]);
  });

  it('resolves paints to a paint-server reference, never a data URL', () => {
    expect(resolvePaint(imageFill(), 'def-1')).toEqual({ value: 'url(#def-1)', opacity: 1 });
    expect(resolvePaint({ type: 'IMAGE', dataUrl: '', scaleMode: 'FILL' }, 'def-2')).toBeNull();
    expect(resolvePaint({ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }, 'def-3')?.value).toBe('rgb(255, 0, 0)');
    expect(needsPaintServerDef(imageFill())).toBe(true);
    expect(needsPaintServerDef({ type: 'IMAGE', dataUrl: '' })).toBe(false);
    expect(needsPaintServerDef({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } })).toBe(false);
    expect(needsPaintServerDef({ type: 'GRADIENT_RADIAL', gradientStops: [] })).toBe(true);
  });

  it('renders nested image fills inside a frame with a live def', () => {
    const file = emptyFile('Nested');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 200, 200, { name: 'Frame' });
    const rect = createRectNode(null, 10, 10, 100, 100);
    rect.fills = [imageFill('FIT')];
    frame.children = [rect];
    page.children = [frame];
    const markup = renderToStaticMarkup(
      <SceneSvg file={file} nodes={[frame]} viewBox={{ x: 0, y: 0, width: 200, height: 200 }} width={200} height={200} />,
    );
    expect(markup).toContain('<pattern');
    expect(danglingRefs(markup)).toEqual([]);
  });
});

describe('image scale modes', () => {
  function markup(paint: ImagePaint): string {
    const file = emptyFile('Image');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 100, 50);
    rect.fills = [paint];
    page.children = [rect];
    return renderToStaticMarkup(
      <SceneSvg file={file} nodes={[rect]} viewBox={{ x: 0, y: 0, width: 100, height: 50 }} width={100} height={50} />,
    );
  }

  it('maps each scale mode onto the pattern image', () => {
    expect(markup(imageFill('FILL'))).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(markup(imageFill('FIT'))).toContain('preserveAspectRatio="xMidYMid meet"');
    // TILE repeats the bitmap: the pattern is a user-space tile and the image is
    // drawn at the tile's own size, so it is neither covered nor stretched.
    const tile = markup(imageFill('TILE'));
    expect(tile).toContain('patternUnits="userSpaceOnUse"');
    expect(tile).toContain('preserveAspectRatio="none"');
    // No recorded natural size in this fixture, so the tile falls back to the box.
    expect(tile).toContain('width="100" height="50"');
  });

  it('places a cropped image through its transform', () => {
    const cropped: ImagePaint = { ...imageFill('CROP'), imageTransform: cropTransform({ scale: 2, offsetX: 0.25, offsetY: -0.1 }) };
    const html = markup(cropped);
    // 100x50 box at 2x: the bitmap covers 50x25 and is offset by the crop.
    expect(html).toContain('width="50"');
    expect(html).toContain('height="25"');
    expect(html).toContain('preserveAspectRatio="none"');
    expect(html).toMatch(/x="\d+(\.\d+)?"/);
  });

  it('falls back to cover when a crop has no transform', () => {
    const html = markup({ type: 'IMAGE', dataUrl: PNG, scaleMode: 'CROP', opacity: 1 });
    expect(html).toContain('preserveAspectRatio="xMidYMid slice"');
  });
});
