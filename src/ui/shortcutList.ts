/**
 * The keyboard shortcut reference (Figma's shortcut panel). Every shortcut the editor binds is listed here,
 * in the same glyphs the main menu uses. ⌘ is Ctrl on Windows and Linux. The keyboard handler is
 * useKeyboardShortcuts.ts: a shortcut added there belongs here too, and MENU_ITEMS in Menu.tsx is checked
 * against this list (shortcutList.test.ts).
 */
export interface ShortcutRow {
  keys: string;
  label: string;
}

export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Tools',
    rows: [
      { keys: 'V', label: 'Move' },
      { keys: 'H', label: 'Hand (pan)' },
      { keys: 'F', label: 'Frame' },
      { keys: 'R', label: 'Rectangle' },
      { keys: 'O', label: 'Ellipse' },
      { keys: 'G', label: 'Polygon' },
      { keys: 'S', label: 'Star' },
      { keys: 'L', label: 'Line' },
      { keys: 'T', label: 'Text' },
      { keys: 'P', label: 'Pen' },
      { keys: 'C', label: 'Comment' },
    ],
  },
  {
    title: 'Edit',
    rows: [
      { keys: '⌘Z / ⇧⌘Z / ⌘Y', label: 'Undo / redo' },
      { keys: 'Delete / Backspace', label: 'Delete the selection (an anchor, while editing a vector)' },
      { keys: '⌘C / ⌘X / ⌘V', label: 'Copy / cut / paste' },
      { keys: '⇧⌘V', label: 'Paste over selection' },
      { keys: '⇧⌘R', label: 'Paste to replace' },
      { keys: '⌘D', label: 'Duplicate' },
      { keys: '⌘A', label: 'Select all' },
      { keys: '⌘⌥C / ⌘⌥V', label: 'Copy / paste properties' },
      { keys: '⌘⌥K', label: 'Create component' },
      { keys: '⌘⌥B', label: 'Detach instance' },
      { keys: '⌘⌥M', label: 'Use as mask' },
      { keys: '⌘⌥G', label: 'Frame selection' },
    ],
  },
  {
    title: 'Arrange',
    rows: [
      { keys: '⌘G / ⇧⌘G', label: 'Group / ungroup' },
      { keys: '⌘E', label: 'Flatten to one path' },
      { keys: '⇧⌘H / ⇧⌘L', label: 'Hide / lock the selection' },
      { keys: '⌘] / ⌘[', label: 'Bring forward / send backward' },
      { keys: '⇧⌘] / ⇧⌘[', label: 'Bring to front / send to back' },
      { keys: '⌥A ⌥H ⌥D ⌥W ⌥V ⌥S', label: 'Align left, centre, right, top, middle, bottom' },
    ],
  },
  {
    title: 'Selection and movement',
    rows: [
      { keys: 'Arrows', label: 'Nudge 1 px' },
      { keys: '⇧ Arrows', label: 'Nudge 10 px' },
      { keys: 'Enter', label: 'Select the children of a group or frame' },
      { keys: '⇧Enter', label: 'Select the parent' },
      { keys: 'Tab / ⇧Tab', label: 'Select the next / previous sibling' },
      { keys: 'Ctrl+Space', label: 'Keyboard box select (Enter to select, Esc to cancel)' },
      { keys: 'Esc', label: 'Clear the selection or close the open panel' },
    ],
  },
  {
    title: 'View',
    rows: [
      { keys: '⇧1', label: 'Zoom to fit' },
      { keys: '⇧2', label: 'Zoom to selection' },
      { keys: '⇧0', label: 'Zoom to 100%' },
      { keys: '⌘+ / ⌘-', label: 'Zoom in / out' },
      { keys: '⇧R', label: 'Show rulers' },
      { keys: "⌘'", label: 'Show pixel grid' },
      { keys: "⇧⌘'", label: 'Snap to pixel grid' },
      { keys: 'F6', label: 'Focus the tools toolbar' },
      { keys: '⇧D', label: 'Dev Mode' },
      { keys: '⌘\\', label: 'Present' },
    ],
  },
  {
    title: 'Export',
    rows: [{ keys: '⇧⌘E', label: 'Export options for the selection' }],
  },
  {
    title: 'Help',
    rows: [{ keys: '⇧⌘/', label: 'Keyboard shortcuts' }],
  },
];
