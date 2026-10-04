import { useState } from 'react';
import { Icon } from './icons';
import { useEditor } from '../store/editorStore';
import { DEFAULT_SOURCE, type PluginRecord } from '../plugins/registry';

/**
 * Plugins tab (M15): the installed plugins (built-ins plus user scripts) with a
 * Run action, a source editor, and the console transcript of the last run —
 * logs, warnings and errors.
 */
export function PluginsPanel() {
  const plugins = useEditor((state) => state.plugins);
  const console_ = useEditor((state) => state.pluginConsole);
  const running = useEditor((state) => state.pluginRunning);
  const runPlugin = useEditor((state) => state.runPlugin);
  const savePlugin = useEditor((state) => state.savePlugin);
  const deletePlugin = useEditor((state) => state.deletePlugin);
  const clearPluginConsole = useEditor((state) => state.clearPluginConsole);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftSource, setDraftSource] = useState('');
  const [creating, setCreating] = useState(false);

  const startEdit = (plugin: PluginRecord) => {
    setCreating(false);
    setEditing(plugin.id);
    setDraftName(plugin.name);
    setDraftSource(plugin.source);
  };

  const startCreate = () => {
    setCreating(true);
    setEditing(null);
    setDraftName('My plugin');
    setDraftSource(DEFAULT_SOURCE);
  };

  const save = () => {
    const id = creating ? savePlugin({ name: draftName, source: draftSource }) : savePlugin({ id: editing ?? undefined, name: draftName, source: draftSource });
    setCreating(false);
    setEditing(id);
  };

  const editorOpen = creating || editing !== null;

  return (
    <>
      <div className="section">
        <div className="section__header">
          <span>Plugins</span>
          <button type="button" className="icon-button" aria-label="New plugin" data-tooltip="Write a new plugin" onClick={startCreate}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        <div className="section__body">
          {plugins.map((plugin) => (
            <div key={plugin.id} className={`layer-row plugin-row${editing === plugin.id ? ' layer-row--selected' : ''}`}>
              <span className="layer-row__icon">
                <Icon name="component" size={13} />
              </span>
              <span className="layer-row__name" aria-label={`Plugin ${plugin.name}`}>
                {plugin.name}
                {plugin.builtin ? <span style={{ color: 'var(--figma-text-tertiary)' }}> · built-in</span> : null}
              </span>
              <span className="layer-row__actions">
                <button
                  type="button"
                  className="layer-row__action"
                  aria-label={`Run ${plugin.name}`}
                  data-tooltip="Run against the open document"
                  disabled={running !== null}
                  onClick={() => void runPlugin(plugin.id)}
                >
                  <Icon name={running === plugin.id ? 'instance' : 'play'} size={13} />
                </button>
                <button
                  type="button"
                  className="layer-row__action"
                  aria-label={`Edit ${plugin.name}`}
                  data-tooltip={plugin.builtin ? 'Fork and edit' : 'Edit source'}
                  onClick={() => startEdit(plugin)}
                >
                  <Icon name="pen" size={13} />
                </button>
                {plugin.builtin ? null : (
                  <button
                    type="button"
                    className="layer-row__action"
                    aria-label={`Delete ${plugin.name}`}
                    data-tooltip="Delete this plugin"
                    onClick={() => deletePlugin(plugin.id)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {editorOpen ? (
        <div className="section">
          <div className="section__header">
            <span>{creating ? 'New plugin' : 'Edit plugin'}</span>
          </div>
          <div className="section__body">
            <div className="prop-row">
              <input
                className="input"
                aria-label="Plugin name"
                placeholder="Plugin name"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </div>
            <textarea
              className="input"
              aria-label="Plugin source"
              spellCheck={false}
              value={draftSource}
              onChange={(event) => setDraftSource(event.target.value)}
              style={{ width: '100%', minHeight: 180, fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.5, resize: 'vertical' }}
            />
            <div className="prop-row">
              <button type="button" className="button button--primary" aria-label="Save plugin" onClick={save}>
                Save
              </button>
              <button
                type="button"
                className="button"
                aria-label="Close plugin editor"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="section">
        <div className="section__header">
          <span>Console</span>
          <button type="button" className="icon-button" aria-label="Clear plugin console" data-tooltip="Clear the transcript" onClick={clearPluginConsole}>
            <Icon name="trash" size={13} />
          </button>
        </div>
        <div className="section__body">
          {console_.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
              Run a plugin to see its logs, warnings and errors here.
            </p>
          ) : null}
          {console_.map((entry) => (
            <p
              key={entry.id}
              className="plugin-console__line"
              data-kind={entry.kind}
              style={{
                margin: '2px 0',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                color:
                  entry.kind === 'error'
                    ? 'var(--figma-danger)'
                    : entry.kind === 'warning'
                      ? '#b26a00'
                      : entry.kind === 'success'
                        ? 'var(--figma-success)'
                        : 'var(--figma-text-secondary)',
              }}
            >
              {entry.text}
            </p>
          ))}
        </div>
      </div>
    </>
  );
}
