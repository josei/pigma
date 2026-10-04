import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';
import { activePage, useEditor } from '../store/editorStore';
import type { SceneNode } from '../model/types';
import { hasChildren } from '../model/types';
import { findPath } from '../model/tree';

const NODE_ICON: Record<string, IconName> = {
  FRAME: 'frame',
  COMPONENT: 'component',
  COMPONENT_SET: 'component',
  INSTANCE: 'instance',
  GROUP: 'group',
  TEXT: 'text',
  RECTANGLE: 'rect',
  ELLIPSE: 'ellipse',
  LINE: 'line',
  POLYGON: 'polygon',
  STAR: 'star',
  VECTOR: 'pen',
  BOOLEAN_OPERATION: 'group',
  SECTION: 'frame',
};

interface RowProps {
  node: SceneNode;
  depth: number;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  renamingId: string | null;
  onStartRename: (id: string | null) => void;
}

function LayerRow({ node, depth, expanded, onToggleExpand, renamingId, onStartRename }: RowProps) {
  const selection = useEditor((state) => state.selection);
  const select = useEditor((state) => state.select);
  const toggleVisible = useEditor((state) => state.toggleVisible);
  const toggleLock = useEditor((state) => state.toggleLock);
  const renameNode = useEditor((state) => state.renameNode);
  const setEnteredContainer = useEditor((state) => state.setEnteredContainer);
  const [draft, setDraft] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId === node.id) {
      setDraft(node.name);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renamingId, node.id, node.name]);

  const selected = selection.includes(node.id);
  const expandable = hasChildren(node) && node.children.length > 0;
  const isOpen = expanded.has(node.id);

  const commit = () => {
    renameNode(node.id, draft.trim() || node.name);
    onStartRename(null);
  };

  return (
    <>
      <div
        className={`layer-row${selected ? ' layer-row--selected' : ''}${node.visible ? '' : ' layer-row--hidden'}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={(event) => select([node.id], event.shiftKey || event.metaKey || event.ctrlKey ? 'toggle' : 'replace')}
        onDoubleClick={() => {
          onStartRename(node.id);
          if (hasChildren(node)) setEnteredContainer(node.id);
        }}
      >
        <button
          type="button"
          className="layer-row__chevron"
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          style={{ visibility: expandable ? 'visible' : 'hidden' }}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand(node.id);
          }}
        >
          <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
        <span className="layer-row__icon">
          <Icon name={NODE_ICON[node.type] ?? 'rect'} size={14} />
        </span>
        {renamingId === node.id ? (
          <input
            ref={inputRef}
            className="layer-row__rename-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') onStartRename(null);
            }}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="layer-row__name" title={node.name}>
            {node.name}
          </span>
        )}
        {node.devStatus ? (
          <span
            className="dev-status dev-status--badge"
            data-status={node.devStatus}
            data-testid="layer-dev-status"
            data-tooltip={node.devStatus === 'READY_FOR_DEVELOPMENT' ? 'Ready for development' : 'Completed'}
          >
            {node.devStatus === 'READY_FOR_DEVELOPMENT' ? 'Ready' : 'Done'}
          </span>
        ) : null}
        <span className="layer-row__actions">
          <button
            type="button"
            className={`layer-row__action${node.isMask ? ' layer-row__action--active' : ''}`}
            aria-label={node.isMask ? `Remove mask from ${node.name}` : `Use ${node.name} as mask`}
            data-tooltip={node.isMask ? 'Remove mask  ⌘⌥M' : 'Use as mask  ⌘⌥M'}
            aria-pressed={node.isMask === true}
            onClick={(event) => {
              event.stopPropagation();
              useEditor.getState().toggleMask([node.id]);
            }}
          >
            <Icon name="mask" size={13} />
          </button>
          <button
            type="button"
            className="layer-row__action"
            data-tooltip={node.visible ? 'Hide' : 'Show'}
            aria-label={node.visible ? 'Hide' : 'Show'}
            onClick={(event) => {
              event.stopPropagation();
              toggleVisible(node.id);
            }}
          >
            <Icon name={node.visible ? 'eye' : 'eye-off'} size={14} />
          </button>
          <button
            type="button"
            className="layer-row__action"
            data-tooltip={node.locked ? 'Unlock' : 'Lock'}
            aria-label={node.locked ? 'Unlock' : 'Lock'}
            onClick={(event) => {
              event.stopPropagation();
              toggleLock(node.id);
            }}
          >
            <Icon name={node.locked ? 'lock' : 'unlock'} size={14} />
          </button>
        </span>
      </div>
      {expandable && isOpen
        ? [...node.children].reverse().map((child) => (
            <LayerRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              renamingId={renamingId}
              onStartRename={onStartRename}
            />
          ))
        : null}
    </>
  );
}

export function LayersPanel() {
  const file = useEditor((state) => state.file);
  const pageId = useEditor((state) => state.pageId);
  const selection = useEditor((state) => state.selection);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const page = activePage({ file, pageId });

  // Reveal the selection: expand every ancestor of every selected node, the way
  // Figma keeps the tree in sync with what is selected on canvas.
  useEffect(() => {
    if (selection.length === 0) return;
    const ancestors = new Set<string>();
    for (const id of selection) {
      const path = findPath(file.document, id);
      if (!path) continue;
      for (const node of path) if (node.type !== 'DOCUMENT') ancestors.add(node.id);
    }
    ancestors.delete(selection[0] as string);
    setExpanded((current) => {
      let changed = false;
      const next = new Set(current);
      for (const id of ancestors) {
        if (id !== page.id && !next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [selection, file.document, page.id]);

  return (
    <div className="section">
      <div className="section__header">
        <span>Layers</span>
        <span style={{ color: 'var(--figma-text-tertiary)' }}>{page.children.length}</span>
      </div>
      <div className="layers">
      {page.children.length === 0 ? (
        <p style={{ padding: '12px 8px', color: 'var(--figma-text-secondary)' }}>
          Nothing on this page yet — draw a frame with F.
        </p>
      ) : null}
      {[...page.children].reverse().map((child) => (
        <LayerRow
          key={child.id}
          node={child}
          depth={0}
          expanded={expanded}
          onToggleExpand={(id) =>
            setExpanded((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          renamingId={renamingId}
          onStartRename={setRenamingId}
        />
      ))}
      </div>
    </div>
  );
}
