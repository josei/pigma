import { Fragment, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';
import { useEditor } from '../store/editorStore';
import { runFileAction, type FileAction } from './FileActions';

export interface MenuItem {
  /** Starts a new visual group, with this heading. */
  group?: string;
  label: string;
  icon: IconName;
  shortcut?: string;
  action?: FileAction;
  run?: () => void;
}

/** Run a menu entry: a file action, or the entry's own command. Quick actions use the same path. */
export function runMenuItem(item: MenuItem): void {
  if (item.action) runFileAction(item.action);
  else item.run?.();
}

export const MENU_ITEMS: MenuItem[] = [
  { group: 'File', label: 'New file', icon: 'file', run: () => useEditor.getState().newFile() },
  { label: 'Open starter design', icon: 'frame', run: () => useEditor.getState().loadStarterDocument() },
  { group: 'Import', label: 'Import Pigma document…', icon: 'file', action: 'import-json' },
  { label: 'Import Figma JSON…', icon: 'file', action: 'import-figma-json' },
  { label: 'Import .fig…', icon: 'file', action: 'import-fig' },
  { label: 'Place image…', icon: 'rect', action: 'place-image' },
  { group: 'Open & save', label: 'Open file…', icon: 'file', action: 'open-file' },
  { label: 'Save to file', icon: 'check', action: 'save-file' },
  { label: 'Save to file as…', icon: 'duplicate', action: 'save-file-as' },
  { label: 'Export .pigma', icon: 'duplicate', action: 'export-json' },
  { group: 'Share', label: 'Copy link to this document…', icon: 'link', run: () => useEditor.getState().setShareLinkOpen(true) },
  { group: 'Export', label: 'Export…', icon: 'duplicate', action: 'export-options' },
  { label: 'Export SVG', icon: 'duplicate', action: 'export-svg' },
  { label: 'Export selection as SVG', icon: 'duplicate', action: 'export-selection-svg' },
  { label: 'Export selection as PNG…', icon: 'duplicate', shortcut: '⇧⌘E', action: 'export-selection-png-options' },
  { label: 'Copy as PNG', icon: 'copy', action: 'copy-png' },
  { label: 'Export PNG…', icon: 'duplicate', action: 'export-png-options' },
  { label: 'Export PDF', icon: 'duplicate', action: 'export-pdf' },
  { label: 'Copy as SVG', icon: 'copy', action: 'copy-svg' },
  { label: 'Copy as CSS', icon: 'copy', action: 'copy-css' },
  { group: 'View', label: 'Zoom to fit', icon: 'fit', shortcut: '⇧1', run: () => useEditor.getState().zoomToFit() },
  { label: 'Zoom to 100%', icon: 'fit', shortcut: '⇧0', run: () => useEditor.getState().zoomTo(1) },
  { label: 'Show rulers', icon: 'line', shortcut: '⇧R', run: () => useEditor.getState().toggleRulers() },
  // Figma puts mask outlines under View with the other view options; ours sit in
  // the same list as the rulers and the grid for the same reason.
  { label: 'Mask outlines', icon: 'mask', run: () => useEditor.getState().toggleMaskOutlines() },
  { label: 'Show pixel grid', icon: 'rect', shortcut: '⌘\'', run: () => useEditor.getState().toggleGrid() },
  { label: 'Snap to pixel grid', icon: 'rect', shortcut: '⇧⌘\'', run: () => useEditor.getState().toggleSnapToGrid() },
  { group: 'Tools', label: 'Present', icon: 'play', shortcut: '⌘\\', run: () => useEditor.getState().setPresentation(true) },
  // No shortcut: Shift+D is Dev Mode (Figma's binding), and a theme is a preference, not a command.
  { label: 'Toggle dark theme', icon: 'eye', run: () => useEditor.getState().toggleTheme() },
  { label: 'Connect AI agent…', icon: 'sparkle', run: () => useEditor.getState().setLeftTab('tools') },
  { label: 'Plugins…', icon: 'instance', run: () => useEditor.getState().setLeftTab('plugins') },
  { group: 'Help', label: 'Keyboard shortcuts…', icon: 'sparkle', shortcut: '⇧⌘/', run: () => useEditor.getState().setShortcutsOpen(true) },
];

/** Main menu, opened from the toolbar's menu button (`pigma:toggle-menu`). */
export function Menu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // ONE event, and it has a dispatcher: the toolbar's menu button. There used to
    // be a second listener (`pigma:open-menu`) with ZERO dispatchers in the repo,
    // and a comment claiming the left panel's File section opened the menu — which
    // it does not. A listener nothing fires and a comment describing behaviour that
    // does not exist are both defects; both are gone.
    const toggle = () => setOpen((value) => !value);
    window.addEventListener('pigma:toggle-menu', toggle);
    return () => window.removeEventListener('pigma:toggle-menu', toggle);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="menu menu--main"
      ref={ref}
      role="menu"
      aria-label="Main menu"
    >
      {MENU_ITEMS.map((item) => (
        <Fragment key={item.label}>
        {item.group ? <div className="menu__heading">{item.group}</div> : null}
        <button
          type="button"
          role="menuitem"
          className="menu__item"
          onClick={() => {
            setOpen(false);
            runMenuItem(item);
          }}
        >
          <span className="menu__label">
            <Icon name={item.icon} size={14} /> {item.label}
          </span>
          {item.shortcut ? <span className="menu__shortcut">{item.shortcut}</span> : null}
        </button>
        </Fragment>
      ))}
    </div>
  );
}
