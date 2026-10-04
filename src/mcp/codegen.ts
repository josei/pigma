/**
 * Design-to-code generation for `get_design_context`.
 *
 * Produces React + Tailwind by default (Figma's default output), with plain
 * HTML + CSS as an alternative. The generator emits a faithful static
 * representation of the Pigma model — absolute geometry, paints, strokes,
 * effects, corner radii, and text styling — not Figma's exact code, which also
 * performs component/Code Connect substitution.
 */
import type { ColorStop, Paint, PigmaFile, SceneNode, TextStyle } from '../model/types';
import { hasChildren } from '../model/types';
import { roundTo as round } from '../model/matrix';

export type CodeFramework = 'react' | 'html';
export type CodeStyling = 'tailwind' | 'css';

export interface CodegenOptions {
  framework?: CodeFramework;
  styling?: CodeStyling;
}

export interface GeneratedCode {
  framework: CodeFramework;
  styling: CodeStyling;
  language: 'tsx' | 'html';
  componentName: string;
  code: string;
}

function hex(color: { r: number; g: number; b: number }): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function gradientStopsOf(paint: Paint): ColorStop[] | null {
  const value = (paint as { gradientStops?: unknown }).gradientStops;
  return Array.isArray(value) ? (value as ColorStop[]) : null;
}

function gradientCss(type: string, stops: ColorStop[]): string {
  const rendered = [...stops]
    .sort((a, b) => a.position - b.position)
    .map((stop) => `${hex(stop.color)} ${Math.round(stop.position * 100)}%`)
    .join(', ');
  const kind = type === 'GRADIENT_LINEAR' ? 'linear' : type === 'GRADIENT_RADIAL' ? 'radial' : 'linear';
  return `${kind}-gradient(${rendered})`;
}

function visiblePaint(paints: Paint[]): Paint | undefined {
  return paints.find((paint) => paint.visible !== false && (paint.opacity ?? 1) > 0);
}

interface StyleChunks {
  className: string[];
  css: string[];
}

function addFill(paint: Paint | undefined, style: StyleChunks): void {
  if (!paint) return;
  if (paint.type === 'SOLID') {
    style.className.push(`bg-[${hex(paint.color)}]`);
    style.css.push(`background: ${hex(paint.color)}`);
    return;
  }
  const stops = gradientStopsOf(paint);
  if (stops) {
    const gradient = gradientCss(paint.type, stops);
    style.className.push(`bg-[${gradient.replace(/\s+/g, '_')}]`);
    style.css.push(`background: ${gradient}`);
    return;
  }
  if (paint.type === 'IMAGE' && paint.dataUrl) {
    style.className.push(`bg-[url('${paint.dataUrl}')] bg-cover`);
    style.css.push(`background: url('${paint.dataUrl}') center / cover`);
  }
}

function addTextStyle(style: TextStyle, paint: Paint | undefined, out: StyleChunks): void {
  out.className.push(`text-[${round(style.fontSize)}px]`);
  out.css.push(`font-size: ${round(style.fontSize)}px`);
  if (paint?.type === 'SOLID') {
    out.className.push(`text-[${hex(paint.color)}]`);
    out.css.push(`color: ${hex(paint.color)}`);
  }
  const weight = style.fontWeight;
  if (weight !== undefined && weight >= 600) {
    out.className.push(weight >= 700 ? 'font-bold' : 'font-semibold');
    out.css.push(`font-weight: ${weight}`);
  }
  if (style.fontStyle && /italic/i.test(style.fontStyle)) {
    out.className.push('italic');
    out.css.push('font-style: italic');
  }
  if (style.lineHeight?.unit === 'PIXELS' && style.lineHeight.value !== undefined) {
    out.className.push(`leading-[${round(style.lineHeight.value)}px]`);
    out.css.push(`line-height: ${round(style.lineHeight.value)}px`);
  }
  if (style.letterSpacing?.value) {
    out.className.push(`tracking-[${round(style.letterSpacing.value)}px]`);
    out.css.push(`letter-spacing: ${round(style.letterSpacing.value)}px`);
  }
  if (style.textAlignHorizontal) {
    out.className.push({ LEFT: 'text-left', CENTER: 'text-center', RIGHT: 'text-right', JUSTIFIED: 'text-justify' }[style.textAlignHorizontal]);
    out.css.push(`text-align: ${style.textAlignHorizontal.toLowerCase()}`);
  }
  if (style.textCase === 'UPPER') {
    out.className.push('uppercase');
    out.css.push('text-transform: uppercase');
  } else if (style.textCase === 'LOWER') {
    out.className.push('lowercase');
    out.css.push('text-transform: lowercase');
  }
  if (style.textDecoration === 'UNDERLINE') {
    out.className.push('underline');
    out.css.push('text-decoration: underline');
  }
}

