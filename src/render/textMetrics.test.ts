import { describe, expect, it } from 'vitest';
import type { TextStyle } from '../model/types';
import { layoutText } from './textMetrics';

const style: TextStyle = { fontFamily: 'Inter', fontSize: 14, lineHeight: { unit: 'PERCENT', value: 120 } };

describe('text lists', () => {
  it('leaves paragraphs alone without a list', () => {
    expect(layoutText('one\ntwo', style).lines).toEqual(['one', 'two']);
  });

  it('puts a bullet in front of each non-empty paragraph', () => {
    expect(layoutText('one\n\ntwo', { ...style, listType: 'UNORDERED' }).lines).toEqual(['• one', '', '• two']);
  });

  it('numbers only the paragraphs that carry text', () => {
    expect(layoutText('one\n\ntwo', { ...style, listType: 'ORDERED' }).lines).toEqual(['1. one', '', '2. two']);
  });

  it('measures the marker, so an auto-width box fits it', () => {
    const plain = layoutText('one', style).width;
    const listed = layoutText('one', { ...style, listType: 'ORDERED' }).width;
    expect(listed).toBeGreaterThan(plain);
  });
});
