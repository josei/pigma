import { describe, expect, it } from 'vitest';
import { linkAt, normalizeTextRanges, setTextLink, textSegments } from './textRanges';

describe('text ranges', () => {
  it('clamps, drops empty and bad ranges, sorts, and keeps an earlier range over an overlap', () => {
    const cleaned = normalizeTextRanges(
      [
        { start: 6, end: 20, link: 'https://b.example' },
        { start: 2, end: 2, link: 'empty' },
        { start: 0, end: 4, link: '  ' },
        { start: 1, end: 5, link: 'https://a.example' },
        'not a range',
      ],
      10,
    );
    expect(cleaned).toEqual([
      { start: 1, end: 5, link: 'https://a.example' },
      { start: 6, end: 10, link: 'https://b.example' },
    ]);
  });

  it('gives no ranges for a value that is not a list', () => {
    expect(normalizeTextRanges('nope', 10)).toEqual([]);
  });

  it('links a span and splits a range it overlaps', () => {
    const linked = setTextLink([{ start: 0, end: 10, link: 'https://x.example' }], 3, 6, 'https://y.example', 10);
    expect(linked).toEqual([
      { start: 0, end: 3, link: 'https://x.example' },
      { start: 3, end: 6, link: 'https://y.example' },
      { start: 6, end: 10, link: 'https://x.example' },
    ]);
  });

  it('clears a link with null, leaving the rest', () => {
    const cleared = setTextLink([{ start: 0, end: 10, link: 'https://x.example' }], 3, 6, null, 10);
    expect(cleared).toEqual([
      { start: 0, end: 3, link: 'https://x.example' },
      { start: 6, end: 10, link: 'https://x.example' },
    ]);
  });

  it('reads the link at a character, and none outside a range', () => {
    const ranges = [{ start: 2, end: 4, link: 'https://z.example' }];
    expect(linkAt(ranges, 2)).toBe('https://z.example');
    expect(linkAt(ranges, 4)).toBeUndefined();
    expect(linkAt(ranges, 0)).toBeUndefined();
  });

  it('splits the text into segments whose texts join back to the whole', () => {
    const text = 'Hello world';
    const segments = textSegments(text, [{ start: 6, end: 11, link: 'https://w.example' }]);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
    expect(segments).toEqual([{ text: 'Hello ' }, { text: 'world', link: 'https://w.example' }]);
  });
});
