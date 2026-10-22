import type { TextRange } from './types';

/**
 * Text ranges (Figma's per-part properties, starting with links): the editing and normalising rules. Rendering and
 * the properties panel use these helpers later; they are pure, so the model stays the single source of truth.
 */

/** Clean a range list from a file or an edit: whole numbers clamped to the text, empty ranges and ranges without a link dropped, sorted, and no overlaps (an earlier range wins). */
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
    // Only links are modelled, so a range without one carries nothing and is dropped.
    if (typeof range.link !== 'string' || range.link.trim() === '') continue;
    cleaned.push({ start, end, link: range.link });
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

/** Set (or, with `link` null, clear) the link on characters `start` to `end`, splitting any range that overlaps. */
export function setTextLink(ranges: TextRange[], start: number, end: number, link: string | null, length: number): TextRange[] {
  const kept: TextRange[] = [];
  for (const range of ranges) {
    if (range.end <= start || range.start >= end) {
      kept.push(range);
      continue;
    }
    if (range.start < start) kept.push({ ...range, end: start });
    if (range.end > end) kept.push({ ...range, start: end });
  }
  if (link !== null && link.trim() !== '') kept.push({ start, end, link });
  return normalizeTextRanges(kept, length);
}

/** The link on character `index`, or undefined when that character is not linked. */
export function linkAt(ranges: TextRange[], index: number): string | undefined {
  return ranges.find((range) => index >= range.start && index < range.end)?.link;
}

/** The whole text as segments, each linked or plain, in order. Their texts join back to `characters`. */
export function textSegments(characters: string, ranges: TextRange[]): Array<{ text: string; link?: string }> {
  const segments: Array<{ text: string; link?: string }> = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: characters.slice(cursor, range.start) });
    segments.push(range.link === undefined ? { text: characters.slice(range.start, range.end) } : { text: characters.slice(range.start, range.end), link: range.link });
    cursor = range.end;
  }
  if (cursor < characters.length) segments.push({ text: characters.slice(cursor) });
  return segments;
}
