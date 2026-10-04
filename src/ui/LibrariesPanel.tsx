import { useState } from 'react';
import { Icon } from './icons';
import { useEditor } from '../store/editorStore';
import { staleLibraryInstances } from '../model/library';

/** Full local timestamp (date + time + seconds); VersionHistoryPanel formats
    date + HH:MM instead, so the two helpers stay separate on purpose. */
function when(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

/**
 * Libraries (M11): publish the file's components/styles/variables as a local
 * library, browse every published library, insert its components as linked
 * instances and pull updates into existing instances.
 */
export function LibrariesPanel() {
  const file = useEditor((state) => state.file);
  const libraries = useEditor((state) => state.libraries);
  const publishLibrary = useEditor((state) => state.publishLibrary);
  const deleteLibrary = useEditor((state) => state.deleteLibrary);
  const insertFromLibrary = useEditor((state) => state.insertFromLibrary);
  const updateLibraryInstances = useEditor((state) => state.updateLibraryInstances);
  const importLibraryStyle = useEditor((state) => state.importLibraryStyle);
  const importLibraryVariables = useEditor((state) => state.importLibraryVariables);
  const [name, setName] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const published = file.publishedLibrary ?? null;
  const stale = staleLibraryInstances(file, libraries);

  return (
    <div className="section">
      <div className="section__header">
        <span>Libraries</span>
        <span style={{ color: 'var(--figma-text-tertiary)' }}>
          {published ? `published v${published.version}` : 'not published'}
        </span>
      </div>
      <div className="section__body">
        <div className="prop-row">
          <input
            className="input"
            aria-label="Library name"
            placeholder={published?.name ?? file.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="button"
            className="button"
            aria-label={published ? 'Republish library' : 'Publish library'}
            data-tooltip="Publish this file's components, styles and variables as a library"
            onClick={() => {
              publishLibrary(name);
              setName('');
            }}
          >
            {published ? 'Republish' : 'Publish'}
          </button>
        </div>

        {stale.length > 0 ? (
          <div className="prop-row" style={{ alignItems: 'center' }}>
            <span className="layer-row__icon" style={{ color: 'var(--figma-brand)' }}>
              <Icon name="link" size={13} />
            </span>
            <span className="layer-row__name" aria-label={`${stale.length} instances out of date`}>
              {stale.length} instance{stale.length === 1 ? '' : 's'} out of date
            </span>
            <button
              type="button"
              className="button"
              aria-label="Update all out-of-date instances"
              data-tooltip="Pull the latest published version into every out-of-date instance"
              onClick={() => updateLibraryInstances(stale[0]!.libraryId)}
            >
              Update all
            </button>
          </div>
        ) : null}

        {libraries.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
            No libraries yet — publish this file to reuse its components, styles and variables.
          </p>
        ) : null}

        {libraries.map((library) => (
          <div key={library.id}>
            <div
              className="layer-row"
              aria-label={`Library ${library.name}`}
              data-tooltip="Click to expand, double-click a component to insert"
              onClick={() => setOpen(open === library.id ? null : library.id)}
            >
              <span className="layer-row__icon">
                <Icon name="assets" size={13} />
              </span>
              <span className="layer-row__name">
                {library.name} <span style={{ color: 'var(--figma-text-tertiary)' }}>v{library.version}</span>
              </span>
              <span className="layer-row__actions" style={{ color: 'var(--figma-text-secondary)' }}>
                {library.components.length}c · {library.styles.length}s · {Object.keys(library.variables).length}v
                <button
                  type="button"
                  className="layer-row__action"
                  aria-label={`Remove library ${library.name}`}
                  data-tooltip="Remove this library"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteLibrary(library.id);
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
            </div>
            {open === library.id ? (
              <div style={{ paddingLeft: 18 }}>
                <p style={{ margin: '4px 0', color: 'var(--figma-text-tertiary)' }}>
                  Published {when(library.publishedAt)} from {library.sourceFileName}
                </p>
                {library.components.map((component) => (
                  <div
                    key={component.key}
                    className="layer-row"
                    aria-label={`Library component ${component.name}`}
                    data-tooltip="Double-click to insert an instance"
                    onDoubleClick={() => insertFromLibrary(library.id, component.key)}
                  >
                    <span className="layer-row__icon">
                      <Icon name="component" size={13} />
                    </span>
                    <span className="layer-row__name">{component.name}</span>
                    <span className="layer-row__actions">
                      <button
                        type="button"
                        className="layer-row__action"
                        aria-label={`Insert ${component.name}`}
                        data-tooltip="Insert instance"
                        onClick={(event) => {
                          event.stopPropagation();
                          insertFromLibrary(library.id, component.key);
                        }}
                      >
                        <Icon name="plus" size={13} />
                      </button>
                    </span>
                  </div>
                ))}
                {library.components.length === 0 ? (
                  <p style={{ margin: '4px 0', color: 'var(--figma-text-secondary)' }}>
                    No components published yet.
                  </p>
                ) : null}
                {library.styles.map((style) => (
                  <div key={style.key} className="layer-row" aria-label={`Library style ${style.name}`}>
                    <span className="layer-row__icon">
                      <Icon name="assets" size={13} />
                    </span>
                    <span className="layer-row__name">
                      {style.name} <span style={{ color: 'var(--figma-text-tertiary)' }}>{style.type.toLowerCase()}</span>
                    </span>
                    <span className="layer-row__actions">
                      <button
                        type="button"
                        className="layer-row__action"
                        aria-label={`Import style ${style.name}`}
                        data-tooltip="Add this style to the file"
                        onClick={(event) => {
                          event.stopPropagation();
                          importLibraryStyle(library.id, style.key);
                        }}
                      >
                        <Icon name="plus" size={13} />
                      </button>
                    </span>
                  </div>
                ))}
                {Object.keys(library.variables).length > 0 ? (
                  <div className="prop-row">
                    <span className="layer-row__name">
                      Variables: {Object.values(library.variables).map((variable) => variable.name).join(', ')}
                    </span>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Import variables from ${library.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        importLibraryVariables(library.id);
                      }}
                    >
                      Import
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
