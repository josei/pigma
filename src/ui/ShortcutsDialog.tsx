import { useEditor } from '../store/editorStore';
import { useEscapeToClose } from './useEscapeToClose';
import { SHORTCUT_GROUPS } from './shortcutList';

/** The keyboard shortcut reference, opened with ⇧⌘/ or from the Help group of the main menu. */
export function ShortcutsDialog() {
  const open = useEditor((state) => state.shortcutsOpen);
  const setOpen = useEditor((state) => state.setShortcutsOpen);
  useEscapeToClose(open, () => setOpen(false));
  if (!open) return null;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="modal__backdrop" onClick={() => setOpen(false)} />
      <div className="modal__card" style={{ maxWidth: 560, maxHeight: '80vh', overflow: 'auto' }}>
        <div className="modal__title">Keyboard shortcuts</div>
        <div className="modal__body">
          <p style={{ margin: '0 0 10px', color: 'var(--figma-text-secondary)' }}>⌘ is Ctrl on Windows and Linux.</p>
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} style={{ marginBottom: 12 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--figma-text-secondary)' }}>{group.title}</h3>
              {group.rows.map((row) => (
                <div key={row.label} className="prop-row" style={{ justifyContent: 'space-between' }}>
                  <span>{row.label}</span>
                  <kbd>{row.keys}</kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="modal__actions">
          <button type="button" className="button button--primary" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
