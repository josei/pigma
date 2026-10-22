import { describe, expect, it } from 'vitest';
import { linkBoxesOf, textRangesFromLinkBoxes } from './textLinkBoxes';
import { createTextNode } from './factory';
import { measureLine } from '../render/textMetrics';
import type { TextNode, TextRange } from './types';

function textWith(characters: string, ranges: TextRange[], style: Partial<TextNode['style']> = {}, width = 400): TextNode {
  const node = createTextNode(null, 0, 0, characters);
  node.width = width;
  node.style = { ...node.style, ...style };
  node.textRanges = ranges;
  return node;
}

const asFileBoxes = (node: TextNode) => linkBoxesOf(node).map((box) => ({ bounds: box.bounds, url: box.link }));

describe('hyperlink boxes', () => {
  it('places a box over the linked word, at the width the word measures', () => {
    const node = textWith('Read the docs', [{ start: 9, end: 13, link: 'https://docs.example' }]);
    const [box] = linkBoxesOf(node);
    expect(box).toMatchObject({ start: 9, end: 13, link: 'https://docs.example' });
    expect(box!.bounds.x).toBeCloseTo(measureLine('Read the ', node.style), 3);
    expect(box!.bounds.width).toBeCloseTo(measureLine('docs', node.style), 3);
  });

  it('reads the boxes back to the same word ranges', () => {
    const node = textWith('Read the docs and the code', [
      { start: 9, end: 13, link: 'https://docs.example' },
      { start: 22, end: 26, link: 'https://code.example' },
    ]);
    const read = textRangesFromLinkBoxes(node, asFileBoxes(node));
    expect(read).toEqual([
      { start: 9, end: 13, link: 'https://docs.example' },
      { start: 22, end: 26, link: 'https://code.example' },
    ]);
  });

  it('reads back links on wrapped lines, where the rectangles are on different lines', () => {
    const node = textWith(
      'alpha beta gamma delta epsilon zeta eta theta iota kappa',
      [
        { start: 0, end: 5, link: 'https://a.example' },
        { start: 51, end: 56, link: 'https://k.example' },
      ],
      { textAutoResize: 'HEIGHT' },
      70,
    );
    const boxes = linkBoxesOf(node);
    expect(new Set(boxes.map((box) => box.bounds.y)).size).toBeGreaterThan(1);
    expect(textRangesFromLinkBoxes(node, asFileBoxes(node))).toEqual(node.textRanges);
  });

  it('gives no boxes for truncated text, or for a text with no links', () => {
    const truncated = textWith('Read the docs', [{ start: 9, end: 13, link: 'https://docs.example' }], { textAutoResize: 'TRUNCATE' });
    expect(linkBoxesOf(truncated)).toEqual([]);
    expect(linkBoxesOf(textWith('Read the docs', []))).toEqual([]);
  });

  it('moves a box with centred text', () => {
    const left = textWith('docs', [{ start: 0, end: 4, link: 'https://d.example' }], { textAlignHorizontal: 'LEFT' }, 200);
    const centred = textWith('docs', [{ start: 0, end: 4, link: 'https://d.example' }], { textAlignHorizontal: 'CENTER' }, 200);
    const leftX = linkBoxesOf(left)[0]!.bounds.x;
    const centredX = linkBoxesOf(centred)[0]!.bounds.x;
    expect(centredX - leftX).toBeCloseTo((200 - measureLine('docs', centred.style)) / 2, 3);
  });
});
