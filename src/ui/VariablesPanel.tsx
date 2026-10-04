import { Icon } from './icons';
import { useEditor } from '../store/editorStore';
import {
  VARIABLE_TYPES,
  activeModeOf,
  bindableVariables,
  collectionsOf,
  variablesOf,
  type VariableType,
} from '../model/variables';
import type { RGBA, VariableValue } from '../model/types';
import { hexToRgba, rgbaToHex } from '../model/paint';
import { findNode } from '../model/tree';

function isColor(value: VariableValue): value is RGBA {
  return typeof value === 'object' && value !== null && 'r' in value;
}

/** Variables + modes: create collections/variables, edit per-mode values, switch modes. */
export function VariablesPanel() {
  const file = useEditor((state) => state.file);
  const addVariableCollection = useEditor((state) => state.addVariableCollection);
  const addVariable = useEditor((state) => state.addVariable);
  const setVariableValue = useEditor((state) => state.setVariableValue);
  const deleteVariable = useEditor((state) => state.deleteVariable);
  const addMode = useEditor((state) => state.addMode);
  const setActiveMode = useEditor((state) => state.setActiveMode);

  const collections = Object.values(collectionsOf(file));
  const variables = Object.values(variablesOf(file));

  return (
    <div className="section">
      <div className="section__header">
        <span>Variables</span>
        <button type="button" className="icon-button" aria-label="Add variable collection" data-tooltip="Add collection" onClick={addVariableCollection}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="section__body">
        {collections.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
            No collections yet — add one to define colour, number, string or boolean variables.
          </p>
        ) : null}
        {collections.map((collection) => {
          const active = activeModeOf(file, collection.id);
          const own = collection.variableIds.map((id) => variablesOf(file)[id]).filter((definition) => !!definition);
          return (
            <div key={collection.id} style={{ marginBottom: 8 }}>
              <div className="prop-row">
                <span className="prop-row__label" style={{ minWidth: 70 }}>{collection.name}</span>
                <select
                  className="input"
                  aria-label={`Mode for ${collection.name}`}
                  value={active ?? ''}
                  onChange={(event) => setActiveMode(collection.id, event.target.value)}
                >
                  {collection.modes.map((mode) => (
                    <option key={mode.modeId} value={mode.modeId}>{mode.name}</option>
                  ))}
                </select>
                <button type="button" className="icon-button" aria-label={`Add mode to ${collection.name}`} data-tooltip="Add mode" onClick={() => addMode(collection.id)}>
                  <Icon name="plus" size={13} />
                </button>
              </div>
              <div className="prop-grid prop-grid--4">
                {VARIABLE_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="segmented__option"
                    aria-label={`Add ${type.toLowerCase()} variable`}
                    data-tooltip={`Add ${type.toLowerCase()} variable`}
                    onClick={() => addVariable(collection.id, type as VariableType)}
                  >
                    +{type.slice(0, 1)}
                  </button>
                ))}
              </div>
              {own.map((definition) => {
                const value = active ? definition.valuesByMode[active] : undefined;
                return (
                  <div key={definition.id} className="prop-row">
                    <span className="layer-row__icon">
                      <Icon name={definition.resolvedType === 'COLOR' ? 'component' : definition.resolvedType === 'BOOLEAN' ? 'check' : 'text'} size={13} />
                    </span>
                    <span className="layer-row__name" title={`${definition.name} (${definition.resolvedType})`}>{definition.name}</span>
                    {definition.resolvedType === 'COLOR' && value !== undefined && isColor(value) ? (
                      <input
                        className="input"
                        type="color"
                        aria-label={`${definition.name} value`}
                        value={rgbaToHex(value)}
                        style={{ width: 28, padding: 0, border: 'none', background: 'transparent' }}
                        onChange={(event) => setVariableValue(definition.id, hexToRgba(event.target.value))}
                      />
                    ) : null}
                    {definition.resolvedType === 'FLOAT' ? (
                      <input
                        className="input input--numeric"
                        aria-label={`${definition.name} value`}
                        style={{ width: 60 }}
                        value={String(typeof value === 'number' ? value : 0)}
                        onChange={(event) => {
                          const parsed = Number.parseFloat(event.target.value);
                          if (Number.isFinite(parsed)) setVariableValue(definition.id, parsed);
                        }}
                      />
                    ) : null}
                    {definition.resolvedType === 'BOOLEAN' ? (
                      <input
                        type="checkbox"
                        aria-label={`${definition.name} value`}
                        checked={value === true}
                        onChange={(event) => setVariableValue(definition.id, event.target.checked)}
                      />
                    ) : null}
                    {definition.resolvedType === 'STRING' ? (
                      <input
                        className="input"
                        aria-label={`${definition.name} value`}
                        value={typeof value === 'string' ? value : ''}
                        onChange={(event) => setVariableValue(definition.id, event.target.value)}
                      />
                    ) : null}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete ${definition.name}`}
                      data-tooltip="Delete variable"
                      onClick={() => deleteVariable(definition.id)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
        {variables.length === 0 && collections.length > 0 ? (
          <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>Add a variable to this collection.</p>
        ) : null}
      </div>
    </div>
  );
}

/** Compact bind control used by the properties panel rows. */
export function VariableBind({ property, label }: { property: string; label: string }) {
  const file = useEditor((state) => state.file);
  const selection = useEditor((state) => state.selection);
  const bindVariable = useEditor((state) => state.bindVariable);
  const node = useEditor((state) => {
    const id = state.selection[0];
    return id ? findNode(state.file.document, id) : null;
  });
  const options = bindableVariables(file, property);
  const bound = node && node.type !== 'DOCUMENT' && node.type !== 'CANVAS' ? (node.boundVariables ?? {})[property] ?? '' : '';

  return (
    <select
      className="input"
      aria-label={`${label} variable`}
      data-tooltip={`Bind ${label.toLowerCase()} to a variable`}
      disabled={selection.length === 0 || options.length === 0}
      value={bound}
      onChange={(event) => bindVariable(property, event.target.value || null)}
    >
      <option value="">{options.length === 0 ? 'No variables' : 'None'}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>{option.name}</option>
      ))}
    </select>
  );
}
