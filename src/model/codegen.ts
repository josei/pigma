import type { Paint, PigmaFile, SceneNode, ShadowEffect } from './types';
import { absoluteBounds, findNode, findParent, parentAndIndex, worldTransform } from './tree';
import { boundsOf, rotationOf, roundTo as round } from './matrix';
import { figmaColorToCss, firstVisibleFill, paintToCssBackground, rgbaToHex } from './paint';

/**
 * Dev-mode style inspection (M14).
 *
 * `measurements` mirrors Figma's inspect panel: absolute position, position
 * relative to the parent, size, rotation, and the gaps to the nearest siblings
 * on each side. `toCss` / `toReact` render the selection as copyable code from
 * the same data, so the panel and the clipboard never disagree.
 */

export interface SiblingGaps {
  left: number | null;
  right: number | null;
  top: number | null;
  bottom: number | null;
}

export interface Measurements {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  relativeX: number;
  relativeY: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  cornerRadius: number;
  parentName: string | null;
  parentWidth: number | null;
  parentHeight: number | null;
  gaps: SiblingGaps;
  fill: string | null;
  stroke: string | null;
  font: string | null;
}

/** Distances from this node's box to the nearest sibling edges on each side. */
export function siblingGaps(file: PigmaFile, id: string): SiblingGaps {
  const info = parentAndIndex(file.document, id);
  if (!info) return { left: null, right: null, top: null, bottom: null };
  const own = absoluteBounds(file.document, id);
  if (!own) return { left: null, right: null, top: null, bottom: null };

  let left: number | null = null;
  let right: number | null = null;
  let top: number | null = null;
  let bottom: number | null = null;

  for (const sibling of info.parent.children as SceneNode[]) {
    if (sibling.id === id) continue;
    const box = absoluteBounds(file.document, sibling.id);
    if (!box) continue;
    // Only consider siblings that overlap on the perpendicular axis.
    const overlapsY = box.y < own.y + own.height && own.y < box.y + box.height;
    const overlapsX = box.x < own.x + own.width && own.x < box.x + box.width;
    if (overlapsY && box.x + box.width <= own.x) {
      const gap = own.x - (box.x + box.width);
      left = left === null ? gap : Math.min(left, gap);
    }
    if (overlapsY && box.x >= own.x + own.width) {
      const gap = box.x - (own.x + own.width);
      right = right === null ? gap : Math.min(right, gap);
    }
    if (overlapsX && box.y + box.height <= own.y) {
      const gap = own.y - (box.y + box.height);
      top = top === null ? gap : Math.min(top, gap);
    }
    if (overlapsX && box.y >= own.y + own.height) {
      const gap = box.y - (own.y + own.height);
      bottom = bottom === null ? gap : Math.min(bottom, gap);
    }
  }
  return {
    left: left === null ? null : round(left),
    right: right === null ? null : round(right),
    top: top === null ? null : round(top),
    bottom: bottom === null ? null : round(bottom),
  };
}

export function measurements(file: PigmaFile, id: string): Measurements | null {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return null;
  const bounds = absoluteBounds(file.document, id);
  if (!bounds) return null;
  const parent = findParent(file.document, id);
  const parentBox = parent ? boundsOf(worldTransform(file.document, parent.id), parent.width, parent.height) : null;
  const fillPaint = firstVisibleFill(node.fills);
  const strokePaint = firstVisibleFill(node.strokes);

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    x: round(bounds.x),
    y: round(bounds.y),
    relativeX: round(parentBox ? bounds.x - parentBox.x : bounds.x),
    relativeY: round(parentBox ? bounds.y - parentBox.y : bounds.y),
    width: round(bounds.width),
    height: round(bounds.height),
    rotation: round(rotationOf(node.transform)),
    opacity: round(node.opacity),
    cornerRadius: round(node.cornerRadius ?? 0),
    parentName: parent && parent.type !== 'CANVAS' && parent.type !== 'DOCUMENT' ? parent.name : null,
    parentWidth: parent && parent.type !== 'CANVAS' && parent.type !== 'DOCUMENT' ? round(parent.width) : null,
    parentHeight: parent && parent.type !== 'CANVAS' && parent.type !== 'DOCUMENT' ? round(parent.height) : null,
    gaps: siblingGaps(file, id),
    fill: fillPaint ? (fillPaint.type === 'SOLID' ? rgbaToHex({ ...fillPaint.color, a: fillPaint.opacity ?? 1 }) : fillPaint.type.toLowerCase()) : null,
    stroke: strokePaint ? (strokePaint.type === 'SOLID' ? rgbaToHex({ ...strokePaint.color, a: strokePaint.opacity ?? 1 }) : strokePaint.type.toLowerCase()) : null,
    font: node.type === 'TEXT' ? `${node.style.fontWeight ?? 400} ${node.style.fontSize}px ${node.style.fontFamily}` : null,
  };
}

