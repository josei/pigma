import { useState } from 'react';
import { Icon } from './icons';
import { useEditor } from '../store/editorStore';
import { diffSummary } from '../model/versionDiff';
import { versionsOf } from '../model/versions';

/** Version stamps show date + HH:MM; LibrariesPanel's formatter is intentionally
    different (full toLocaleString), so the two are not merged. */
function when(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Version history: named versions, auto snapshots, preview and restore. */
export function VersionHistoryPanel() {
  const file = useEditor((state) => state.file);
  const previewVersionId = useEditor((state) => state.previewVersionId);
  const compareVersionId = useEditor((state) => state.compareVersionId);
  const compareDiff = useEditor((state) => state.compareDiff);
  const compareVersion = useEditor((state) => state.compareVersion);
  const saveVersion = useEditor((state) => state.saveVersion);
  const renameVersion = useEditor((state) => state.renameVersion);
  const deleteVersion = useEditor((state) => state.deleteVersion);
  const previewVersion = useEditor((state) => state.previewVersion);
  const restoreVersion = useEditor((state) => state.restoreVersion);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const versions = [...versionsOf(file)].reverse();

  return (
    <div className="section">
      <div className="section__header">
        <span>Version history</span>
        <span style={{ color: 'var(--figma-text-tertiary)' }}>{versions.length}</span>
      </div>
      <div className="section__body">
        {compareDiff ? (
          <div className="prop-row" data-testid="compare-summary" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <span className="prop-row__label">
              {compareDiff.counts.from} layers → {compareDiff.counts.to} · {diffSummary(compareDiff)}
            </span>
            <span style={{ color: 'var(--figma-text-secondary)' }}>
              <span style={{ color: '#1bc47d' }}>{compareDiff.added.length} added</span>
              {' · '}
              <span style={{ color: '#f24822' }}>{compareDiff.removed.length} removed</span>
              {' · '}
              <span style={{ color: '#ffb020' }}>{compareDiff.changed.length} changed</span>
            </span>
            {compareDiff.changed.slice(0, 6).map((change) => (
              <span key={change.id} style={{ color: 'var(--figma-text-secondary)' }}>
                {change.name}: {change.properties.join(', ')}
              </span>
            ))}
            <button type="button" className="button" aria-label="Exit version compare" onClick={() => compareVersion(null)}>
              Exit compare
            </button>
          </div>
        ) : null}
        <div className="prop-row">
          <input
            className="input"
            aria-label="Version name"
            placeholder="Version name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              saveVersion(draft);
              setDraft('');
            }}
          />
          <button
            type="button"
            className="button button--primary"
            aria-label="Save version"
            onClick={() => {
              saveVersion(draft);
              setDraft('');
            }}
          >
            Save
          </button>
        </div>
        {versions.length === 0 ? (
          <p style={{ margin: '6px 0 0', color: 'var(--figma-text-secondary)' }}>
            No versions yet — auto snapshots appear as you edit.
          </p>
        ) : null}
        {versions.map((version) => (
          <div
            key={version.id}
            className={`layer-row layer-row--always-actions${previewVersionId === version.id ? ' layer-row--selected' : ''}`}
            data-tooltip={`${when(version.createdAt)}${version.auto ? ' · auto' : ''}`}
          >
            <span className="layer-row__icon">
              <Icon name={version.auto ? 'duplicate' : 'check'} size={13} />
            </span>
            {renaming === version.id ? (
              <input
                className="layer-row__rename-input"
                autoFocus
                defaultValue={version.name}
                onBlur={(event) => {
                  renameVersion(version.id, event.target.value);
                  setRenaming(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    renameVersion(version.id, (event.target as HTMLInputElement).value);
                    setRenaming(null);
                  }
                  if (event.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span
                className="layer-row__name"
                aria-label={`Version ${version.name}`}
                onDoubleClick={() => setRenaming(version.id)}
              >
                {version.name}
              </span>
            )}
            <span className="layer-row__actions">
              <button
                type="button"
                className="layer-row__action layer-row__action--text"
                aria-label={`Compare with ${version.name}`}
                data-tooltip="Compare this version with the open document"
                onClick={(event) => {
                  event.stopPropagation();
                  compareVersion(compareVersionId === version.id ? null : version.id);
                }}
              >
                <Icon name="duplicate" size={13} />
                <span>{compareVersionId === version.id ? 'Comparing' : 'Compare'}</span>
              </button>
              <button
                type="button"
                className="layer-row__action"
                aria-label={`Preview ${version.name}`}
                data-tooltip="Preview this version"
                onClick={() => previewVersion(previewVersionId === version.id ? null : version.id)}
              >
                <Icon name="eye" size={13} />
              </button>
              <button
                type="button"
                className="layer-row__action layer-row__action--text"
                aria-label={`Restore ${version.name}`}
                data-tooltip="Restore this version"
                onClick={() => restoreVersion(version.id)}
              >
                <Icon name="check" size={13} />
                <span>Restore</span>
              </button>
              <button
                type="button"
                className="layer-row__action"
                aria-label={`Delete ${version.name}`}
                data-tooltip="Delete version"
                onClick={() => deleteVersion(version.id)}
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
