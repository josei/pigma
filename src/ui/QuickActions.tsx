import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { MENU_ITEMS, runMenuItem } from './Menu';
import { documentQuickActions, matchQuickActions } from './matchQuickActions';
import { useEscapeToClose } from './useEscapeToClose';

/**
 * Quick actions (Cmd/Ctrl+/): a search over the main menu's commands, the layers on every page, and the pages.
 * Type a word, move with the arrow keys, and Enter runs the highlighted entry. The commands are the menu's own
 * entries, so the palette cannot offer a command the menu does not have; a layer or page entry selects or opens it.
 */
export function QuickActions() {
  const open = useEditor((state) => state.quickActionsOpen);
  const setOpen = useEditor((state) => state.setQuickActionsOpen);
  const file = useEditor((state) => state.file);
  const pageId = useEditor((state) => state.pageId);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEscapeToClose(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const entries = [
    ...MENU_ITEMS,
    ...documentQuickActions(file, pageId, {
      selectLayer: (id, onPage) => {
        if (onPage !== useEditor.getState().pageId) useEditor.getState().setPage(onPage);
        useEditor.getState().select([id], 'replace');
      },
      openPage: (id) => useEditor.getState().setPage(id),
    }),
  ];
  const matches = matchQuickActions(entries, query);
  const run = (position: number) => {
    const item = matches[position];
    if (!item) return;
    setOpen(false);
    runMenuItem(item);
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Quick actions">
      <div className="modal__backdrop" onClick={() => setOpen(false)} />
      <div className="modal__card" style={{ maxWidth: 480 }}>
        <input
          ref={inputRef}
          className="input"
          aria-label="Search quick actions"
          placeholder="Type a command"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              run(index);
            }
          }}
        />
        <div role="listbox" aria-label="Matching commands" style={{ marginTop: 8 }}>
          {query.trim() === '' ? (
            <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>Type a word to find a command.</p>
          ) : matches.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>No command matches “{query.trim()}”.</p>
          ) : (
            matches.map((item, position) => (
              <button
                key={`${position}-${item.label}`}
                type="button"
                role="option"
                aria-selected={position === index}
                className={position === index ? 'menu__item menu__item--active' : 'menu__item'}
                onMouseEnter={() => setIndex(position)}
                onClick={() => run(position)}
              >
                <span className="menu__label">{item.label}</span>
                {item.shortcut ? <span className="menu__shortcut">{item.shortcut}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
