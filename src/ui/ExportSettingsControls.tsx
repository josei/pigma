import type { BaseNode, ExportSetting } from '../model/types';
import { useEditor } from '../store/editorStore';
import { exportLayerSettings } from './FileActions';

const SCALES = [1, 2, 3, 4];

/**
 * The Export section of the properties panel (Figma's Export section): a list of formats, each with a scale and
 * a suffix, exported together with the Export button. PDF is page-level, so it is not offered here.
 */
export function ExportSettingsControls({ node }: { node: BaseNode }) {
  const updateSelected = useEditor((state) => state.updateSelected);
  // The panel writes to every selected layer, so Export exports every selected layer.
  const selection = useEditor((state) => state.selection);
  const settings = node.exportSettings ?? [];
  const write = (next: ExportSetting[]) => updateSelected({ exportSettings: next }, 'Change export settings');
  const patch = (index: number, change: Partial<ExportSetting>) =>
    write(settings.map((setting, position) => (position === index ? { ...setting, ...change } : setting)));

  return (
    <div className="prop-stack">
      <div className="prop-row">
        <span className="prop-row__label">Export</span>
        <button
          type="button"
          className="button"
          aria-label="Add export setting"
          onClick={() => write([...settings, { format: 'PNG', scale: 1, suffix: '' }])}
        >
          +
        </button>
      </div>
      {settings.map((setting, index) => (
        <div className="prop-row" key={index}>
          <select
            className="input"
            aria-label="Export format"
            value={setting.format}
            onChange={(event) => patch(index, { format: event.target.value as ExportSetting['format'] })}
          >
            <option value="PNG">PNG</option>
            <option value="SVG">SVG</option>
          </select>
          {setting.format === 'PNG' ? (
            <select
              className="input"
              aria-label="Export scale"
              value={setting.scale}
              onChange={(event) => patch(index, { scale: Number(event.target.value) })}
            >
              {SCALES.map((scale) => (
                <option key={scale} value={scale}>
                  {scale}x
                </option>
              ))}
            </select>
          ) : null}
          <input
            className="input"
            aria-label="Export suffix"
            placeholder="Suffix"
            value={setting.suffix}
            onChange={(event) => patch(index, { suffix: event.target.value })}
          />
          <button
            type="button"
            className="button"
            aria-label="Remove export setting"
            onClick={() => write(settings.filter((_, position) => position !== index))}
          >
            −
          </button>
        </div>
      ))}
      {settings.length > 0 ? (
        <div className="prop-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="button button--primary" onClick={() => exportLayerSettings(selection)}>
            Export {settings.length === 1 ? '1 file' : `${settings.length} files`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
