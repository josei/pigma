import { useEditor } from '../store/editorStore';

const SCALES = [1, 2, 3, 4];

/**
 * PNG export options (M16): a scale selector and a transparent-background switch.
 * Exporting dispatches the same event the quick menu entries use, so both paths
 * share one implementation.
 */
export function ExportPngDialog() {
  const options = useEditor((state) => state.pngOptions);
  const setPngOptions = useEditor((state) => state.setPngOptions);
  // Hooks must run before the early return, or opening the dialog reorders them.
  const selection = useEditor((state) => state.selection);
  if (!options.open) return null;
  const hasSelection = selection.length > 0;
  const exportNow = () => {
    window.dispatchEvent(
      new CustomEvent('pigma:export-png', {
        detail: { scale: options.scale, transparent: options.transparent, scope: options.scope },
      }),
    );
    setPngOptions({ open: false });
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="PNG export options">
      <div className="modal__backdrop" onClick={() => setPngOptions({ open: false })} />
      <div className="modal__card">
        <div className="modal__title">Export PNG</div>
        <div className="modal__body">
          <div className="prop-row">
            <span className="prop-row__label">Scope</span>
            <select
              className="input"
              aria-label="PNG scope"
              value={options.scope}
              onChange={(event) => setPngOptions({ scope: event.target.value as 'selection' | 'page' })}
            >
              <option value="page">Whole page</option>
              <option value="selection" disabled={!hasSelection}>
                Selection{hasSelection ? '' : ' (nothing selected)'}
              </option>
            </select>
          </div>
          <div className="prop-row">
            <span className="prop-row__label">Scale</span>
            <select
              className="input"
              aria-label="PNG scale"
              value={options.scale}
              onChange={(event) => setPngOptions({ scale: Number(event.target.value) })}
            >
              {SCALES.map((scale) => (
                <option key={scale} value={scale}>
                  {scale}x
                </option>
              ))}
            </select>
          </div>
          <div className="prop-row">
            <label className="prop-row__label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                aria-label="Transparent background"
                checked={options.transparent}
                onChange={(event) => setPngOptions({ transparent: event.target.checked })}
              />
              Transparent background
            </label>
          </div>
          <p style={{ margin: '6px 0 0', color: 'var(--figma-text-secondary)' }}>
            {options.scope === 'selection'
              ? 'Exports only the selected layers.'
              : 'Exports every layer on the current page.'}
          </p>
        </div>
        <div className="modal__actions">
          <button type="button" className="button" onClick={() => setPngOptions({ open: false })}>
            Cancel
          </button>
          <button type="button" className="button button--primary" aria-label="Export PNG now" onClick={exportNow}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