function shadowCss(node: SceneNode): string | null {
  const shadow = (node.effects ?? []).find(
    (effect): effect is ShadowEffect => effect.type === 'DROP_SHADOW' && effect.visible !== false,
  );
  if (!shadow) return null;
  const spread = shadow.spread ? `${shadow.spread}px ` : '';
  return `${shadow.offset.x}px ${shadow.offset.y}px ${shadow.radius}px ${spread}${figmaColorToCss(shadow.color, shadow.color.a ?? 1)}`;
}

/** CSS declarations for a node (no selector). */
export function cssDeclarations(file: PigmaFile, id: string): string[] {
  const node = findNode(file.document, id);
  const measured = measurements(file, id);
  if (!node || !measured || node.type === 'DOCUMENT' || node.type === 'CANVAS') return [];
  const lines: string[] = [
    'position: absolute;',
    `left: ${measured.relativeX}px;`,
    `top: ${measured.relativeY}px;`,
    `width: ${measured.width}px;`,
    `height: ${measured.height}px;`,
  ];
  const fill = firstVisibleFill(node.fills);
  if (fill) lines.push(`background: ${paintToCssBackground(fill)};`);
  const stroke = firstVisibleFill(node.strokes);
  if (stroke) {
    const weight = node.strokeWeight ?? 1;
    lines.push(`border: ${weight}px solid ${paintToCssBackground(stroke)};`);
  }
  if (measured.cornerRadius > 0) lines.push(`border-radius: ${measured.cornerRadius}px;`);
  if (measured.rotation !== 0) lines.push(`transform: rotate(${measured.rotation}deg);`);
  if (measured.opacity < 1) lines.push(`opacity: ${measured.opacity};`);
  // CSS has every blend mode Figma uses, so it is emitted rather than noted —
  // only PASS_THROUGH (a container's mode) has no CSS equivalent.
  const blend = node.blendMode ?? 'NORMAL';
  if (blend !== 'NORMAL' && blend !== 'PASS_THROUGH') {
    lines.push(`mix-blend-mode: ${blend.toLowerCase().replace(/_/g, '-')};`);
  }
  const shadow = shadowCss(node);
  if (shadow) lines.push(`box-shadow: ${shadow};`);
  if (node.type === 'TEXT') {
    const style = node.style;
    lines.push(`font-family: ${style.fontFamily};`);
    lines.push(`font-size: ${style.fontSize}px;`);
    lines.push(`font-weight: ${style.fontWeight ?? 400};`);
    if (style.lineHeight && style.lineHeight.value !== undefined) {
      lines.push(`line-height: ${style.lineHeight.unit === 'PERCENT' ? `${style.lineHeight.value}%` : `${style.lineHeight.value}px`};`);
    }
    if (style.letterSpacing && style.letterSpacing.value !== 0) lines.push(`letter-spacing: ${style.letterSpacing.value}${style.letterSpacing.unit === 'PERCENT' ? '%' : 'px'};`);
    lines.push(`text-align: ${(style.textAlignHorizontal ?? 'LEFT').toLowerCase()};`);
  }
  return lines;
}

/** A copyable CSS rule for the selection. */
export function toCss(file: PigmaFile, id: string): string {
  const node = findNode(file.document, id);
  if (!node) return '';
  const selector = `.${node.name.trim().replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase() || 'layer'}`;
  const lines = cssDeclarations(file, id);
  if (lines.length === 0) return '';
  return `${selector} {\n${lines.map((line) => `  ${line}`).join('\n')}\n}`;
}

