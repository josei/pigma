import { parse, type Font, type PathCommand } from 'opentype.js';
import { INTER_BOLD_WOFF_BASE64 } from '../assets/fonts/inter-bold';
import { INTER_REGULAR_WOFF_BASE64 } from '../assets/fonts/inter-regular';
import type { TextNode, TextStyle } from '../model/types';
import { firstBaselineOffset, layoutText, letterSpacingOf, resolveLineHeight, textLinesOf } from './textMetrics';

/**
 * Text as outlines: the glyphs of a text layer as one SVG path, in the layer's own
 * coordinates. Flatten uses this to turn a frame of text into vectors.
 *
 * Two faces are bundled, Inter Regular and Inter Bold. Bold text (weight 600 and up)
 * is outlined in Inter Bold; every other weight, and every family, in Inter Regular.
 * Underline and strikethrough are drawn as bars from the font's own metrics.
 * Glyphs are placed one at a time from their advances: contextual shaping and
 * kerning (GSUB/GPOS) are not applied, because opentype.js 2.0 cannot run Inter's
 * GSUB lookups. The line breaks, alignment, letter spacing and baselines follow the
 * same rules the on-canvas text uses.
 */

type Face = 'regular' | 'bold';

const faces = new Map<Face, Font>();

/** The face a style is outlined in: bold weights get Inter Bold, the rest Inter Regular. */
export function faceFor(style: TextStyle): Face {
  const weight = style.fontWeight ?? (style.fontStyle?.includes('Bold') ? 700 : 400);
  return weight >= 600 ? 'bold' : 'regular';
}

function interFont(face: Face): Font {
  let font = faces.get(face);
  if (!font) {
    font = parse(decodeBase64(face === 'bold' ? INTER_BOLD_WOFF_BASE64 : INTER_REGULAR_WOFF_BASE64));
    faces.set(face, font);
  }
  return font;
}

/** Exact-length buffer: opentype reads the file from byte 0 of what it is given. */
function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
}

/** The bundled font's bytes, for tests that check it is the WOFF they expect. */
export function interBytes(face: Face): ArrayBuffer {
  return decodeBase64(face === 'bold' ? INTER_BOLD_WOFF_BASE64 : INTER_REGULAR_WOFF_BASE64);
}

/** Round to three decimals, so the path string carries no float noise. */
function round(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Convert opentype commands to absolute M/L/C/Z. Quadratics are raised to cubics
 * exactly, because the editor's path model (boolean operands and vector editing)
 * understands only M, L, C and Z.
 */
export function commandsToPathData(commands: PathCommand[]): string {
  const parts: string[] = [];
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  for (const command of commands) {
    switch (command.type) {
      case 'M':
        cx = startX = command.x ?? 0;
        cy = startY = command.y ?? 0;
        parts.push(`M${round(cx)} ${round(cy)}`);
        break;
      case 'L':
        cx = command.x ?? cx;
        cy = command.y ?? cy;
        parts.push(`L${round(cx)} ${round(cy)}`);
        break;
      case 'C':
        parts.push(
          `C${round(command.x1 ?? 0)} ${round(command.y1 ?? 0)} ${round(command.x2 ?? 0)} ${round(command.y2 ?? 0)} ${round(command.x ?? 0)} ${round(command.y ?? 0)}`,
        );
        cx = command.x ?? cx;
        cy = command.y ?? cy;
        break;
      case 'Q': {
        const qx = command.x1 ?? 0;
        const qy = command.y1 ?? 0;
        const ex = command.x ?? cx;
        const ey = command.y ?? cy;
        const c1x = cx + (2 / 3) * (qx - cx);
        const c1y = cy + (2 / 3) * (qy - cy);
        const c2x = ex + (2 / 3) * (qx - ex);
        const c2y = ey + (2 / 3) * (qy - ey);
        parts.push(`C${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(ex)} ${round(ey)}`);
        cx = ex;
        cy = ey;
        break;
      }
      case 'Z':
        parts.push('Z');
        cx = startX;
        cy = startY;
        break;
    }
  }
  return parts.join(' ');
}

/** A filled rectangle as absolute path commands. */
function bar(x: number, top: number, width: number, thickness: number): PathCommand[] {
  return [
    { type: 'M', x, y: top },
    { type: 'L', x: x + width, y: top },
    { type: 'L', x: x + width, y: top + thickness },
    { type: 'L', x, y: top + thickness },
    { type: 'Z' },
  ];
}

/**
 * Why a text layer cannot be outlined, or `null` when it can. Outlines are drawn in
 * Inter, so a layer in another family, or with a character Inter lacks, is refused
 * rather than silently drawn in a different face.
 */
export function outlineRefusal(node: TextNode): string | null {
  const family = node.style.fontFamily.trim().toLowerCase();
  if (family !== 'inter') {
    return `Flatten outlines Inter text only: "${node.style.fontFamily}" is not Inter. Set the font to Inter first.`;
  }
  const font = interFont(faceFor(node.style));
  for (const char of new Set(Array.from(node.characters))) {
    if (char === '\n') continue;
    if (font.charToGlyph(char).index === 0) {
      return `Inter has no glyph for "${char}", so this text cannot be outlined.`;
    }
  }
  return null;
}

/**
 * The outline of a text layer, in its own coordinates, or `null` when it has no
 * glyphs to draw (empty text).
 */
export function textOutline(node: TextNode): string | null {
  const style = node.style;
  const font = interFont(faceFor(style));
  const scale = style.fontSize / font.unitsPerEm;
  const spacing = letterSpacingOf(style);
  const lineHeight = resolveLineHeight(style);
  const paragraphSpacing = style.paragraphSpacing ?? 0;
  const baseline = firstBaselineOffset(style);
  const layout = layoutText(node.characters, style, node.width, style.textAutoResize === 'HEIGHT' || style.textAutoResize === 'NONE');
  const vertical = style.textAlignVertical ?? 'TOP';
  const offsetY =
    vertical === 'CENTER' ? (node.height - layout.height) / 2 : vertical === 'BOTTOM' ? node.height - layout.height : 0;
  const align = style.textAlignHorizontal ?? 'LEFT';
  const anchorX = align === 'CENTER' ? node.width / 2 : align === 'RIGHT' ? node.width : 0;

  const decoration = style.textDecoration ?? 'NONE';
  const commands: PathCommand[] = [];
  textLinesOf(node).forEach((line, index) => {
    const glyphs = Array.from(line).map((char) => font.charToGlyph(char));
    const width = glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth * scale, 0) + spacing * Math.max(0, glyphs.length - 1);
    const y = offsetY + baseline + index * (lineHeight + paragraphSpacing);
    let x = align === 'CENTER' ? anchorX - width / 2 : align === 'RIGHT' ? anchorX - width : anchorX;
    const left = x;
    for (const glyph of glyphs) {
      commands.push(...glyph.getPath(x, y, style.fontSize).commands);
      x += glyph.advanceWidth * scale + spacing;
    }
    if (width > 0 && decoration === 'UNDERLINE') {
      // The font's underline sits below the baseline, so its top is at -position.
      const top = y - font.tables.post.underlinePosition * scale;
      commands.push(...bar(left, top, width, font.tables.post.underlineThickness * scale));
    } else if (width > 0 && decoration === 'STRIKETHROUGH') {
      const top = y - font.tables.os2.yStrikeoutPosition * scale;
      commands.push(...bar(left, top, width, font.tables.os2.yStrikeoutSize * scale));
    }
  });
  if (commands.length === 0) return null;
  return commandsToPathData(commands);
}
