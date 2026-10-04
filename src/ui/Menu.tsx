import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';
import { useEditor } from '../store/editorStore';
import { runFileAction, type FileAction } from './FileActions';

interface MenuItem {
  label: string;
  icon: IconName;
  shortcut?: string;
  action?: FileAction;
  run?: () => void;
}

const ITEMS: MenuItem[] = [
  { label: 'New file', icon: 'file', run: () => useEditor.getState().newFile() },
  { label: 'Open starter design', icon: 'frame', run: () => useEditor.getState().loadStarterDocument() },
  { label: 'Import Pigma document…', icon: 'file', action: 'import-json' },
  { label: 'Import Figma JSON…', icon: 'file', action: 'import-figma-json' },
  { label: 'Import .fig…', icon: 'file', action: 'import-fig' },
  { label: 'Place image…', icon: 'rect', action: 'place-image' },
  { label: 'Open file…', icon: 'file', action: 'open-file' },
  { label: 'Save to file', icon: 'check', action: 'save-file' },
  { label: 'Save to file as…', icon: 'duplicate', action: 'save-file-as' },
  { label: 'Export .pigma', icon: 'duplicate', action: 'export-json' },
  { label: 'Copy link to this document…', icon: 'link', run: () => useEditor.getState().setShareLinkOpen(true) },
  { label: 'Export SVG', icon: 'duplicate', action: 'export-svg' },
  { label: 'Export selection as SVG', icon: 'duplicate', action: 'export-selection-svg' },
  { label: 'Export selection as PNG…', icon: 'duplicate', action: 'export-selection-png-options' },
  { label: 'Copy as PNG', icon: 'copy', action: 'copy-png' },
  { label: 'Export PNG…', icon: 'duplicate', action: 'export-png-options' },
  { label: 'Export PNG 1x', icon: 'duplicate', action: 'export-png-1x' },
  { label: 'Export PNG 2x', icon: 'duplicate', action: 'export-png-2x' },
  { label: 'Export PNG 3x', icon: 'duplicate', action: 'export-png-3x' },
  { label: 'Export PDF', icon: 'duplicate', action: 'export-pdf' },
  { label: 'Copy as SVG', icon: 'copy', action: 'copy-svg' },
  { label: 'Copy as CSS', icon: 'copy', action: 'copy-css' },
  { label: 'Zoom to fit', icon: 'fit', shortcut: '⇧1', run: () => useEditor.getState().zoomToFit() },
  { label: 'Zoom to 100%', icon: 'fit', shortcut: '⇧0', run: () => useEditor.getState().zoomTo(1) },
  { label: 'Show rulers', icon: 'line', shortcut: '⇧R', run: () => useEditor.getState().toggleRulers() },
  { label: 'Show pixel grid', icon: 'rect', shortcut: '⇧G', run: () => useEditor.getState().toggleGrid() },
  { label: 'Snap to pixel grid', icon: 'rect', shortcut: '⇧X', run: () => useEditor.getState().toggleSnapToGrid() },
  { label: 'Present', icon: 'play', shortcut: '⌘\\', run: () => useEditor.getState().setPresentation(true) },
  { label: 'Toggle dark theme', icon: 'eye', shortcut: '⇧D', run: () => useEditor.getState().toggleTheme() },
  { label: 'Plugins…', icon: 'instance', run: () => useEditor.getState().setLeftTab('plugins') },
];

/** Main menu, opened from the toolbar or the left panel's File section. */
export function Menu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const toggle = () => setOpen((value) => !value);
    const openIt = () => setOpen(true);
    window.addEventListener('pigma:toggle-menu', toggle);
    window.addEventListener('pigma:open-menu', openIt);
    return () => {
      window.removeEventListener('pigma:toggle-menu', toggle);
      window.removeEventListener('pigma:open-menu', openIt);
    };
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
      className="menu"
      ref={ref}
      style={{ position: 'fixed', left: '50%', bottom: 76, transform: 'translateX(-50%)', zIndex: 70, minWidth: 240 }}
    >
      {ITEMS.map((item) => (
        <button
          key={item.label}
          type="button"
          className="menu__item"
          onClick={() => {
            setOpen(false);
            if (item.action) runFileAction(item.action);
            else item.run?.();
          }}
        >
          <span className="menu__label">
            <Icon name={item.icon} size={14} /> {item.label}
          </span>
          {item.shortcut ? <span className="menu__shortcut">{item.shortcut}</span> : null}
        </button>
      ))}
    </div>
  );
}