function jsxValue(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

/** A copyable React component for the selection (inline styles). */
export function toReact(file: PigmaFile, id: string): string {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return '';
  const component = node.name.replace(/[^A-Za-z0-9]+(.)?/g, (_, chr: string) => (chr ? chr.toUpperCase() : '')).replace(/^[0-9]/, 'Layer') || 'Layer';
  const entries: string[] = [];

  for (const line of cssDeclarations(file, id)) {
    const [rawProperty, ...rest] = line.replace(/;$/, '').split(':');
    const property = (rawProperty ?? '').trim().replace(/-([a-z])/g, (_, chr: string) => chr.toUpperCase());
    const value = rest.join(':').trim();
    if (!property || !value) continue;
    if (property === 'position') continue;
    if (/^[0-9.]+px$/.test(value)) {
      entries.push(`    ${property}: ${Number.parseFloat(value)},`);
      continue;
    }
    if (/^[0-9.]+$/.test(value)) {
      entries.push(`    ${property}: ${value},`);
      continue;
    }
    entries.push(`    ${property}: ${jsxValue(value)},`);
  }

  const isText = node.type === 'TEXT';
  const tag = isText ? 'span' : 'div';
  const content = isText ? node.characters : null;
  const body = content
    ? `\n    ${content.replace(/\n/g, ' ')}\n  `
    : '';
  return `export function ${component}() {\n  return (\n    <${tag}\n      style={{\n        position: 'absolute',\n${entries.join('\n')}\n      }}\n    >${body}</${tag}>\n  );\n}\n`;
}

// ---------------------------------------------------------------------------
// Mobile targets (M14): SwiftUI for iOS, Jetpack Compose for Android.
//
// Both follow the same rule as CSS/React above: everything the model can express
// exactly is emitted, and anything it cannot is a comment saying so — never a
// plausible-looking stand-in. Auto layout, gradients, vector networks, image
// fills, polygon/star geometry and inner shadows are all called out by name.
// ---------------------------------------------------------------------------

/** An identifier from a layer name, for a Swift type or a Kotlin function. */
function identifier(name: string, fallback: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  return /^[A-Za-z]/.test(joined) ? joined : `${fallback}${joined}`;
}

/** A colour literal per target, from a paint. */
function swiftColor(color: { r: number; g: number; b: number }, opacity: number): string {
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 1000) / 1000;
  return alpha >= 1
    ? `Color(red: ${channel(color.r)}, green: ${channel(color.g)}, blue: ${channel(color.b)})`
    : `Color(red: ${channel(color.r)}, green: ${channel(color.g)}, blue: ${channel(color.b)}).opacity(${alpha})`;
}

function composeColor(color: { r: number; g: number; b: number }, opacity: number): string {
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255);
  const hex = [alpha, channel(color.r), channel(color.g), channel(color.b)]
    .map((value) => value.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return `Color(0x${hex})`;
}

/** The Kotlin weight for a numeric font weight. */
function composeWeight(weight: number): string {
  if (weight >= 800) return 'FontWeight.Black';
  if (weight >= 700) return 'FontWeight.Bold';
  if (weight >= 600) return 'FontWeight.SemiBold';
  if (weight >= 500) return 'FontWeight.Medium';
  if (weight >= 400) return 'FontWeight.Normal';
  return 'FontWeight.Light';
}

function swiftWeight(weight: number): string {
  if (weight >= 800) return '.black';
  if (weight >= 700) return '.bold';
  if (weight >= 600) return '.semibold';
  if (weight >= 500) return '.medium';
  if (weight >= 400) return '.regular';
  return '.light';
}

/** The node's first visible drop shadow, if it has one. */
function dropShadowOf(node: SceneNode): ShadowEffect | undefined {
  return (node.effects ?? []).find(
    (effect): effect is ShadowEffect => effect.type === 'DROP_SHADOW' && effect.visible !== false,
  );
}

/**
 * Notes about what a target cannot represent.
 *
 * Everything the generators *can* express is emitted (letter spacing, line
 * height, alignment, case, decoration, the font family) — these notes are only
 * for what a target genuinely has no equivalent for, so nothing is dropped
 * silently. `target` decides the wording where the two platforms differ.
 */