function styleChunks(node: SceneNode, isText: boolean): StyleChunks {
  const style: StyleChunks = { className: ['absolute'], css: ['position: absolute'] };
  style.className.push(`left-[${round(node.transform.tx)}px]`, `top-[${round(node.transform.ty)}px]`);
  style.css.push(`left: ${round(node.transform.tx)}px`, `top: ${round(node.transform.ty)}px`);
  if (node.width > 0 && !isText) {
    style.className.push(`w-[${round(node.width)}px]`);
    style.css.push(`width: ${round(node.width)}px`);
  }
  if (node.height > 0) {
    style.className.push(`h-[${round(node.height)}px]`);
    style.css.push(`height: ${round(node.height)}px`);
  }
  if (node.opacity !== 1) {
    style.className.push(`opacity-[${round(node.opacity)}]`);
    style.css.push(`opacity: ${round(node.opacity)}`);
  }
  const paint = visiblePaint(node.fills);
  if (isText) addTextStyle((node as SceneNode & { style: TextStyle }).style, paint, style);
  else addFill(paint, style);

  const shape = node as SceneNode & { cornerRadius?: number; rectangleCornerRadii?: [number, number, number, number] };
  if (shape.cornerRadius) {
    style.className.push(`rounded-[${round(shape.cornerRadius)}px]`);
    style.css.push(`border-radius: ${round(shape.cornerRadius)}px`);
  }
  const stroke = visiblePaint(node.strokes);
  if (stroke && stroke.type === 'SOLID' && (node.strokeWeight ?? 0) > 0) {
    style.className.push(`border-[${round(node.strokeWeight as number)}px]`, `border-[${hex(stroke.color)}]`);
    style.css.push(`border: ${round(node.strokeWeight as number)}px solid ${hex(stroke.color)}`);
  }
  const rotated = Math.abs(node.transform.b) > 1e-6 || Math.abs(node.transform.c) > 1e-6;
  if (rotated) {
    const matrix = `matrix(${round(node.transform.a)}, ${round(node.transform.b)}, ${round(node.transform.c)}, ${round(node.transform.d)}, 0, 0)`;
    style.css.push(`transform: ${matrix}`, 'transform-origin: top left');
  }
  return style;
}

function escapeText(value: string): string {
  return value.replace(/[{}]/g, (match) => `{'${match}'}`).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function componentNameFor(file: PigmaFile, nodes: SceneNode[]): string {
  const source = nodes[0]?.name ?? file.name;
  const cleaned = source.replace(/[^A-Za-z0-9]+(.)?/g, (_match, chr: string) => (chr ? chr.toUpperCase() : '')).replace(/^[^A-Za-z]+/, '');
  return cleaned.length > 0 ? `${cleaned[0]?.toUpperCase() ?? ''}${cleaned.slice(1)}` : 'Design';
}

interface Emitter {
  framework: CodeFramework;
  styling: CodeStyling;
  indent: number;
}

function classNameAttribute(style: StyleChunks, emitter: Emitter): string {
  if (emitter.styling === 'tailwind') return ` className="${style.className.join(' ')}"`;
  return ` style="${style.css.join('; ')}"`;
}

function reactStyleAttribute(style: StyleChunks, emitter: Emitter): string {
  if (emitter.styling === 'tailwind') return ` className="${style.className.join(' ')}"`;
  const entries = style.css
    .map((declaration) => {
      const index = declaration.indexOf(':');
      const key = declaration.slice(0, index).trim().replace(/-([a-z])/g, (_m, chr: string) => chr.toUpperCase());
      return `${key}: '${declaration.slice(index + 1).trim().replace(/'/g, "\\'")}'`;
    })
    .join(', ');
  return ` style={{ ${entries} }}`;
}

function emitReact(node: SceneNode, emitter: Emitter): string {
  const pad = '  '.repeat(emitter.indent);
  const isText = node.type === 'TEXT';
  const style = styleChunks(node, isText);
  const attributes = reactStyleAttribute(style, emitter);
  if (isText) {
    const text = (node as SceneNode & { characters: string }).characters;
    return `${pad}<div${attributes}>\n${pad}  ${escapeText(text)}\n${pad}</div>`;
  }
  if (hasChildren(node)) {
    const children = node.children.map((child) => emitReact(child, { ...emitter, indent: emitter.indent + 1 })).join('\n');
    return `${pad}<div${attributes}>\n${children}\n${pad}</div>`;
  }
  return `${pad}<div${attributes} />`;
}

function emitHtml(node: SceneNode, emitter: Emitter): string {
  const pad = '  '.repeat(emitter.indent);
  const isText = node.type === 'TEXT';
  const style = styleChunks(node, isText);
  const attributes = classNameAttribute(style, emitter);
  if (isText) {
    return `${pad}<div${attributes}>${escapeHtml((node as SceneNode & { characters: string }).characters)}</div>`;
  }
  if (hasChildren(node)) {
    const children = node.children.map((child) => emitHtml(child, { ...emitter, indent: emitter.indent + 1 })).join('\n');
    return `${pad}<div${attributes}>\n${children}\n${pad}</div>`;
  }
  return `${pad}<div${attributes}></div>`;
}

/** Generate framework code for a set of root nodes. */
export function generateDesignCode(file: PigmaFile, nodes: SceneNode[], options: CodegenOptions = {}): GeneratedCode {
  const framework = options.framework ?? 'react';
  const styling = options.styling ?? 'tailwind';
  const componentName = componentNameFor(file, nodes);
  const emitter: Emitter = { framework, styling, indent: framework === 'react' ? 2 : 1 };

  if (framework === 'react') {
    const body = nodes.map((node) => emitReact(node, emitter)).join('\n');
    const code = `export function ${componentName}() {\n  return (\n    <div className="relative w-[${round(nodes[0]?.width ?? 0)}px] h-[${round(nodes[0]?.height ?? 0)}px]">\n${body}\n    </div>\n  );\n}\n`;
    return { framework, styling, language: 'tsx', componentName, code };
  }

  const body = nodes.map((node) => emitHtml(node, emitter)).join('\n');
  const wrapperStyle =
    styling === 'tailwind'
      ? ` class="relative w-[${round(nodes[0]?.width ?? 0)}px] h-[${round(nodes[0]?.height ?? 0)}px]"`
      : ` style="position: relative; width: ${round(nodes[0]?.width ?? 0)}px; height: ${round(nodes[0]?.height ?? 0)}px"`;
  const code = `<div${wrapperStyle}>\n${body}\n</div>\n`;
  return { framework, styling, language: 'html', componentName, code };
}
