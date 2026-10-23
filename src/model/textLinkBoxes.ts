import type { TextNode, TextRange } from './types';
import { layoutText, measureParts } from '../render/textMetrics';
import { lineSegments, normalizeTextRanges, weightRunsOf } from './textRanges';

/**
 * Figma stores a text link as a hyperlink box: a rectangle, a URL and no character range (TextData.hyperlinkBoxes in
 * the embedded schema). These are the rectangles of Pigma's linked runs, from the same layout the canvas draws, so the
 * boxes match what is on screen; and the matching back: a box is read as the word range whose rectangle it is.
 */
export interface LinkBox {
  start: number;
  end: number;
  link: string;
  bounds: { x: number; y: number; width: number; height: number };
}

/** The rectangles of the linked runs of a text layer, in the layer's own coordinates. Empty for truncated text. */
export function linkBoxesOf(node: TextNode, ranges: TextRange[] = node.textRanges ?? []): LinkBox[] {
  if (ranges.length === 0) return [];
  const autoResize = node.style.textAutoResize ?? 'WIDTH_AND_HEIGHT';
  if (autoResize === 'TRUNCATE') return [];
  const wrap = autoResize === 'HEIGHT' || autoResize === 'NONE';
  const layout = layoutText(node.characters, node.style, node.width, wrap, weightRunsOf(ranges));
  if (layout.sources.length !== layout.lines.length) return [];
  const align = node.style.textAlignHorizontal ?? 'LEFT';
  const x = align === 'CENTER' ? node.width / 2 : align === 'RIGHT' ? node.width : 0;
  const vertical = node.style.textAlignVertical ?? 'TOP';
  const offsetY =
    vertical === 'CENTER' ? (node.height - layout.height) / 2 : vertical === 'BOTTOM' ? node.height - layout.height : 0;
  const spacing = node.style.paragraphSpacing ?? 0;
  const boxes: LinkBox[] = [];
  layout.lines.forEach((line, index) => {
    if (line === '') return;
    const source = layout.sources[index]!;
    const segments = lineSegments(line, source, ranges);
    const lineWidth = measureParts(segments, node.style);
    const lineStart = align === 'CENTER' ? x - lineWidth / 2 : align === 'RIGHT' ? x - lineWidth : x;
    // The part of the line before its own characters (a list marker or wrap indent) is not text in the layer.
    const prefixLength = line.length - (source.end - source.start);
    const top = offsetY + index * (layout.lineHeight + spacing);
    let consumed = '';
    for (const [part, segment] of segments.entries()) {
      const start = source.start + Math.max(0, consumed.length - prefixLength);
      const segmentX = lineStart + measureParts(segments.slice(0, part), node.style);
      consumed += segment.text;
      if (segment.link === undefined) continue;
      boxes.push({
        start,
        end: start + segment.text.length,
        link: segment.link,
        bounds: { x: segmentX, y: top, width: measureParts([segment], node.style), height: layout.lineHeight },
      });
    }
  });
  return boxes;
}

const TOLERANCE = 0.5;

/**
 * The link ranges a file's hyperlink boxes stand for. Each box is matched to the word range whose geometry it has, so
 * a file written by linkBoxesOf reads back to the same ranges. A link that starts or ends inside a word has no match
 * and is dropped; that is the stated limit of reading boxes back.
 */
export function textRangesFromLinkBoxes(
  node: TextNode,
  boxes: Array<{ bounds: { x: number; y: number; width: number; height: number }; url: string }>,
): TextRange[] {
  const text = node.characters;
  const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (!isSpace(text[index]) && isSpace(text[index - 1])) starts.push(index);
    if (!isSpace(text[index]) && isSpace(text[index + 1])) ends.push(index + 1);
  }
  const found: TextRange[] = [];
  for (const box of boxes) {
    let match: TextRange | undefined;
    search: for (const start of starts) {
      for (const end of ends) {
        if (end <= start) continue;
        const [candidate] = linkBoxesOf(node, [{ start, end, link: box.url }]);
        if (!candidate) continue;
        const close =
          Math.abs(candidate.bounds.x - box.bounds.x) < TOLERANCE &&
          Math.abs(candidate.bounds.y - box.bounds.y) < TOLERANCE &&
          Math.abs(candidate.bounds.width - box.bounds.width) < TOLERANCE &&
          Math.abs(candidate.bounds.height - box.bounds.height) < TOLERANCE;
        if (close) {
          match = { start, end, link: box.url };
          break search;
        }
      }
    }
    if (match) found.push(match);
  }
  return normalizeTextRanges(found, text.length);
}