function unsupportedNotes(node: SceneNode, target: 'swift' | 'compose'): string[] {
  const notes: string[] = [];
  // Every note names the property AND its value: "the font family is not
  // generated" leaves a developer with nothing to act on, while
  // `font family "Playfair Display"` tells them exactly what to add.
  const layout = (node as SceneNode & { layoutMode?: string }).layoutMode;
  if (layout && layout !== 'NONE') {
    notes.push(`auto layout (${layout}) is not generated — children are positioned absolutely`);
  }

  const paints = [...(node.fills ?? []), ...(node.strokes ?? [])];
  // Each note carries a value a developer can act on: a stop count, a scale mode,
  // a command count — never just the name of the feature that was dropped.
  const stops = (paint: Paint): number => {
    const value = (paint as unknown as { stops?: unknown }).stops;
    return Array.isArray(value) ? value.length : 0;
  };
  const scaleMode = (paint: Paint): string => ((paint as { scaleMode?: string }).scaleMode ?? 'FILL').toUpperCase();

  const gradient = paints.find((paint) => paint.type.startsWith('GRADIENT'));
  if (gradient) notes.push(`the ${gradient.type} fill (${stops(gradient)} stops) is not generated — a solid fill is not substituted`);
  const image = paints.find((paint) => paint.type === 'IMAGE');
  if (image) notes.push(`the IMAGE fill (scaleMode ${scaleMode(image)}) is not generated — set the bitmap in the target`);
  const exotic = paints.find((paint) => paint.type === 'VIDEO' || paint.type === 'PATTERN');
  if (exotic) notes.push(`the ${exotic.type} paint (scaleMode ${scaleMode(exotic)}) is not generated`);

  const stroke = firstVisibleFill(node.strokes);
  if (stroke && stroke.type !== 'SOLID') {
    const detail = stroke.type.startsWith('GRADIENT') ? `${stops(stroke)} stops` : `scaleMode ${scaleMode(stroke)}`;
    notes.push(`the ${stroke.type} stroke (${detail}) is not generated — only SOLID strokes are`);
  }

  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') {
    const commands = ((node as { pathData?: string }).pathData ?? '').replace(/[^A-Za-z]/g, '').length;
    notes.push(`the ${node.type} path (${commands} commands) is not generated — export it from the file`);
  }
  if (node.type === 'POLYGON' || node.type === 'STAR') {
    notes.push(
      `${node.type} geometry (${node.pointCount ?? (node.type === 'STAR' ? 5 : 3)} ${
        node.type === 'STAR' ? 'points' : 'sides'
      }) has no primitive in this target — draw it with a path`,
    );
  }

  const effects = node.effects ?? [];
  const inner = effects.filter((effect) => effect.type === 'INNER_SHADOW');
  if (inner.length > 0) notes.push(`${inner.length} INNER_SHADOW effect${inner.length === 1 ? '' : 's'} not generated`);
  const blur = effects.find((effect) => effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR');
  if (blur) {
    const radius = (blur as { radius?: number }).radius;
    notes.push(`the ${blur.type} (radius ${radius ?? 0}) is not generated`);
  }

  const shadow = dropShadowOf(node);
  if (shadow?.spread) {
    notes.push(`the DROP_SHADOW spread (${shadow.spread}) is not generated — radius and offset are`);
  }
  if (shadow && shadow.showShadowBehindNode === false) {
    notes.push('showShadowBehindNode: false is not generated — the shadow always draws behind the layer');
  }

  const blendMode = node.blendMode ?? 'NORMAL';
  if (blendMode !== 'NORMAL') {
    notes.push(
      target === 'swift'
        ? `the blend mode (${blendMode}) is not generated — set .blendMode on the enclosing view`
        : `the blend mode (${blendMode}) is not generated — Compose blends at the graphics layer, not per element`,
    );
  }

  if (node.type === 'TEXT') {
    const spacing = node.style.paragraphSpacing ?? 0;
    if (spacing > 0) notes.push(`paragraph spacing (${spacing}) is not generated`);
    if (target === 'compose') {
      const family = (node.style.fontFamily ?? '').trim();
      notes.push(
        family === ''
          ? 'fontFamily is not generated — add the font to res/font and set fontFamily from it'
          : `font family "${family}" is not generated — add it to res/font and set fontFamily from it`,
      );
    }
  }
  return notes;
}

/** The SwiftUI font modifier: the design family where one is set, the system font otherwise. */
function swiftFont(style: { fontFamily?: string; fontSize?: number; fontWeight?: number }): string {
  const size = round(style.fontSize ?? 14, 2);
  const weight = swiftWeight(style.fontWeight ?? 400);
  const family = (style.fontFamily ?? '').trim();
  return family === ''
    ? `.system(size: ${size}, weight: ${weight})`
    : `.custom("${family.replace(/"/g, '\\"')}", size: ${size}).weight(${weight})`;
}

