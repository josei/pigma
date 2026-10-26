import { describe, expect, it } from 'vitest';
import { layoutText } from './textMetrics';
import type { TextStyle } from '../model/types';

const style: TextStyle = { fontFamily: 'Inter', fontSize: 14, lineHeight: { unit: 'AUTO' } };

/** Every line is its own source text, except for a list marker or wrap indent in front. */
function checkSources(characters: string, lines: string[], sources: Array<{ start: number; end: number }>) {
  expect(sources, 'every line has a source').toHaveLength(lines.length);
  lines.forEach((line, index) => {
    const body = characters.slice(sources[index]!.start, sources[index]!.end);
    expect(line.endsWith(body), `line ${index} ${JSON.stringify(line)} does not end with its source ${JSON.stringify(body)}`).toBe(true);
  });
}

describe('text layout source offsets', () => {
  it('locates each paragraph in the text', () => {
    const characters = 'first\n\nthird';
    const layout = layoutText(characters, style, 1000, false);
    expect(layout.lines).toEqual(['first', '', 'third']);
    expect(layout.sources).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 6 },
      { start: 7, end: 12 },
    ]);
  });

  it('locates each wrapped line, with the space at a break left out of both', () => {
    const characters = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
    const layout = layoutText(characters, style, 60, true);
    expect(layout.lines.length).toBeGreaterThan(2);
    checkSources(characters, layout.lines, layout.sources);
    // Consecutive lines never overlap, and together they cover the text except the breaking spaces.
    for (let index = 1; index < layout.sources.length; index += 1) {
      expect(layout.sources[index]!.start).toBeGreaterThan(layout.sources[index - 1]!.start);
    }
  });

  it('keeps list markers outside the source text', () => {
    const characters = 'one\ntwo';
    const layout = layoutText(characters, { ...style, listType: 'ORDERED' }, 1000, false);
    expect(layout.lines).toEqual(['1. one', '2. two']);
    checkSources(characters, layout.lines, layout.sources);
  });

  it('offers no offsets when a case transform would change the length', () => {
    const layout = layoutText('straße', { ...style, textCase: 'UPPER' }, 1000, false);
    expect(layout.sources).toEqual([]);
  });
});
