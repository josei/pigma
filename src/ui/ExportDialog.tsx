import { useEditor, type ExportFormat } from '../store/editorStore';
import { useEscapeToClose } from './useEscapeToClose';

const SCALES = [1, 2, 3, 4];

const FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'svg', label: 'SVG' },
  { value: 'pdf', label: 'PDF' },
];

/**
 * The export panel (M16, extended): one place to choose a format, a scope and, for PNG,
 * a scale and background. Export dispatches the event the quick menu entries use, so the
 * panel and the menu share one implementation for each format.
 */
export function ExportDialog() {
  const options = useEditor((state) => state.exportOptions);
  const setExportOptions = useEditor((state) => state.setExportOptions);
  // Hooks must run before the early return, or opening the dialog reorders them.
  const selection = useEditor((state) => state.selection);
  const close = () => setExportOptions({ open: false });
  useEscapeToClose(options.open, close);
  if (!options.open) return null;

  const hasSelection = selection.length > 0;
  // PDF is written for the whole page, and so is anything exported with nothing selected: a
  // stale 'selection' scope must not survive into a panel that has no selection to export.
  const scopeFor = (format: ExportFormat) => (format === 'pdf' || !hasSelection ? 'page' : options.scope);
  const exportNow = () => {
    const scope = scopeFor(options.format);
    if (options.format === 'png') {
      window.dispatchEvent(
        new CustomEvent('pigma:export-png', {
          detail: { scale: options.scale, transparent: options.transparent, scope },
        }),
      );
    } else if (options.format === 'svg') {
      window.dispatchEvent(new Event(scope === 'selection' ? 'pigma:export-selection-svg' : 'pigma:export-svg'));
    } else {
      window.dispatchEvent(new Event('pigma:export-pdf'));
    }
    setExportOptions({ open: false });
  };

  const description =
    options.format === 'pdf'
      ? 'Writes every layer on the current page as vector paths.'
      : options.format === 'svg'
        ? options.scope === 'selection'
          ? 'Writes only the selected layers as vector paths.'
          : 'Writes every layer on the current page as vector paths.'
        : options.scope === 'selection'
          ? 'Exports only the selected layers.'
          : 'Exports every layer on the current page.';

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Export options">
      <div className="modal__backdrop" onClick={() => setExportOptions({ open: false })} />
      <div className="modal__card">
        <div className="modal__title">Export</div>
        <div className="modal__body">
          <div className="prop-row">
            <span className="prop-row__label">Format</span>
            <select
              className="input"
              aria-label="Export format"
              value={options.format}
              onChange={(event) => setExportOptions({ format: event.target.value as ExportFormat })}
            >
              {FORMATS.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label}
                </option>
              ))}
            </select>
          </div>
          <div className="prop-row">
            <span className="prop-row__label">Scope</span>
            <select
              className="input"
              aria-label="Export scope"
              value={scopeFor(options.format)}
              onChange={(event) => setExportOptions({ scope: event.target.value as 'selection' | 'page' })}
            >
              <option value="page">Whole page</option>
              <option value="selection" disabled={!hasSelection || options.format === 'pdf'}>
                {options.format === 'pdf'
                  ? 'Selection (PDF is whole page)'
                  : `Selection${hasSelection ? '' : ' (nothing selected)'}`}
              </option>
            </select>
          </div>
          {options.format === 'png' ? (
            <>
              <div className="prop-row">
                <span className="prop-row__label">Scale</span>
                <select
                  className="input"
                  aria-label="PNG scale"
                  value={options.scale}
                  onChange={(event) => setExportOptions({ scale: Number(event.target.value) })}
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
                    onChange={(event) => setExportOptions({ transparent: event.target.checked })}
                  />
                  Transparent background
                </label>
              </div>
            </>
          ) : null}
          <p style={{ margin: '6px 0 0', color: 'var(--figma-text-secondary)' }}>{description}</p>
        </div>
        <div className="modal__actions">
          <button type="button" className="button" onClick={() => setExportOptions({ open: false })}>
            Cancel
          </button>
          <button type="button" className="button button--primary" aria-label="Export now" onClick={exportNow}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
