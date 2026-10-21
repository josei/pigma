import { describe, expect, it } from 'vitest';
import { matchQuickActions } from './quickActions';
import type { MenuItem } from './Menu';

const items: MenuItem[] = [
  { label: 'Export PNG…', icon: 'duplicate', run: () => undefined },
  { label: 'Export SVG', icon: 'duplicate', run: () => undefined },
  { label: 'Zoom to fit', icon: 'fit', run: () => undefined },
  { label: 'Show rulers', icon: 'line', run: () => undefined },
];

describe('quick actions matching', () => {
  it('matches every typed word in a label, ignoring case', () => {
    expect(matchQuickActions(items, 'EXPORT png').map((item) => item.label)).toEqual(['Export PNG…']);
  });

  it('keeps the menu order and matches several entries', () => {
    expect(matchQuickActions(items, 'export').map((item) => item.label)).toEqual(['Export PNG…', 'Export SVG']);
  });

  it('matches nothing for an empty or blank query', () => {
    expect(matchQuickActions(items, '')).toEqual([]);
    expect(matchQuickActions(items, '   ')).toEqual([]);
  });

  it('matches nothing when a word is missing from the label', () => {
    expect(matchQuickActions(items, 'zoom rulers')).toEqual([]);
  });

  it('caps the results at the limit', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ label: `Item ${index}`, icon: 'rect' as const, run: () => undefined }));
    expect(matchQuickActions(many, 'item', 12)).toHaveLength(12);
  });
});
