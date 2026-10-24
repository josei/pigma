import { describe, expect, it } from 'vitest';
import { documentQuickActions, matchQuickActions } from './matchQuickActions';
import type { MenuItem } from './Menu';
import { createFrameNode, createRectNode } from '../model/factory';
import { emptyFile } from '../model/validate';

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

describe('document entries in quick actions', () => {
  /** A page with a frame holding a badge, and a second page with nothing on it. */
  function twoPageFile() {
    const file = emptyFile('Doc');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 400, 400, { name: 'Hero' });
    const badge = createRectNode(null, 10, 10, 40, 40);
    badge.name = 'Badge';
    frame.children = [badge];
    page.children = [frame];
    const second = { ...page, id: 'page-2', name: 'Page 2', children: [] };
    return { file: { ...file, document: { ...file.document, children: [page, second] } }, page, frame, badge };
  }

  it('lists each layer on the current page, including nested ones, and each page', () => {
    const { file, page } = twoPageFile();
    const labels = documentQuickActions(file, page.id, { selectLayer: () => undefined, openPage: () => undefined }).map((item) => item.label);
    expect(labels).toEqual(['Layer: Hero', 'Layer: Badge', 'Page: Page 1', 'Page: Page 2']);
  });

  it('selects the layer and opens the page an entry names when it runs', () => {
    const { file, page, frame } = twoPageFile();
    const selected: string[] = [];
    const opened: string[] = [];
    const items = documentQuickActions(file, page.id, { selectLayer: (id) => selected.push(id), openPage: (id) => opened.push(id) });
    items.find((item) => item.label === 'Layer: Hero')!.run!();
    items.find((item) => item.label === 'Page: Page 2')!.run!();
    expect(selected).toEqual([frame.id]);
    expect(opened).toEqual(['page-2']);
  });

  it('matches a layer by its name, the same way as a command', () => {
    const { file, page } = twoPageFile();
    const items = documentQuickActions(file, page.id, { selectLayer: () => undefined, openPage: () => undefined });
    expect(matchQuickActions(items, 'badge').map((item) => item.label)).toEqual(['Layer: Badge']);
    expect(matchQuickActions(items, 'page 2').map((item) => item.label)).toEqual(['Page: Page 2']);
  });
});
