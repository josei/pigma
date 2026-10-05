import { describe, expect, it } from 'vitest';
import { isPdf, renderVectorPdf } from './pdfVector';
import { parsePathData, pathToPdf } from './pdfPath';
import { emptyFile } from '../model/validate';
import { createEllipseNode, createFrameNode, createRectNode, createStarNode, createTextNode } from '../model/factory';
import { booleanNodes } from '../model/boolean';
import { syncTextSizes } from '../model/textSync';
import type { Paint, SceneNode } from '../model/types';

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function page(nodes: SceneNode[]) {
  const file = emptyFile('Pdf');
  const canvas = file.document.children[0]!;
  canvas.children = nodes;
  const sized = syncTextSizes(file);
  return { file: sized, nodes: (sized.document.children[0]!.children as SceneNode[]) };
}

describe('SVG path to PDF operators', () => {
  it('maps lines, curves and closes', () => {
    expect(pathToPdf('M 0 0 L 10 0 Z')).toBe('0 0 m\n10 0 l\nh');
    expect(pathToPdf('M 0 0 H 10 V 5 L 2 3 Z')).toBe('0 0 m\n10 0 l\n10 5 l\n2 3 l\nh');
    expect(pathToPdf('M 1 1 C 2 2 3 3 4 4')).toBe('1 1 m\n2 2 3 3 4 4 c');
    // Quadratics are elevated to cubics.
    expect(pathToPdf('M 0 0 Q 0 10 10 10')).toBe('0 0 m\n0 6.667 3.333 10 10 10 c');
  });

  it('converts arcs to cubics that end on the arc endpoint', () => {
    const operators = pathToPdf('M 0 5 A 5 5 0 1 0 10 5');
    expect(operators).toContain(' m');
    expect(operators.split('\n').filter((line) => line.endsWith('c'))).toHaveLength(2);
    const last = operators.split('\n').filter((line) => line.endsWith('c')).pop()!;
    const numbers = last.replace('c', '').trim().split(/\s+/).map(Number);
    expect(numbers[4]).toBeCloseTo(10, 2);
    expect(numbers[5]).toBeCloseTo(5, 2);
  });

  it('handles implicit repeats and relative commands', () => {
    const tokens = parsePathData('M 0 0 10 0 10 10');
    expect(tokens.map((token) => token.command)).toEqual(['M', 'L', 'L']);
    expect(pathToPdf('m 5 5 l 5 0')).toBe('5 5 m\n10 5 l');
  });

  it('parses scientific notation and negative values', () => {
    const tokens = parsePathData('M1e2 -3.5L.5 .25');
    expect(tokens[0]!.values).toEqual([100, -3.5]);
    expect(tokens[1]!.values).toEqual([0.5, 0.25]);
  });
});