/** SwiftUI line spacing is *extra* spacing, so the design's line height becomes a delta. */
function swiftLineSpacing(style: { fontSize?: number; lineHeight?: { unit?: string; value?: number } }): number | null {
  const lineHeight = style.lineHeight;
  if (!lineHeight || lineHeight.value === undefined) return null;
  const size = style.fontSize ?? 14;
  const absolute = lineHeight.unit === 'PERCENT' ? (lineHeight.value / 100) * size : lineHeight.value;
  return round(Math.max(0, absolute - size * 1.2), 2);
}

/** The Compose text alignment for a design alignment. */
function composeTextAlign(align: string | undefined): string | null {
  switch (align) {
    case 'CENTER':
      return 'TextAlign.Center';
    case 'RIGHT':
      return 'TextAlign.End';
    case 'JUSTIFIED':
      return 'TextAlign.Justify';
    case 'LEFT':
      return 'TextAlign.Start';
    default:
      return null;
  }
}

function swiftTextAlign(align: string | undefined): string | null {
  switch (align) {
    case 'CENTER':
      return '.center';
    case 'RIGHT':
      return '.trailing';
    case 'LEFT':
      return '.leading';
    default:
      return null;
  }
}

/**
 * Case, expressed as a Kotlin expression: Compose has no `textCase` modifier, so
 * the transform is applied to the literal. `literal` is the quoted string.
 */
function composeCase(literal: string, textCase: string | undefined): string {
  if (textCase === 'UPPER') return `${literal}.uppercase()`;
  if (textCase === 'LOWER') return `${literal}.lowercase()`;
  if (textCase === 'TITLE') {
    return `${literal}.split(" ").joinToString(" ") { word -> word.replaceFirstChar { it.uppercase() } }`;
  }
  return literal;
}

function composeDecoration(textDecoration: string | undefined): string | null {
  if (textDecoration === 'UNDERLINE') return 'TextDecoration.Underline';
  if (textDecoration === 'STRIKETHROUGH') return 'TextDecoration.LineThrough';
  return null;
}

/** The shape modifier both targets use, or null when the geometry has no primitive. */
function swiftShape(node: SceneNode): string | null {
  switch (node.type) {
    case 'ELLIPSE':
      return 'Ellipse()';
    case 'POLYGON':
    case 'STAR':
    case 'VECTOR':
    case 'BOOLEAN_OPERATION':
      return null;
    default:
      return 'Rectangle()';
  }
}

function composeShape(node: SceneNode): string | null {
  switch (node.type) {
    case 'ELLIPSE':
      return 'Circle()';
    case 'POLYGON':
    case 'STAR':
    case 'VECTOR':
    case 'BOOLEAN_OPERATION':
      return null;
    default:
      return 'RectangleShape()';
  }
}

