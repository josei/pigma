import { describe, expect, it } from 'vitest';
import { lineSegments, linkAt, normalizeTextRanges, setTextLink, setTextWeight, textSegments, weightRunsOf, boldToggleWeight } from './textRanges';

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

describe('per-range bold', () => {
  it('keeps a range that carries only a weight, and rounds it', () => {
    expect(normalizeTextRanges([{ start: 0, end: 4, fontWeight: 699.6 }], 10)).toEqual([{ start: 0, end: 4, fontWeight: 700 }]);
  });

  it('drops a weight outside 1 to 1000, and a range with neither a link nor a weight', () => {
    expect(normalizeTextRanges([{ start: 0, end: 4, fontWeight: 0 }, { start: 5, end: 8, fontWeight: 'bold' }], 10)).toEqual([]);
  });

  it('keeps a link and a weight together on one range', () => {
    expect(normalizeTextRanges([{ start: 0, end: 4, link: 'https://b.example', fontWeight: 700 }], 10)).toEqual([
      { start: 0, end: 4, link: 'https://b.example', fontWeight: 700 },
    ]);
  });

  it('keeps the bold of characters a link is set over', () => {
    const bold = [{ start: 2, end: 5, fontWeight: 700 }];
    expect(setTextLink(bold, 0, 8, 'https://x.example', 10)).toEqual([
      { start: 0, end: 2, link: 'https://x.example' },
      { start: 2, end: 5, link: 'https://x.example', fontWeight: 700 },
      { start: 5, end: 8, link: 'https://x.example' },
    ]);
  });

  it('keeps bold when a link is cleared', () => {
    const linkedBold = [{ start: 0, end: 6, link: 'https://x.example', fontWeight: 700 }];
    expect(setTextLink(linkedBold, 0, 6, null, 10)).toEqual([{ start: 0, end: 6, fontWeight: 700 }]);
  });

  it('keeps a bold range through a JSON round trip', async () => {
    const { createTextNode } = await import('./factory');
    const { emptyFile, validatePigmaFile } = await import('./validate');
    const file = emptyFile('Bold');
    const page = file.document.children[0]!;
    const text = createTextNode(null, 0, 0, 'Make one word bold');
    text.textRanges = [{ start: 5, end: 8, fontWeight: 700 }];
    page.children = [text];
    const loaded = validatePigmaFile(JSON.parse(JSON.stringify(file)));
    const node = loaded.file!.document.children[0]!.children[0]! as { textRanges?: unknown[] };
    expect(node.textRanges).toEqual([{ start: 5, end: 8, fontWeight: 700 }]);
  });
});

describe('a line split into plain and linked parts', () => {
  it('keeps a line with no link, or no source, as one plain part', () => {
    expect(lineSegments('plain line', undefined, [{ start: 0, end: 5, link: 'https://x.example' }])).toEqual([{ text: 'plain line' }]);
    expect(lineSegments('plain line', { start: 0, end: 10 }, [])).toEqual([{ text: 'plain line' }]);
  });

  it('links the part of a line that falls inside a range, using the line\'s own offsets', () => {
    // The text "one two three", with "two" linked; the second line is "two three" starting at offset 4.
    const ranges = [{ start: 4, end: 7, link: 'https://two.example' }];
    expect(lineSegments('two three', { start: 4, end: 13 }, ranges)).toEqual([
      { text: 'two', link: 'https://two.example' },
      { text: ' three' },
    ]);
  });

  it('keeps a list marker, which is not part of the text, as plain', () => {
    const ranges = [{ start: 0, end: 4, link: 'https://item.example' }];
    expect(lineSegments('• item', { start: 0, end: 4 }, ranges)).toEqual([
      { text: '• ' },
      { text: 'item', link: 'https://item.example' },
    ]);
  });
});

describe('text links survive a save and a load', () => {
  it('keeps a link on a text layer through a JSON round trip, and an overlapping link loses to the earlier one', async () => {
    const { createTextNode } = await import('./factory');
    const { emptyFile, validatePigmaFile } = await import('./validate');
    const file = emptyFile('Links');
    const page = file.document.children[0]!;
    const text = createTextNode(null, 0, 0, 'Read the docs');
    text.textRanges = [{ start: 9, end: 13, link: 'https://docs.example' }, { start: 12, end: 99, link: 'https://past.example' }];
    page.children = [text];
    const loaded = validatePigmaFile(JSON.parse(JSON.stringify(file)));
    const node = loaded.file!.document.children[0]!.children[0]! as { textRanges?: unknown[] };
    expect(node.textRanges).toEqual([{ start: 9, end: 13, link: 'https://docs.example' }]);
  });
});

