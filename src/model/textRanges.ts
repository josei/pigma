import type { TextRange } from './types';

/**
 * Text ranges (Figma's per-part properties, starting with links): the editing and normalising rules. Rendering and
 * the properties panel use these helpers later; they are pure, so the model stays the single source of truth.
 */

/** Clean a range list from a file or an edit: whole numbers clamped to the text, empty ranges and ranges with neither a link nor a weight dropped, sorted, and no overlaps (an earlier range wins). */
export function normalizeTextRanges(ranges: unknown, length: number): TextRange[] {
  if (!Array.isArray(ranges)) return [];
  const cleaned: TextRange[] = [];
  for (const raw of ranges) {
    if (typeof raw !== 'object' || raw === null) continue;
    const range = raw as Record<string, unknown>;
    if (typeof range.start !== 'number' || typeof range.end !== 'number') continue;
    const start = Math.max(0, Math.min(length, Math.round(range.start)));
    const end = Math.max(0, Math.min(length, Math.round(range.end)));
    if (!(end > start)) continue;
    const link = typeof range.link === 'string' && range.link.trim() !== '' ? range.link : undefined;
    const fontWeight = typeof range.fontWeight === 'number' && range.fontWeight >= 1 && range.fontWeight <= 1000 ? Math.round(range.fontWeight) : undefined;
    if (link === undefined && fontWeight === undefined) continue;
    cleaned.push({ start, end, ...(link !== undefined ? { link } : {}), ...(fontWeight !== undefined ? { fontWeight } : {}) });
  }
  cleaned.sort((a, b) => a.start - b.start);
  const out: TextRange[] = [];
  for (const range of cleaned) {
    const previous = out[out.length - 1];
    const start = previous && range.start < previous.end ? previous.end : range.start;
    if (range.end > start) out.push({ ...range, start });
  }
  return out;
}

/**
 * The span from `start` to `end` cut at the existing ranges, each piece keeping the link and weight it had.
 */
function spanPieces(ranges: TextRange[], start: number, end: number): TextRange[] {
  const pieces: TextRange[] = [];
  let cursor = start;
  for (const range of ranges) {
    const from = Math.max(range.start, start);
    const to = Math.min(range.end, end);
    if (to <= from) continue;
    if (from > cursor) pieces.push({ start: cursor, end: from });
    pieces.push({ ...range, start: from, end: to });
    cursor = to;
  }
  if (cursor < end) pieces.push({ start: cursor, end });
  return pieces;
}

/** The ranges with the span from `start` to `end` cut out of them. */
function outside(ranges: TextRange[], start: number, end: number): TextRange[] {
  const kept: TextRange[] = [];
  for (const range of ranges) {
    if (range.end <= start || range.start >= end) {
      kept.push(range);
      continue;
    }
    if (range.start < start) kept.push({ ...range, end: start });
    if (range.end > end) kept.push({ ...range, start: end });
  }
  return kept;
}

/** Set (or, with `link` null, clear) the link on characters `start` to `end`, splitting any range that overlaps. */
export function setTextLink(ranges: TextRange[], start: number, end: number, link: string | null, length: number): TextRange[] {
  const kept = outside(ranges, start, end);
  const target = link !== null && link.trim() !== '' ? link : null;
  // A link set over bold characters keeps them bold; clearing the link keeps the weight too.
  for (const piece of spanPieces(ranges, start, end)) kept.push({ ...piece, link: target ?? undefined });
  return normalizeTextRanges(kept, length);
}

/** Set (or, with `fontWeight` null, clear) the weight of characters `start` to `end`. A link on them is kept. */
export function setTextWeight(ranges: TextRange[], start: number, end: number, fontWeight: number | null, length: number): TextRange[] {
  const kept = outside(ranges, start, end);
  for (const piece of spanPieces(ranges, start, end)) kept.push({ ...piece, fontWeight: fontWeight ?? undefined });
  return normalizeTextRanges(kept, length);
}

/** The link on character `index`, or undefined when that character is not linked. */
export function linkAt(ranges: TextRange[], index: number): string | undefined {
  return ranges.find((range) => index >= range.start && index < range.end)?.link;
}

/** The weights the ranges set, as the runs layout measures (a range with no weight is left out). */
export function weightRunsOf(ranges: TextRange[]): Array<{ start: number; end: number; fontWeight: number }> {
  return ranges.flatMap((range) =>
    range.fontWeight === undefined ? [] : [{ start: range.start, end: range.end, fontWeight: range.fontWeight }],
  );
}

/** A piece of text with the link and weight of the range it came from, if any. */
export interface TextSegment {
  text: string;
  link?: string;
  fontWeight?: number;
}

function segmentOf(text: string, range: TextRange): TextSegment {
  return {
    text,
    ...(range.link !== undefined ? { link: range.link } : {}),
    ...(range.fontWeight !== undefined ? { fontWeight: range.fontWeight } : {}),
  };
}

/** The whole text as segments, each with its link or weight or plain, in order. Their texts join back to `characters`. */
export function textSegments(characters: string, ranges: TextRange[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: characters.slice(cursor, range.start) });
    segments.push(segmentOf(characters.slice(range.start, range.end), range));
    cursor = range.end;
  }
  if (cursor < characters.length) segments.push({ text: characters.slice(cursor) });
  return segments;
}

/**
 * One rendered line split into plain and linked parts. `source` is where the line's own characters sit in the text
 * (from layoutText); the part of the line before them, a list marker or wrap indent, is plain. Without a source the
 * whole line is plain.
 */
export function lineSegments(
  line: string,
  source: { start: number; end: number } | undefined,
  ranges: TextRange[],
): TextSegment[] {
  if (!source || ranges.length === 0) return [{ text: line }];
  const bodyLength = source.end - source.start;
  const prefix = line.slice(0, line.length - bodyLength);
  const body = line.slice(line.length - bodyLength);
  // Ranges, cut to this line and moved to the line's own offsets.
  const local: TextRange[] = [];
  for (const range of ranges) {
    const start = Math.max(range.start, source.start) - source.start;
    const end = Math.min(range.end, source.end) - source.start;
    if (end > start) local.push({ ...range, start, end });
  }
  const segments = textSegments(body, local);
  return prefix === '' ? segments : [{ text: prefix }, ...segments];
}

/**
 * The weight Cmd/Ctrl+B gives a selection, or null to clear it. A selection that is all bold becomes plain; anything
 * else becomes bold. A layer that is bold itself is made plain with an explicit weight, since clearing would leave it bold.
 */
export function boldToggleWeight(ranges: TextRange[], start: number, end: number, baseWeight: number): number | null {
  let allBold = true;
  for (let index = start; index < end; index++) {
    const range = ranges.find((candidate) => index >= candidate.start && index < candidate.end);
    if ((range?.fontWeight ?? baseWeight) < 700) allBold = false;
  }
  if (!allBold) return 700;
  return baseWeight >= 700 ? 400 : null;
}
