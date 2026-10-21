import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS } from './shortcutList';
import { MENU_ITEMS } from './Menu';

const allKeys = SHORTCUT_GROUPS.flatMap((group) => group.rows.map((row) => row.keys));

describe('keyboard shortcut reference', () => {
  it('lists every shortcut the main menu shows, so the menu and the reference cannot disagree', () => {
    const menuShortcuts = MENU_ITEMS.flatMap((item) => (item.shortcut ? [item.shortcut] : []));
    expect(menuShortcuts.length).toBeGreaterThan(0);
    for (const shortcut of menuShortcuts) {
      expect(allKeys.some((keys) => keys.split(' / ').includes(shortcut) || keys === shortcut), `${shortcut} is in the menu but not in the reference`).toBe(true);
    }
  });

  it('gives every group a title and every row a key and a label', () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.rows.length).toBeGreaterThan(0);
      for (const row of group.rows) {
        expect(row.keys.length).toBeGreaterThan(0);
        expect(row.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('opens from the Help group of the main menu, with the same shortcut as the keyboard', () => {
    const help = MENU_ITEMS.find((item) => item.label === 'Keyboard shortcuts…');
    expect(help?.group).toBe('Help');
    expect(help?.shortcut).toBe('⇧⌘/');
  });
});