describe('vector PDF', () => {
  const solid = (r: number, g: number, b: number): Paint => ({ type: 'SOLID', color: { r, g, b } });

  it('writes a well-formed PDF with vector paths, not an image', () => {
    const rect = createRectNode(null, 10, 10, 100, 50);
    rect.fills = [solid(1, 0, 0)];
    const { file, nodes } = page([rect]);
    const { bytes, warnings } = renderVectorPdf(file, nodes, { width: 200, height: 100, title: 'Pigma' });

    expect(isPdf(bytes)).toBe(true);
    const text = decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/MediaBox [0 0 200 100]');
    expect(text).toContain('/Title (Pigma)');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // Path operators (the rect is drawn in local space, placed by `cm`).
    expect(text).toContain('1 0 0 1 10 10 cm');
    expect(text).toContain('0 0 m');
    expect(text).toContain('100 0 l');
    expect(text).toContain('1 0 0 rg');
    expect(text).toContain('\nf\n');
    expect(text).not.toContain('/DCTDecode');
    expect(text).not.toContain('/Subtype /Image');
    expect(warnings).toEqual([]);
  });

  it('writes text as a real text object with a base-14 font', () => {
    const text = createTextNode(null, 0, 0, 'Hello PDF');
    const { file, nodes } = page([text]);
    const { bytes, warnings } = renderVectorPdf(file, nodes, { width: 200, height: 60 });
    const body = decode(bytes);
    expect(body).toContain('BT');
    expect(body).toMatch(/\/F1 \d+(\.\d+)? Tf/);
    expect(body).toContain('(Hello PDF) Tj');
    expect(body).toContain('/BaseFont /Helvetica');
    expect(body).toContain('ET');
    // The default font family is not Helvetica, so the fallback is reported.
    expect(warnings.some((warning) => warning.includes('Helvetica'))).toBe(true);
  });

  it('emits strokes with weight, dash pattern and joins', () => {
    const rect = createRectNode(null, 0, 0, 40, 40);
    rect.fills = [];
    rect.strokes = [solid(0, 0, 1)];
    rect.strokeWeight = 4;
    rect.dashPattern = [8, 4];
    rect.strokeCap = 'ROUND';
    const { file, nodes } = page([rect]);
    const body = decode(renderVectorPdf(file, nodes, { width: 40, height: 40 }).bytes);
    expect(body).toContain('4 w');
    expect(body).toContain('1 J');
    expect(body).toContain('[32 16] 0 d');
    expect(body).toContain('0 0 1 RG');
  });

  it('renders ellipses, stars and boolean geometry as paths', () => {
    const ellipse = createEllipseNode(null, 0, 0, 60, 40);
    ellipse.fills = [solid(0, 1, 0)];
    const star = createStarNode(null, 80, 0, 40, 40);
    star.fills = [solid(0, 0, 1)];
    const { file, nodes } = page([ellipse, star]);
    const body = decode(renderVectorPdf(file, nodes, { width: 140, height: 60 }).bytes);
    // Ellipses arrive as arcs and are converted to cubic curves.
    // An ellipse is four cubic segments, so at least four curves plus the star.
    expect(body.split('\n').filter((line) => line.endsWith('c')).length).toBeGreaterThanOrEqual(4);
    expect(body).toContain('f');
    expect(body).not.toContain('/Subtype /Image');
  });

  it('emits a shading for linear gradients and warns about bitmaps', () => {
    const gradient = createRectNode(null, 0, 0, 100, 100);
    gradient.fills = [
      {
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0 } },
          { position: 1, color: { r: 0, g: 0, b: 1 } },
        ],
      },
    ];
    const image = createRectNode(null, 0, 120, 50, 50);
    image.fills = [{ type: 'IMAGE', dataUrl: 'data:image/png;base64,AAAA', scaleMode: 'FILL' }];
    const { file, nodes } = page([gradient, image]);
    const { bytes, warnings } = renderVectorPdf(file, nodes, { width: 120, height: 200 });
    const body = decode(bytes);
    expect(body).toContain('/ShadingType 2');
    expect(body).toContain('/Sh1 sh');
    expect(body).toContain('/Shading << /Sh1');
    expect(warnings.some((warning) => warning.includes('Bitmap'))).toBe(true);
    expect(body).not.toContain('/Subtype /Image');
  });

  it('reports effects instead of dropping them silently', () => {
    const rect = createRectNode(null, 0, 0, 20, 20);
    rect.effects = [
      { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.4 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, visible: true },
    ];
    const { file, nodes } = page([rect]);
    const { warnings } = renderVectorPdf(file, nodes, { width: 20, height: 20 });
    expect(warnings.some((warning) => warning.includes('Shadows'))).toBe(true);
  });

  it('reports an unsupported paint instead of crashing on it', () => {
    // `UnsupportedPaint` (VIDEO, PATTERN) carries no `gradientStops`, and it used
    // to fall through to the gradient fallback and read them off undefined —
    // throwing out of the whole export. Inexpressible content is reported.
    const video = createRectNode(null, 0, 0, 40, 30);
    video.fills = [{ type: 'VIDEO' } as unknown as Paint];
    const { file, nodes } = page([video]);
    const { bytes, warnings } = renderVectorPdf(file, nodes, { width: 40, height: 30 });
    expect(isPdf(bytes)).toBe(true);
    expect(warnings.some((warning) => warning.includes('VIDEO fills'))).toBe(true);
  });

  it('applies node transforms and nested frames', () => {
    const frame = createFrameNode(null, 50, 20, 100, 100, { name: 'Frame' });
    const child = createRectNode(null, 10, 10, 30, 30);
    child.fills = [solid(1, 1, 1)];
    frame.children = [child];
    const { file, nodes } = page([frame]);
    const body = decode(renderVectorPdf(file, nodes, { width: 200, height: 200 }).bytes);
    // The child's matrix is the frame's translate composed with its own offset.
    expect(body).toContain('1 0 0 1 60 30 cm');
    expect(body).toContain('30 0 l');
  });

  it('paints boolean operations with the even-odd rule', () => {
    const file = emptyFile('Boolean');
    const canvas = file.document.children[0]!;
    const a = createRectNode(null, 0, 0, 60, 60);
    const b = createRectNode(null, 30, 30, 60, 60);
    canvas.children = [a, b];
    const result = booleanNodes(file, [a.id, b.id], 'EXCLUDE');
    const node = result.file.document.children[0]!.children[0] as SceneNode;
    const body = decode(renderVectorPdf(result.file, [node], { width: 90, height: 90 }).bytes);
    expect(body).toContain('f*');
  });

  it('paints a background when one is requested, from hex or rgb()', () => {
    const rect = createRectNode(null, 0, 0, 10, 10);
    const { file, nodes } = page([rect]);
    expect(decode(renderVectorPdf(file, nodes, { width: 10, height: 10, background: '#ffffff' }).bytes)).toContain(
      '1 1 1 rg 0 0 10 10 re f',
    );
    expect(decode(renderVectorPdf(file, nodes, { width: 10, height: 10, background: 'rgb(255, 128, 0)' }).bytes)).toContain(
      '1 0.502 0 rg 0 0 10 10 re f',
    );
  });

  it('writes an xref table whose offsets point at the objects', () => {
    const rect = createRectNode(null, 0, 0, 10, 10);
    const { file, nodes } = page([rect]);
    const text = decode(renderVectorPdf(file, nodes, { width: 10, height: 10 }).bytes);
    const bytes = renderVectorPdf(file, nodes, { width: 10, height: 10 }).bytes;
    const xref = text.indexOf('\nxref\n') + 1;
    expect(xref).toBeGreaterThan(0);
    const lines = text.slice(xref).split('\n');
    const count = Number(lines[1]!.split(' ')[1]);
    expect(count).toBeGreaterThan(4);
    for (let index = 1; index < count; index += 1) {
      // lines[0] = 'xref', lines[1] = '0 N', lines[2] = the free entry.
      const offset = Number(lines[index + 2]!.slice(0, 10));
      expect(offset).toBeGreaterThan(0);
      // Offsets are byte positions, so compare against the bytes, not the string.
      expect(new TextDecoder().decode(bytes.slice(offset, offset + 12))).toMatch(new RegExp(`^${index} 0 obj`));
    }
  });
});