/** A copyable SwiftUI view for the selection. */
export function toSwiftUI(file: PigmaFile, id: string): string {
  const node = findNode(file.document, id);
  const measured = measurements(file, id);
  if (!node || !measured || node.type === 'DOCUMENT' || node.type === 'CANVAS') return '';
  const name = identifier(node.name, 'Layer');
  const lines: string[] = [`// Pigma — ${node.name}`, `// Generated for iOS. Measurements in points, matching the frame's pixels.`];
  for (const note of unsupportedNotes(node, 'swift')) lines.push(`// Not represented: ${note}`);
  lines.push('', `struct ${name}View: View {`, '  var body: some View {');

  const modifiers: string[] = [
    `      .offset(x: ${round(measured.relativeX, 2)}, y: ${round(measured.relativeY, 2)})`,
  ];
  if (measured.rotation !== 0) modifiers.push(`      .rotationEffect(.degrees(${round(measured.rotation, 2)}))`);
  if (measured.opacity < 1) modifiers.push(`      .opacity(${round(measured.opacity, 3)})`);
  const shadow = dropShadowOf(node);
  if (shadow) {
    modifiers.push(
      `      .shadow(color: ${swiftColor(shadow.color, shadow.color.a ?? 1)}, radius: ${round(shadow.radius, 2)}, x: ${round(shadow.offset.x, 2)}, y: ${round(shadow.offset.y, 2)})`,
    );
  }

  if (node.type === 'TEXT') {
    const style = node.style;
    const text = node.characters.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
    lines.push(`    Text("${text}")`);
    // The design family, not the system font: a layer set in Inter must render in
    // Inter. `.custom(_:size:)` takes no weight, so the weight is applied after.
    lines.push(`      .font(${swiftFont(style)})`);
    const fill = firstVisibleFill(node.fills);
    if (fill && fill.type === 'SOLID') lines.push(`      .foregroundColor(${swiftColor(fill.color, fill.opacity ?? 1)})`);
    if (style.letterSpacing && style.letterSpacing.value !== 0) {
      const spacing =
        style.letterSpacing.unit === 'PERCENT'
          ? round(((style.letterSpacing.value / 100) * (style.fontSize ?? 14)), 2)
          : round(style.letterSpacing.value, 2);
      lines.push(`      .tracking(${spacing})`);
    }
    const lineSpacing = swiftLineSpacing(style);
    if (lineSpacing !== null && lineSpacing > 0) lines.push(`      .lineSpacing(${lineSpacing}) // design line height minus the default leading`);
    const align = swiftTextAlign(style.textAlignHorizontal);
    if (align) lines.push(`      .multilineTextAlignment(${align})`);
    if (style.textCase === 'UPPER') lines.push('      .textCase(.uppercase)');
    if (style.textCase === 'LOWER') lines.push('      .textCase(.lowercase)');
    if (style.textDecoration === 'UNDERLINE') lines.push('      .underline()');
    if (style.textDecoration === 'STRIKETHROUGH') lines.push('      .strikethrough()');
    lines.push(`      .frame(width: ${round(measured.width, 2)}, height: ${round(measured.height, 2)}, alignment: .topLeading)`);
    lines.push(...modifiers);
  } else {
    const shape = swiftShape(node);
    if (!shape) {
      lines.push(`    // ${node.type}: no SwiftUI primitive — draw this layer with a Path.`);
      lines.push('    Color.clear');
      lines.push(`      .frame(width: ${round(measured.width, 2)}, height: ${round(measured.height, 2)})`);
    } else {
      lines.push(`    ${shape}`);
      const fill = firstVisibleFill(node.fills);
      if (fill && fill.type === 'SOLID') lines.push(`      .fill(${swiftColor(fill.color, fill.opacity ?? 1)})`);
      else if (fill) lines.push('      .fill(Color.clear) // fill type not generated');
      lines.push(`      .frame(width: ${round(measured.width, 2)}, height: ${round(measured.height, 2)})`);
      const stroke = firstVisibleFill(node.strokes);
      if (stroke && stroke.type === 'SOLID') {
        lines.push(
          `      .overlay(${shape}.stroke(${swiftColor(stroke.color, stroke.opacity ?? 1)}, lineWidth: ${round(node.strokeWeight ?? 1, 2)}))`,
        );
      }
      if (measured.cornerRadius > 0) lines.push(`      .cornerRadius(${round(measured.cornerRadius, 2)})`);
    }
    lines.push(...modifiers);
  }

  lines.push('  }', '}', '');
  return lines.join('\n');
}

