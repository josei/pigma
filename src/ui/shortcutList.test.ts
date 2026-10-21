import { readFileSync } from 'node:fs';
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

/**
 * The keys the handler binds, read from its source. A key bound there but absent from the reference is a
 * shortcut a designer can press and never find. This is a guard on the source text, so a rename of the
 * handler's style would need this list updated with it.
 * It checks the key alone, not the modifier: a key shown with the wrong modifier still passes. The modifier
 * rows are reviewed by hand against the handler.
 */
function boundKeys(): Set<string> {
  const source = readFileSync(new URL('../hooks/useKeyboardShortcuts.ts', import.meta.url), 'utf8');
  const keys = new Set<string>();
  const named: Record<string, string> = {
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Slash: '/',
    Space: 'Space',
  };
  for (const [, code] of source.matchAll(/event\.code === '(\w+)'/g)) {
    const letter = /^Key([A-Z])$/.exec(code!);
    const digit = /^Digit(\d)$/.exec(code!);
    if (letter) keys.add(letter[1]!);
    else if (digit) keys.add(digit[1]!);
    else if (named[code!]) keys.add(named[code!]!);
  }
  for (const [, key] of source.matchAll(/event\.key\.toLowerCase\(\) === '(\w)'/g)) keys.add(key!.toUpperCase());
  for (const [, key] of source.matchAll(/event\.key === '(Enter|Tab|Delete|Backspace|F6)'/g)) keys.add(key!);
  if (/event\.key === 'Escape'/.test(source)) keys.add('Esc');
  for (const [, key] of source.matchAll(/^\s+([a-z]): '\w+',$/gm)) keys.add(key!.toUpperCase());
  return keys;
}

/** The single keys a reference row names, with the modifier glyphs and the words Ctrl and Shift removed. */
function referenceTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const keys of allKeys) {
    for (const part of keys.split(' / ')) {
      for (const piece of part.split(/\s+/)) {
        const bare = piece.replace(/[⌘⇧⌥⌃]/g, '');
        for (const token of bare.split('+')) {
          if (token) tokens.add(token);
          if (token === 'Esc' || token === 'Escape') tokens.add('Esc');
        }
      }
    }
  }
  return tokens;
}

describe('every key the handler binds is in the reference', () => {
  it('finds the keys the handler binds', () => {
    expect(boundKeys().has('V')).toBe(true);
    expect(boundKeys().has('Enter')).toBe(true);
  });

  it('lists each bound key', () => {
    const tokens = referenceTokens();
    const missing = [...boundKeys()].filter((key) => !tokens.has(key)).sort();
    expect(missing, 'bound by the handler but not in the shortcut reference').toEqual([]);
  });
});