describe('text depth in the vector PDF', () => {
  function textNode(patch: Partial<import('../model/types').TextStyle>, characters = 'Hello') {
    const file = emptyFile('Text');
    const canvas = file.document.children[0]!;
    const text = createTextNode(null, 0, 0, characters);
    text.style = { ...text.style, ...patch };
    text.width = 200;
    canvas.children = [text];
    const sized = syncTextSizes(file);
    return { file: sized, nodes: sized.document.children[0]!.children as SceneNode[] };
  }
  const body = (patch: Partial<import('../model/types').TextStyle>) => {
    const { file, nodes } = textNode(patch);
    return decode(renderVectorPdf(file, nodes, { width: 200, height: 60 }).bytes);
  };

  it('applies letter spacing as character spacing', () => {
    expect(body({ letterSpacing: { unit: 'PIXELS', value: 4 } })).toContain('4 Tc');
    expect(body({ letterSpacing: { unit: 'PERCENT', value: 50 }, fontSize: 20 })).toContain('10 Tc');
    expect(body({})).toContain('0 Tc');
  });

  it('renders text case in the emitted string', () => {
    expect(body({ textCase: 'UPPER' })).toContain('(HELLO) Tj');
    expect(body({ textCase: 'LOWER' })).toContain('(hello) Tj');
  });

  it('draws underline and strikethrough rules', () => {
    expect(body({ textDecoration: 'UNDERLINE' })).toMatch(/-?[\d.]+ -?[\d.]+ m -?[\d.]+ -?[\d.]+ l S/);
    expect(body({ textDecoration: 'NONE' })).not.toMatch(/m -?[\d.]+ -?[\d.]+ l S/);
  });

  it('uses the bold and italic base-14 faces', () => {
    expect(body({ fontWeight: 700 })).toContain('/F2 ');
    expect(body({ fontStyle: 'italic' })).toContain('/F3 ');
    expect(body({ fontWeight: 400, fontStyle: 'normal' })).toContain('/F1 ');
  });

  it('wraps HEIGHT text and truncates TRUNCATE text', () => {
    const wrapped = decode(
      renderVectorPdf(...(() => { const r = textNode({ textAutoResize: 'HEIGHT' }, 'one two three four five six seven eight'); return [r.file, r.nodes] as const; })(), { width: 60, height: 200 }).bytes,
    );
    expect((wrapped.match(/\) Tj/g) ?? []).length).toBeGreaterThan(1);
    const truncated = decode(
      renderVectorPdf(...(() => { const r = textNode({ textAutoResize: 'TRUNCATE' }, 'one two three four five six seven eight'); return [r.file, r.nodes] as const; })(), { width: 60, height: 200 }).bytes,
    );
    expect((truncated.match(/\) Tj/g) ?? []).length).toBe(1);
    // The ellipsis is written as its WinAnsi escape, so the PDF stays 7-bit clean.
    expect(truncated).toContain('\\205');
  });
});