describe('a bold part of a line', () => {
  it('lists only the ranges that set a weight, as the runs layout measures', () => {
    expect(
      weightRunsOf([
        { start: 0, end: 3, link: 'https://x.example' },
        { start: 4, end: 7, fontWeight: 700 },
        { start: 8, end: 9, link: 'https://y.example', fontWeight: 600 },
      ]),
    ).toEqual([
      { start: 4, end: 7, fontWeight: 700 },
      { start: 8, end: 9, fontWeight: 600 },
    ]);
  });

  it('carries its weight on its segment, and a segment with neither stays plain', () => {
    expect(textSegments('one two', [{ start: 4, end: 7, fontWeight: 700 }])).toEqual([
      { text: 'one ' },
      { text: 'two', fontWeight: 700 },
    ]);
  });

  it('is split out of a wrapped line, using the line\'s own offsets', () => {
    // The second line is "two three", starting at offset 4; only "two" is bold.
    expect(lineSegments('two three', { start: 4, end: 13 }, [{ start: 4, end: 7, fontWeight: 700 }])).toEqual([
      { text: 'two', fontWeight: 700 },
      { text: ' three' },
    ]);
  });

  it('keeps the link and the weight of a part that has both', () => {
    expect(lineSegments('two', { start: 4, end: 7 }, [{ start: 4, end: 7, link: 'https://two.example', fontWeight: 700 }])).toEqual([
      { text: 'two', link: 'https://two.example', fontWeight: 700 },
    ]);
  });
});

describe('setting and clearing bold on a span', () => {
  it('bolds a span inside a link and keeps the link on it', () => {
    expect(setTextWeight([{ start: 0, end: 10, link: 'https://x.example' }], 3, 6, 700, 10)).toEqual([
      { start: 0, end: 3, link: 'https://x.example' },
      { start: 3, end: 6, link: 'https://x.example', fontWeight: 700 },
      { start: 6, end: 10, link: 'https://x.example' },
    ]);
  });

  it('clears the bold of a span and leaves a link and the bold around it', () => {
    expect(setTextWeight([{ start: 0, end: 10, link: 'https://x.example', fontWeight: 700 }], 3, 6, null, 10)).toEqual([
      { start: 0, end: 3, link: 'https://x.example', fontWeight: 700 },
      { start: 3, end: 6, link: 'https://x.example' },
      { start: 6, end: 10, link: 'https://x.example', fontWeight: 700 },
    ]);
  });

  it('clearing a link on bold text keeps the bold', () => {
    expect(setTextLink([{ start: 0, end: 10, link: 'https://x.example', fontWeight: 700 }], 0, 10, null, 10)).toEqual([
      { start: 0, end: 10, fontWeight: 700 },
    ]);
  });

  it('bolds plain characters, and a span that is not bold stays as it was', () => {
    expect(setTextWeight([], 0, 4, 600, 10)).toEqual([{ start: 0, end: 4, fontWeight: 600 }]);
    expect(setTextWeight([{ start: 0, end: 4, fontWeight: 600 }], 0, 4, null, 10)).toEqual([]);
  });
});

describe('the Cmd/Ctrl+B toggle on a selection', () => {
  it('bolds a selection with any plain character, and clears one that is all bold', () => {
    expect(boldToggleWeight([], 0, 4, 400)).toBe(700);
    expect(boldToggleWeight([{ start: 0, end: 2, fontWeight: 700 }], 0, 4, 400)).toBe(700);
    expect(boldToggleWeight([{ start: 0, end: 4, fontWeight: 700 }], 1, 3, 400)).toBeNull();
  });

  it('makes a bold layer plain with an explicit weight, since clearing would leave it bold', () => {
    expect(boldToggleWeight([], 0, 4, 700)).toBe(400);
    expect(boldToggleWeight([{ start: 0, end: 4, fontWeight: 400 }], 0, 4, 700)).toBe(700);
  });
});
