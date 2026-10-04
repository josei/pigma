import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';
import { useEditor, type Tool } from '../store/editorStore';
import { LayersPanel } from './LayersPanel';
import { McpPanel } from '../mcp/McpPanel';
import { StylesList } from './StylesList';
import { VariablesPanel } from './VariablesPanel';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { CommentsPanel } from './CommentsPanel';
import { LibrariesPanel } from './LibrariesPanel';
import { PluginsPanel } from './PluginsPanel';
import { RoomsPanel } from './RoomsPanel';
import { findNode, walk } from '../model/tree';
import { useIsMobile } from './useIsMobile';

function PageRows() {
  const file = useEditor((state) => state.file);
  const pageId = useEditor((state) => state.pageId);
  const setPage = useEditor((state) => state.setPage);
  const addPage = useEditor((state) => state.addPage);
  const renamePage = useEditor((state) => state.renamePage);
  const deletePage = useEditor((state) => state.deletePage);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <div className="section">
      <div className="section__header">
        <span>Pages</span>
        <button type="button" className="icon-button" data-tooltip="Add page" aria-label="Add page" onClick={addPage}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="section__body">
        {file.document.children.map((page) => (
          <div
            key={page.id}
            className={`page-row${page.id === pageId ? ' page-row--active' : ''}`}
            onClick={() => setPage(page.id)}
            onDoubleClick={() => {
              setRenaming(page.id);
              setDraft(page.name);
            }}
          >
            <Icon name="file" size={12} />
            {renaming === page.id ? (
              <input
                className="layer-row__rename-input"
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                  renamePage(page.id, draft.trim() || page.name);
                  setRenaming(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    renamePage(page.id, draft.trim() || page.name);
                    setRenaming(null);
                  }
                  if (event.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span className="page-row__name">{page.name}</span>
            )}
            <button
              type="button"
              className="layer-row__action"
              data-tooltip="Delete page"
              aria-label="Delete page"
              onClick={(event) => {
                event.stopPropagation();
                deletePage(page.id);
              }}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface AssetEntry {
  id: string;
  name: string;
  icon: IconName;
  detail: string;
}

/** Real assets: components defined in the file, plus every top-level frame. */
function AssetsList() {
  const file = useEditor((state) => state.file);
  const select = useEditor((state) => state.select);
  const setPage = useEditor((state) => state.setPage);
  const insertInstance = useEditor((state) => state.insertInstance);

  const entries: AssetEntry[] = [];
  for (const page of file.document.children) {
    walk(page, (node) => {
      if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
        entries.push({
          id: node.id,
          name: node.name,
          icon: 'component',
          detail: `${Math.round(node.width)} × ${Math.round(node.height)}`,
        });
      }
    });
  }

  return (
    <div className="section">
      <div className="section__header">
        <span>Components</span>
      </div>
      <div className="section__body">
        {entries.length === 0 ? (
          <p style={{ padding: '4px 8px', color: 'var(--figma-text-secondary)' }}>
            Select a shape and press the component button in the toolbar to create one.
          </p>
        ) : null}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="layer-row"
            data-tooltip="Click to select, double-click to insert an instance"
            onClick={() => {
              const owner = file.document.children.find((page) => !!findNode(page, entry.id));
              if (owner) setPage(owner.id);
              select([entry.id]);
            }}
            onDoubleClick={() => insertInstance(entry.id)}
          >
            <span className="layer-row__icon">
              <Icon name={entry.icon} size={14} />
            </span>
            <span className="layer-row__name">{entry.name}</span>
            <span className="layer-row__actions" style={{ color: 'var(--figma-text-secondary)' }}>
              {entry.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TOOL_HELP: Array<{ tool: Tool; icon: IconName; label: string; shortcut: string }> = [
  { tool: 'select', icon: 'cursor', label: 'Move / select', shortcut: 'V' },
  { tool: 'frame', icon: 'frame', label: 'Frame', shortcut: 'F' },
  { tool: 'rect', icon: 'rect', label: 'Rectangle', shortcut: 'R' },
  { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse', shortcut: 'O' },
  { tool: 'polygon', icon: 'polygon', label: 'Polygon', shortcut: 'G' },
  { tool: 'star', icon: 'star', label: 'Star', shortcut: 'S' },
  { tool: 'line', icon: 'line', label: 'Line', shortcut: 'L' },
  { tool: 'text', icon: 'text', label: 'Text', shortcut: 'T' },
  { tool: 'hand', icon: 'hand', label: 'Hand', shortcut: 'H' },
];

function ToolsList() {
  const tool = useEditor((state) => state.tool);
  const setTool = useEditor((state) => state.setTool);
  return (
    <div className="section">
      <div className="section__header">
        <span>Tools</span>
      </div>
      <div className="section__body">
        {TOOL_HELP.map((entry) => (
          <div
            key={entry.label}
            className={`layer-row${tool === entry.tool ? ' layer-row--selected' : ''}`}
            onClick={() => setTool(entry.tool)}
          >
            <span className="layer-row__icon">
              <Icon name={entry.icon} size={14} />
            </span>
            <span className="layer-row__name">{entry.label}</span>
            <span className="layer-row__actions" style={{ color: 'var(--figma-text-secondary)' }}>
              {entry.shortcut}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileSection() {
  const file = useEditor((state) => state.file);
  const linkedFile = useEditor((state) => state.fileHandle?.name ?? null);
  const linkedSource = useEditor((state) => state.linkedSource);
  const linkedDirty = useEditor((state) => state.linkedDirty);
  const keepLinkedDocument = useEditor((state) => state.keepLinkedDocument);
  const setShareLinkOpen = useEditor((state) => state.setShareLinkOpen);
  const [name, setName] = useState(file.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setName(file.name), [file.name]);

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === file.name) {
      setName(file.name);
      return;
    }
    useEditor.getState().apply('Rename file', (current) => ({ ...current, name: trimmed }));
  };

  const nodeCount = (() => {
    let count = 0;
    for (const page of file.document.children) walk(page, () => (count += 1));
    return count;
  })();

  return (
    <div className="panel-header">
      <input
        ref={inputRef}
        className="panel-header__title"
        style={{ border: 'none', background: 'transparent', width: '100%', font: 'inherit' }}
        value={name}
        aria-label="File name"
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') inputRef.current?.blur();
        }}
      />
      <div className="panel-header__subtitle">
        {linkedSource
          ? `Loaded from a link · ${linkedDirty ? 'yours now' : 'not saved yet'}`
          : linkedFile
            ? `Autosaving to ${linkedFile}`
            : file.schema === 'pigma/1'
              ? 'Local document'
              : 'Imported'}{' '}
        · {nodeCount} nodes · {file.document.children.length}{' '}
        {file.document.children.length === 1 ? 'page' : 'pages'}
      </div>
      {linkedSource ? (
        <div className="prop-row" data-testid="linked-document" data-linked-url={linkedSource.url}>
          <span className="prop-row__label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="link" size={13} />
            {linkedSource.name ?? 'From a link'}
          </span>
          <button
            type="button"
            className="button"
            aria-label="Keep linked document in my library"
            data-tooltip="Write this document to your own library"
            disabled={linkedDirty}
            onClick={() => keepLinkedDocument()}
          >
            {linkedDirty ? 'Kept' : 'Save a copy'}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Copy link to this document"
            data-tooltip="Copy a link to this document"
            onClick={() => setShareLinkOpen(true)}
          >
            <Icon name="link" size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Local document library (P5): every document this browser holds, with New /
 * Open / Rename / Duplicate / Delete. The library lives in IndexedDB; opening a
 * document replaces the editor contents and clears the undo history.
 */
function DocumentsSection() {
  const documents = useEditor((state) => state.documents);
  const activeId = useEditor((state) => state.activeDocumentId);
  const fileAccessSupported = useEditor((state) => state.fileAccessSupported);
  const fileHandle = useEditor((state) => state.fileHandle);
  const openFromDisk = useEditor((state) => state.openFromDisk);
  const saveToDisk = useEditor((state) => state.saveToDisk);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const refresh = async () => {
    const { listDocuments } = await import('../store/persistence');
    useEditor.setState({ documents: await listDocuments() });
  };

  return (
    <div className="section">
      <div className="section__header">
        <span>Documents</span>
        <button
          type="button"
          className="icon-button"
          aria-label="New document"
          data-tooltip="New document"
          onClick={() => {
            void import('../store/persistence').then(({ createDocument }) => createDocument());
          }}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="section__body">
        {documents.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
            No saved documents yet — this one is saved as soon as you edit it.
          </p>
        ) : null}
        {documents.map((document) => (
          <div
            key={document.id}
            className={`doc-row${document.id === activeId ? ' doc-row--active' : ''}`}
            data-tooltip={`Saved ${new Date(document.savedAt).toLocaleTimeString()}`}
          >
            <span className="doc-row__icon">
              <Icon name="file" size={13} />
            </span>
            {renaming === document.id ? (
              <input
                className="layer-row__rename-input"
                autoFocus
                aria-label={`Rename ${document.name}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                  void import('../store/persistence').then(({ renameDocument }) => renameDocument(document.id, draft));
                  setRenaming(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                  if (event.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span
                className="doc-row__name"
                aria-label={`Document ${document.name}`}
                onClick={() => {
                  void import('../store/persistence').then(({ openDocument }) => openDocument(document.id));
                }}
              >
                {document.name}
              </span>
            )}
            <span className="doc-row__actions">
              <button
                type="button"
                className="layer-row__action"
                aria-label={`Rename ${document.name}`}
                data-tooltip="Rename"
                onClick={() => {
                  setRenaming(document.id);
                  setDraft(document.name);
                }}
              >
                <Icon name="pen" size={13} />
              </button>
              <button
                type="button"
                className="layer-row__action"
                aria-label={`Duplicate ${document.name}`}
                data-tooltip="Duplicate"
                onClick={() => {
                  void import('../store/persistence')
                    .then(({ duplicateDocumentById }) => duplicateDocumentById(document.id))
                    .then(refresh);
                }}
              >
                <Icon name="duplicate" size={13} />
              </button>
              <button
                type="button"
                className="layer-row__action"
                aria-label={`Delete ${document.name}`}
                data-tooltip="Delete"
                disabled={documents.length === 1}
                onClick={() => {
                  void import('../store/persistence')
                    .then(({ deleteDocumentById }) => deleteDocumentById(document.id))
                    .then(refresh);
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </span>
          </div>
        ))}
        <div className="prop-row">
          <button type="button" className="button" aria-label="Open file" onClick={() => void openFromDisk()}>
            {fileAccessSupported ? 'Open file…' : 'Upload…'}
          </button>
          <button type="button" className="button" aria-label="Save to file" onClick={() => void saveToDisk()}>
            {fileHandle ? 'Save' : fileAccessSupported ? 'Save to file…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LeftPanel() {
  const panelWidth = useEditor((state) => state.panelWidths.left);
  const leftTab = useEditor((state) => state.leftTab);
  const drawer = useEditor((state) => state.mobileDrawer);
  const setMobileDrawer = useEditor((state) => state.setMobileDrawer);
  const isMobile = useIsMobile();
  return (
    <aside
      className={`app__left${isMobile && drawer === 'left' ? ' app__left--open' : ''}`}
      data-drawer={isMobile ? 'left' : undefined}
      // The closed state is explicit and observable, not just a transform.
      data-drawer-state={isMobile ? (drawer === 'left' ? 'open' : 'closed') : undefined}
      aria-hidden={isMobile && drawer !== 'left' ? true : undefined}
      style={isMobile ? undefined : { width: panelWidth }}
    >
      {isMobile ? (
        <div className="drawer__handle">
          <span className="drawer__title">Panels</span>
          <button type="button" className="icon-button" aria-label="Close panel" onClick={() => setMobileDrawer(null)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
      <FileSection />
      <div className="panel__scroll">
        {leftTab === 'file' ? <DocumentsSection /> : null}
        <PageRows />
        {leftTab === 'layers' ? <LayersPanel /> : null}
        {leftTab === 'assets' ? (
          <>
            <LibrariesPanel />
            <StylesList />
            <VariablesPanel />
            <AssetsList />
          </>
        ) : null}
        {leftTab === 'comments' ? <CommentsPanel /> : null}
        {leftTab === 'plugins' ? <PluginsPanel /> : null}
        {leftTab === 'rooms' ? <RoomsPanel /> : null}
        {leftTab === 'tools' ? (
          <>
            <ToolsList />
            <McpPanel />
          </>
        ) : null}
        {leftTab === 'file' ? (
          <>
            <FileMenuList />
            <VersionHistoryPanel />
          </>
        ) : null}
      </div>
    </aside>
  );
}

function FileMenuList() {
  const actions: Array<{ label: string; run: () => void }> = [
    { label: 'New file', run: () => useEditor.getState().newFile() },
    { label: 'Open starter design', run: () => useEditor.getState().loadStarterDocument() },
    { label: 'Place image…', run: () => window.dispatchEvent(new CustomEvent('pigma:place-image')) },
    { label: 'Export .pigma…', run: () => window.dispatchEvent(new CustomEvent('pigma:export-json')) },
    { label: 'Import JSON…', run: () => window.dispatchEvent(new CustomEvent('pigma:import-json')) },
    { label: 'Export SVG…', run: () => window.dispatchEvent(new CustomEvent('pigma:export-svg')) },
    { label: 'Copy as SVG', run: () => window.dispatchEvent(new CustomEvent('pigma:copy-svg')) },
    { label: 'Copy as CSS', run: () => window.dispatchEvent(new CustomEvent('pigma:copy-css')) },
    { label: 'Zoom to fit', run: () => useEditor.getState().zoomToFit() },
  ];
  return (
    <div className="section">
      <div className="section__header">
        <span>File</span>
      </div>
      <div className="section__body">
        {actions.map((action) => (
          <div key={action.label} className="layer-row" onClick={action.run}>
            <span className="layer-row__name">{action.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
