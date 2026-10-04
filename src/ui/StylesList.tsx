import { useState } from 'react';
import { Icon } from './icons';
import { useEditor } from '../store/editorStore';
import { styleSummary, stylesOf, type StyleType } from '../model/styles';

const CREATE_OPTIONS: Array<{ type: StyleType; label: string }> = [
  { type: 'FILL', label: 'Fill' },
  { type: 'TEXT', label: 'Text' },
  { type: 'EFFECT', label: 'Effect' },
];

/** Local styles: create from the selection, apply, rename, update and delete. */
export function StylesList() {
  const file = useEditor((state) => state.file);
  const selection = useEditor((state) => state.selection);
  const createStyle = useEditor((state) => state.createStyle);
  const applyStyle = useEditor((state) => state.applyStyle);
  const renameStyle = useEditor((state) => state.renameStyle);
  const deleteStyle = useEditor((state) => state.deleteStyle);
  const updateStyleFromSelection = useEditor((state) => state.updateStyleFromSelection);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const styles = Object.entries(stylesOf(file));
  const hasSelection = selection.length > 0;

  return (
    <div className="section">
      <div className="section__header">
        <span>Styles</span>
        <span style={{ color: 'var(--figma-text-tertiary)' }}>{styles.length}</span>
      </div>
      <div className="section__body">
        <div className="prop-grid prop-grid--4">
          {CREATE_OPTIONS.map((option) => (
            <button
              key={option.type}
              type="button"
              className="segmented__option"
              aria-label={`Create ${option.label} style`}
              data-tooltip={hasSelection ? `Create a ${option.label.toLowerCase()} style from the selection` : 'Select a layer first'}
              disabled={!hasSelection}
              onClick={() => createStyle(option.type)}
            >
              +{option.label}
            </button>
          ))}
        </div>
        {styles.length === 0 ? (
          <p style={{ padding: '4px 0', color: 'var(--figma-text-secondary)' }}>
            No styles yet — select a layer and create one.
          </p>
        ) : null}
        {styles.map(([id, definition]) => (
          <div key={id} className="layer-row" data-tooltip={`${definition.type} · ${styleSummary(definition)}`}>
            <span className="layer-row__icon">
              <Icon name={definition.type === 'TEXT' ? 'text' : definition.type === 'EFFECT' ? 'rect' : 'component'} size={14} />
            </span>
            {renaming === id ? (
              <input
                className="layer-row__rename-input"
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                  renameStyle(id, draft);
                  setRenaming(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    renameStyle(id, draft);
                    setRenaming(null);
                  }
                  if (event.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span
                className="layer-row__name"
                onDoubleClick={() => {
                  setRenaming(id);
                  setDraft(definition.name);
                }}
              >
                {definition.name}
              </span>
            )}
            <span className="layer-row__actions">
              <button
                type="button"
                className="layer-row__action"
                aria-label={`Apply ${definition.name}`}
                data-tooltip="Apply to selection"
                disabled={!hasSelection}
                onClick={() => applyStyle(id)}
              >
                <Icon name="check" size={13} />
              </button>
              <button
                type="button"
                className="layer-row__action"
                aria-label={`Update ${definition.name}`}
                data-tooltip="Update from selection"
                disabled={!hasSelection}
                onClick={() => updateStyleFromSelection(id)}
              >
                <Icon name="duplicate" size={13} />
              </button>
              <button
                type="button"
                className="layer-row__action"
                aria-label={`Delete ${definition.name}`}
                data-tooltip="Delete style"
                onClick={() => deleteStyle(id)}
              >
                <Icon name="trash" size={13} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