/** A copyable Jetpack Compose composable for the selection. */
export function toCompose(file: PigmaFile, id: string): string {
  const node = findNode(file.document, id);
  const measured = measurements(file, id);
  if (!node || !measured || node.type === 'DOCUMENT' || node.type === 'CANVAS') return '';
  const name = identifier(node.name, 'Layer');
  const lines: string[] = [
    `// Pigma — ${node.name}`,
    '// Generated for Android. Measurements in dp, matching the frame pixels at 1x.',
  ];
  for (const note of unsupportedNotes(node, 'compose')) lines.push(`// Not represented: ${note}`);
  lines.push('', '@Composable', `fun ${name}() {`);

  const corner =
    measured.cornerRadius > 0 ? `RoundedCornerShape(${round(measured.cornerRadius, 2)}.dp)` : 'RectangleShape()';
  const fill = firstVisibleFill(node.fills);
  const stroke = firstVisibleFill(node.strokes);
  const shape = composeShape(node);
  const shadow = dropShadowOf(node);

  const modifiers: string[] = [
    `      .offset(x = ${round(measured.relativeX, 2)}.dp, y = ${round(measured.relativeY, 2)}.dp)`,
    `      .size(width = ${round(measured.width, 2)}.dp, height = ${round(measured.height, 2)}.dp)`,
  ];
  // The shape is only drawn where the target has a primitive for it: a polygon
  // or a star gets a note instead of a rectangle pretending to be one. A text
  // layer's fill is its text colour, which the `Text` call already carries, so
  // it never becomes a background.
  const drawsShape = shape !== null && node.type !== 'TEXT';
  if (drawsShape) {
    if (measured.cornerRadius > 0) modifiers.push(`      .clip(${corner})`);
    if (fill && fill.type === 'SOLID') {
      modifiers.push(`      .background(color = ${composeColor(fill.color, fill.opacity ?? 1)}, shape = ${shape})`);
    } else if (fill) {
      modifiers.push('      // fill type not generated — set the paint in the target');
    }
    if (stroke && stroke.type === 'SOLID') {
      modifiers.push(
        `      .border(width = ${round(node.strokeWeight ?? 1, 2)}.dp, color = ${composeColor(stroke.color, stroke.opacity ?? 1)}, shape = ${shape})`,
      );
    }
  } else if (shape === null && (fill || stroke)) {
    modifiers.push('      // this layer\'s geometry is not drawn — see the note above');
  }
  if (measured.rotation !== 0) modifiers.push(`      .rotate(${round(measured.rotation, 2)}f)`);
  if (measured.opacity < 1) modifiers.push(`      .alpha(${round(measured.opacity, 3)}f)`);
  if (shadow) {
    const color = composeColor(shadow.color, shadow.color.a ?? 1);
    // The shadow never invents a shape either: when the geometry was omitted
    // above, the shadow drops the shape argument rather than casting a rectangle.
    const shadowShape = drawsShape ? `shape = ${shape}, ` : '';
    modifiers.push(
      `      .shadow(elevation = ${round(shadow.radius, 2)}.dp, ${shadowShape}ambientColor = ${color}, spotColor = ${color})`,
    );
  }

  if (node.type === 'TEXT') {
    const style = node.style;
    const text = node.characters.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
    lines.push('  Text(');
    lines.push(`    text = ${composeCase(`"${text}"`, style.textCase)},`);
    lines.push(`    fontSize = ${round(style.fontSize, 2)}.sp,`);
    lines.push(`    fontWeight = ${composeWeight(style.fontWeight ?? 400)},`);
    if (fill && fill.type === 'SOLID') lines.push(`    color = ${composeColor(fill.color, fill.opacity ?? 1)},`);
    if (style.letterSpacing && style.letterSpacing.value !== 0) {
      const spacing =
        style.letterSpacing.unit === 'PERCENT'
          ? round(((style.letterSpacing.value / 100) * (style.fontSize ?? 14)), 2)
          : round(style.letterSpacing.value, 2);
      lines.push(`    letterSpacing = ${spacing}.sp,`);
    }
    if (style.lineHeight && style.lineHeight.value !== undefined) {
      const absolute = style.lineHeight.unit === 'PERCENT' ? round((style.lineHeight.value / 100) * (style.fontSize ?? 14), 2) : round(style.lineHeight.value, 2);
      lines.push(`    lineHeight = ${absolute}.sp,`);
    }
    const align = composeTextAlign(style.textAlignHorizontal);
    if (align) lines.push(`    textAlign = ${align},`);
    const decoration = composeDecoration(style.textDecoration);
    if (decoration) lines.push(`    textDecoration = ${decoration},`);
    lines.push('    modifier = Modifier');
    lines.push(...modifiers);
    lines.push('  )');
  } else {
    lines.push('  Box(');
    lines.push('    modifier = Modifier');
    lines.push(...modifiers);
    lines.push('  )');
  }
  lines.push('}', '');
  return lines.join('\n');
}

/** Plain-text measurement summary for the inspect panel header. */
export function measurementSummary(measured: Measurements): string[] {
  const lines = [
    `size    ${measured.width} x ${measured.height}`,
    `position ${measured.x}, ${measured.y}`,
  ];
  if (measured.parentName) {
    lines.push(`relative ${measured.relativeX}, ${measured.relativeY} (in ${measured.parentName} ${measured.parentWidth} x ${measured.parentHeight})`);
  }
  const gaps = measured.gaps;
  const gapParts = [
    gaps.left !== null ? `left ${gaps.left}` : null,
    gaps.right !== null ? `right ${gaps.right}` : null,
    gaps.top !== null ? `top ${gaps.top}` : null,
    gaps.bottom !== null ? `bottom ${gaps.bottom}` : null,
  ].filter((part): part is string => !!part);
  if (gapParts.length > 0) lines.push(`gaps    ${gapParts.join('  ')}`);
  if (measured.rotation !== 0) lines.push(`rotation ${measured.rotation}deg`);
  if (measured.opacity < 1) lines.push(`opacity ${measured.opacity}`);
  return lines;
}
