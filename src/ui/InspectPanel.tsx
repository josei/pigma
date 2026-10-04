import { useState } from 'react';
import { useEditor } from '../store/editorStore';
import { cssDeclarations, measurements, measurementSummary, toCompose, toCss, toReact, toSwiftUI } from '../model/codegen';
import { findNode, findParent } from '../model/tree';
import { copyText } from './clipboard';

/**
 * Dev-mode inspect panel (M14): measurements for the selection plus generated
 * CSS / React, each copyable to the clipboard.
 */
export function InspectPanel() {
  const file = useEditor((state) => state.file);
  const selection = useEditor((state) => state.selection);
  const pushToast = useEditor((state) => state.pushToast);
  const [tab, setTab] = useState<'css' | 'react' | 'swift' | 'compose'>('css');
  const showRedlines = useEditor((state) => state.showRedlines);
  const setRedlines = useEditor((state) => state.setRedlines);
  const setDevStatus = useEditor((state) => state.setDevStatus);

  const id = selection[0];
  const node = id ? findNode(file.document, id) : null;
  const measured = id ? measurements(file, id) : null;
  const css = id ? toCss(file, id) : '';
  const react = id ? toReact(file, id) : '';
  const swift = id ? toSwiftUI(file, id) : '';
  const compose = id ? toCompose(file, id) : '';
  const code = tab === 'css' ? css : tab === 'react' ? react : tab === 'swift' ? swift : compose;
  // Development status belongs to a top-level frame: that is the unit a developer
  // is handed, and the unit the layers list badges.
  const parent = id ? findParent(file.document, id) : null;
  const isTopLevelFrame = node?.type === 'FRAME' && parent?.type === 'CANVAS';
  const tabLabel = tab === 'css' ? 'CSS' : tab === 'react' ? 'React' : tab === 'swift' ? 'SwiftUI' : 'Compose';

  const copy = (text: string, label: string) => {
    void copyText(text).then((ok) => pushToast(ok ? `${label} copied` : `Could not copy ${label}`, ok ? 'success' : 'error'));
  };

  if (!id || !node || !measured) {
    return (
      <div className="section">
        <div className="section__body">
          <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
            Select a layer to inspect its measurements and code.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {isTopLevelFrame ? (
        <div className="section" data-testid="dev-status">
          <div className="section__header">
            <span>Development</span>
            <span
              className="dev-status"
              data-status={node.devStatus ?? 'NONE'}
              data-testid="dev-status-label"
            >
              {node.devStatus === 'READY_FOR_DEVELOPMENT'
                ? 'Ready for development'
                : node.devStatus === 'COMPLETED'
                  ? 'Completed'
                  : 'No status'}
            </span>
          </div>
          <div className="section__body">
            <div className="prop-grid prop-grid--2">
              <button
                type="button"
                className="button"
                aria-label="Mark ready for development"
                onClick={() => setDevStatus(id, 'READY_FOR_DEVELOPMENT')}
              >
                Ready for development
              </button>
              <button type="button" className="button" aria-label="Mark completed" onClick={() => setDevStatus(id, 'COMPLETED')}>
                Completed
              </button>
            </div>
            {node.devStatus ? (
              <button type="button" className="button" aria-label="Clear development status" onClick={() => setDevStatus(id, null)}>
                Clear status
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="section">
        <div className="section__header">
          <span>{measured.name}</span>
          <span style={{ color: 'var(--figma-text-tertiary)' }}>{measured.type.toLowerCase()}</span>
        </div>
        <div className="section__body">
          {measurementSummary(measured).map((line) => (
            <p key={line} className="prop-row" style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ whiteSpace: 'pre' }}>{line}</span>
            </p>
          ))}
          {measured.fill ? <p style={{ margin: '6px 0 0' }}>fill {measured.fill}</p> : null}
          {measured.stroke ? <p style={{ margin: 0 }}>stroke {measured.stroke}</p> : null}
          {measured.font ? <p style={{ margin: 0 }}>font {measured.font}</p> : null}
        </div>
      </div>

      <div className="section">
        <div className="section__header">
          <span>Developer</span>
        </div>
        <div className="section__body">
          <div className="prop-row">
            <label className="prop-row__label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                aria-label="Show redlines"
                checked={showRedlines}
                onChange={(event) => setRedlines(event.target.checked)}
              />
              Redlines
            </label>
          </div>
          <p style={{ margin: '6px 0 0', color: 'var(--figma-text-secondary)' }}>
            Measurements for the selected (or hovered) layer: size, spacing to the parent and the
            nearest sibling. Canvas only — never included in exports.
          </p>
        </div>
      </div>

      <div className="section">
        <div className="section__header">
          <span>Code</span>
          <span className="code-tabs" data-testid="code-tabs">
            <button
              type="button"
              className={`segmented__option${tab === 'css' ? ' segmented__option--active' : ''}`}
              aria-label="Show CSS"
              onClick={() => setTab('css')}
            >
              CSS
            </button>
            <button
              type="button"
              className={`segmented__option${tab === 'react' ? ' segmented__option--active' : ''}`}
              aria-label="Show React"
              onClick={() => setTab('react')}
            >
              React
            </button>
            <button
              type="button"
              className={`segmented__option${tab === 'swift' ? ' segmented__option--active' : ''}`}
              aria-label="Show SwiftUI"
              onClick={() => setTab('swift')}
            >
              SwiftUI
            </button>
            <button
              type="button"
              className={`segmented__option${tab === 'compose' ? ' segmented__option--active' : ''}`}
              aria-label="Show Compose"
              onClick={() => setTab('compose')}
            >
              Compose
            </button>
          </span>
        </div>
        <div className="section__body">
          <pre
            aria-label="Generated code"
            style={{
              margin: 0,
              padding: 8,
              background: 'var(--figma-bg-secondary)',
              border: '1px solid var(--figma-border)',
              borderRadius: 6,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 10,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 260,
              overflow: 'auto',
            }}
          >
            {code || 'Nothing to generate.'}
          </pre>
          <div className="prop-grid prop-grid--2" style={{ marginTop: 6 }}>
            <button type="button" className="button" aria-label="Copy code" onClick={() => copy(code, tabLabel)}>
              Copy {tabLabel}
            </button>
            {tab === 'css' ? (
              <button type="button" className="button" aria-label="Copy CSS declarations" onClick={() => copy(cssDeclarations(file, id).join('\n'), 'declarations')}>
                Copy declarations
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
