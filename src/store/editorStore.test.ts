import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BURST_WINDOW_MS, activePage, currentBurstKey, selectedNodes, useEditor } from './editorStore';
import { createFrameNode, createRectNode, createTextNode } from '../model/factory';
import { parseFile, serializeFile } from '../model/serialize';
import { emptyFile } from '../model/validate';
import { findNode, updateNode } from '../model/tree';
import { hasChildren, type AnyNode } from '../model/types';

import { defaultDocument } from '../model/starter';
import { staleLibraryInstances } from '../model/library';

function pageChildren(node: AnyNode) {
  if (!hasChildren(node)) throw new Error('expected a container');
  return node.children;
}

const store = () => useEditor.getState();

/** Most tests want a blank canvas; the starter document has its own test. */
function reset() {
  const file = emptyFile('Test');
  useEditor.setState({
    file,
    pageId: file.document.children[0]!.id,
    selection: [],
    past: [],
    future: [],
    transaction: null,
    presentation: false,
    presentationFrameId: null,
    editingTextId: null,
    enteredContainerId: null,
    previewVersionId: null,
    previewFile: null,
    editsSinceVersion: 0,
    presentationOverlays: [],
    libraries: [],
    mobileDrawer: null,
    pngOptions: { open: false, scale: 1, transparent: false, scope: 'page' },
  });
}

function addRect(x = 0, y = 0, width = 100, height = 100) {
  const state = store();
  const node = createRectNode(state.file.document, x, y, width, height);
  state.addNode(node, activePage(state).id);
  return node.id;
}

describe('editor store', () => {
  beforeEach(reset);

  it('boots with the starter document and a valid page', () => {
    const starter = defaultDocument();
    useEditor.setState({ file: starter, pageId: starter.document.children[0]!.id });
    const state = store();
    expect(state.file.document.children[0]!.children).toHaveLength(4);
    expect(state.exportJsonString()).toContain('Home / Hero');
    expect(state.file.schema).toBe('pigma/1');
    expect(state.file.document.children.length).toBeGreaterThan(0);
    expect(activePage(state).id).toBe(state.pageId);
    expect(parseFile(state.exportJsonString()).ok).toBe(true);
  });

  it('adds nodes, selects them and records history', () => {
    const id = addRect(10, 20);
    expect(store().selection).toEqual([id]);
    expect(store().past).toHaveLength(1);
    expect(findNode(store().file.document, id)).not.toBeNull();
  });

  it('undoes and redoes edits, restoring the selection', () => {
    const id = addRect();
    store().undo();
    expect(findNode(store().file.document, id)).toBeNull();
    expect(store().selection).toEqual([]);
    store().redo();
    expect(findNode(store().file.document, id)).not.toBeNull();
    expect(store().selection).toEqual([id]);
  });

  it('treats a drag as one history entry', () => {
    const id = addRect(0, 0);
    const before = store().past.length;
    store().beginTransaction();
    store().moveSelection(10, 0, true);
    store().moveSelection(20, 0, true);
    store().moveSelection(30, 0, true);
    expect(store().past).toHaveLength(before);
    store().endTransaction('Move');
    expect(store().past).toHaveLength(before + 1);
    store().undo();
    expect(selectedNodes(store())[0]?.transform.tx).toBe(0);
    void id;
  });

  it('moves selections to explicit positions with pixel snapping', () => {
    const id = addRect(0, 0);
    store().beginTransaction();
    store().moveSelectionTo([{ id, x: 12.4, y: 5.6 }], true);
    store().endTransaction('Move');
    const node = findNode(store().file.document, id)!;
    expect(node.transform.tx).toBeCloseTo(12.4);
    expect(store().past).toHaveLength(2);
  });

  it('deletes, duplicates, copies and pastes', () => {
    const id = addRect(0, 0);
    store().duplicateSelection();
    expect(store().selection).toHaveLength(1);
    expect(store().selection[0]).not.toBe(id);
    expect(activePage(store()).children).toHaveLength(2);

    store().copySelection();
    store().pasteClipboard();
    expect(activePage(store()).children).toHaveLength(3);
    const pasted = store().selection[0]!;
    expect(pasted).not.toBe(id);

    store().select([id]);
    store().deleteSelection();
    expect(findNode(store().file.document, id)).toBeNull();
    expect(store().selection).toEqual([]);
  });

  it('groups and ungroups the selection', () => {
    const a = addRect(0, 0);
    const b = addRect(200, 0);
    store().select([a, b]);
    store().groupSelection();
    const groupId = store().selection[0]!;
    expect(findNode(store().file.document, groupId)?.type).toBe('GROUP');
    store().ungroupSelection();
    expect(findNode(store().file.document, groupId)).toBeNull();
    expect(store().selection).toHaveLength(2);
  });

  it('reorders, aligns and distributes through the store', () => {
    const a = addRect(0, 0);
    const b = addRect(200, 0);
    const c = addRect(400, 0);
    store().select([a]);
    store().reorder('front');
    expect(activePage(store()).children.map((child) => child.id)).toEqual([b, c, a]);

    store().select([a, b, c]);
    store().align('left');
    expect(activePage(store()).children.map((child) => child.transform.tx)).toEqual([0, 0, 0]);

    store().select([a, b, c]);
    store().distribute('horizontal');
    const xs = activePage(store()).children.map((child) => child.transform.tx);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!);
  });

  it('toggles visibility and lock, and renames layers', () => {
    const id = addRect();
    store().toggleVisible(id);
    expect(findNode(store().file.document, id)?.visible).toBe(false);
    store().toggleLock(id);
    expect(findNode(store().file.document, id)?.locked).toBe(true);
    expect(store().selection).toEqual([]);
    store().renameNode(id, 'Hero card');
    expect(findNode(store().file.document, id)?.name).toBe('Hero card');
  });

  it('updates properties through patches and text styles', () => {
    const id = addRect(0, 0, 100, 100);
    store().updateSelected({ opacity: 0.4, cornerRadius: 12, fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }] });
    const node = findNode(store().file.document, id)!;
    expect(node.opacity).toBeCloseTo(0.4);
    expect(node.cornerRadius).toBe(12);
    expect(node.fills[0]).toMatchObject({ type: 'SOLID' });

    const text = createTextNode(store().file.document, 0, 0, 'Hello world');
    store().addNode(text, activePage(store()).id);
    store().updateSelectedTextStyle({ fontSize: 32, fontWeight: 700 });
    const styled = findNode(store().file.document, text.id)!;
    expect(styled.type).toBe('TEXT');
    if (styled.type === 'TEXT') {
      expect(styled.style.fontSize).toBe(32);
      expect(styled.style.fontWeight).toBe(700);
    }
  });

  it('re-measures auto-sized text after edits', () => {
    const text = createTextNode(store().file.document, 0, 0, 'x');
    store().addNode(text, activePage(store()).id);
    const before = findNode(store().file.document, text.id)!;
    store().setCharacters(text.id, 'a much longer sentence than before');
    const after = findNode(store().file.document, text.id)!;
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThanOrEqual(before.height);
  });

  it('manages pages', () => {
    const first = store().pageId;
    store().addPage();
    expect(store().file.document.children).toHaveLength(2);
    const second = store().pageId;
    expect(second).not.toBe(first);
    store().renamePage(second, 'Mobile');
    expect(store().file.document.children[1]!.name).toBe('Mobile');
    store().deletePage(second);
    expect(store().file.document.children).toHaveLength(1);
    expect(store().pageId).toBe(first);
    store().deletePage(first);
    expect(store().file.document.children).toHaveLength(1);
    expect(store().toasts.at(-1)?.message).toContain('at least one page');
  });

  it('creates components, inserts instances and detaches them', () => {
    const id = addRect(0, 0, 120, 60);
    store().select([id]);
    store().createComponentFromSelection();
    const componentId = store().selection[0]!;
    const component = findNode(store().file.document, componentId)!;
    expect(component.type).toBe('COMPONENT');
    expect(pageChildren(component)).toHaveLength(1);

    store().insertInstance(componentId);
    const instanceId = store().selection[0]!;
    const instance = findNode(store().file.document, instanceId)!;
    expect(instance.type).toBe('INSTANCE');
    if (instance.type === 'INSTANCE') expect(instance.componentId).toBe(componentId);

    store().detachInstance(instanceId);
    expect(findNode(store().file.document, instanceId)?.type).toBe('FRAME');
  });

  it('keeps an instance override out of the master component', () => {
    addRect(0, 0, 120, 60);
    store().updateSelected({ fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.2 }, opacity: 1 }] }, 'Set fill');
    store().createComponentFromSelection();
    const componentId = store().selection[0]!;
    store().insertInstance(componentId);
    const instanceId = store().selection[0]!;

    const masterFill = () => JSON.stringify(findNode(store().file.document, componentId)!.fills);
    const before = masterFill();

    // Filling the instance itself must not touch the master.
    store().select([instanceId]);
    store().updateSelected({ fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }] }, 'Set fill');
    expect(masterFill()).toBe(before);
    expect(findNode(store().file.document, instanceId)!.fills[0]).toMatchObject({ type: 'SOLID' });

    // Editing a node *inside* the instance records an override instead.
    const instance = findNode(store().file.document, instanceId)!;
    const innerId = pageChildren(instance)[0]!.id;
    store().select([innerId]);
    store().updateSelected({ opacity: 0.25 }, 'Set opacity');
    const inner = findNode(store().file.document, innerId)!;
    expect(inner.opacity).toBe(0.25);
    const master = findNode(store().file.document, componentId)!;
    expect(pageChildren(master)[0]!.opacity).toBe(1);
    expect(Object.keys((findNode(store().file.document, instanceId) as { overrides?: Record<string, unknown> }).overrides ?? {})).toHaveLength(1);
  });

  it('records file-level changes that do not touch the document', () => {
    // Variables, collections, modes and styles live on the file, not the
    // document: they must still create history entries and stick.
    const before = store().past.length;
    store().addVariableCollection();
    expect(Object.keys(store().file.variableCollections ?? {})).toHaveLength(1);
    expect(store().past).toHaveLength(before + 1);

    const collectionId = Object.keys(store().file.variableCollections!)[0]!;
    store().addVariable(collectionId, 'COLOR');
    expect(Object.keys(store().file.variables ?? {})).toHaveLength(1);

    const variableId = Object.keys(store().file.variables!)[0]!;
    store().addMode(collectionId);
    expect(store().file.variableCollections![collectionId]!.modes).toHaveLength(2);
    const secondMode = store().file.variableCollections![collectionId]!.modes[1]!.modeId;
    store().setActiveMode(collectionId, secondMode);
    expect(store().file.activeModes?.[collectionId]).toBe(secondMode);

    store().undo();
    expect(store().file.activeModes?.[collectionId]).not.toBe(secondMode);
    store().redo();
    expect(store().file.activeModes?.[collectionId]).toBe(secondMode);
    void variableId;
  });

  it('keeps version history and comment threads in the file', () => {
    const before = store().past.length;
    store().saveVersion('Milestone');
    expect(store().file.versions ?? []).toHaveLength(1);
    expect(store().past).toHaveLength(before + 1);
    const versionId = store().file.versions![0]!.id;

    addRect(0, 0, 40, 40);
    store().previewVersion(versionId);
    expect(store().previewFile).not.toBeNull();
    store().restoreVersion(versionId);
    expect(store().previewFile).toBeNull();
    expect(activePage(store()).children).toHaveLength(0);
    store().undo();
    expect(activePage(store()).children).toHaveLength(1);
    store().redo();
    expect(activePage(store()).children).toHaveLength(0);

    store().renameVersion(versionId, 'Renamed');
    expect(store().file.versions![0]!.name).toBe('Renamed');
    store().deleteVersion(versionId);
    expect(store().file.versions ?? []).toHaveLength(0);
  });

  it('takes an automatic snapshot once enough edits pile up', () => {
    const start = store().file.versions?.length ?? 0;
    for (let index = 0; index < 8; index += 1) store().renameNode(addRect(index * 10, 0), `Layer ${index}`);
    const versions = store().file.versions ?? [];
    expect(versions.length).toBeGreaterThan(start);
    expect(versions[versions.length - 1]!.auto).toBe(true);
    expect(store().editsSinceVersion).toBe(0);
  });

  it('links prototype interactions and navigates in presentation mode', () => {
    const a = addRect(0, 0, 100, 100);
    const b = addRect(400, 0, 100, 100);
    store().select([a]);
    store().setInteraction(a, { trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: b }] });
    expect(findNode(store().file.document, a)?.interactions).toHaveLength(1);
    store().setPrototypeStart(a);
    store().setPresentation(true);
    expect(store().presentation).toBe(true);
    expect(store().presentationFrameId).toBe(a);
    store().navigatePrototype(b);
    expect(store().presentationFrameId).toBe(b);
    store().prototypeBack();
    expect(store().presentationFrameId).toBe(a);
    store().setInteraction(a, null);
    expect(findNode(store().file.document, a)?.interactions).toEqual([]);
  });

  it('imports and exports JSON, reporting failures as toasts', () => {
    const id = addRect(5, 5);
    const json = store().exportJsonString();
    store().newFile();
    expect(store().importJsonText(json).ok).toBe(true);
    expect(findNode(store().file.document, id)).not.toBeNull();

    const failed = store().importJsonText('{oops');
    expect(failed.ok).toBe(false);
    expect(store().toasts.at(-1)?.kind).toBe('error');
  });

  it('exports SVG for the selection and for the whole page', () => {
    const id = addRect(0, 0, 50, 50);
    store().select([id]);
    const selectionSvg = store().exportSvgString();
    expect(selectionSvg).toContain('<svg');
    expect(selectionSvg).toContain('viewBox="0 0 50 50"');
    const pageSvg = store().exportSvgString([]);
    expect(pageSvg).toContain('<svg');
  });

  it('fits the viewport to the page content', () => {
    addRect(0, 0, 400, 400);
    store().setCanvasSize({ width: 1000, height: 800 });
    store().zoomToFit();
    expect(store().viewport.zoom).toBeGreaterThan(0);
    expect(store().viewport.zoom).toBeLessThanOrEqual(4);
  });

  it('keeps unsupported Figma metadata across import, edit and export', () => {
    const payload = {
      schema: 'pigma/1',
      name: 'Imported',
      document: {
        id: '0:0',
        type: 'DOCUMENT',
        children: [
          {
            id: '1:0',
            type: 'CANVAS',
            name: 'Page 1',
            children: [
              {
                id: '1:1',
                type: 'RECTANGLE',
                name: 'Rect',
                width: 10,
                height: 10,
                figmaExtra: { paint: 'ok' },
              },
            ],
          },
        ],
      },
    };
    expect(store().importJsonText(JSON.stringify(payload)).ok).toBe(true);
    store().select(['1:1']);
    store().updateSelected({ x: 40 });
    const exported = parseFile(store().exportJsonString());
    const node = exported.file!.document.children[0]!.children[0]!;
    expect(node.raw).toEqual({ figmaExtra: { paint: 'ok' } });
    expect(node.transform.tx).toBe(40);
  });
});

describe('libraries', () => {
  beforeEach(reset);

  function seedComponent() {
    const state = store();
    const rect = createRectNode(state.file.document, 0, 0, 80, 60);
    rect.name = 'Card';
    const page = state.file.document.children[0]!;
    const component = {
      ...rect,
      id: 'comp:1',
      type: 'COMPONENT' as const,
      key: 'comp-key-1',
      children: [{ ...createRectNode(state.file.document, 4, 4, 20, 20), id: 'comp:1:child', name: 'Dot' }],
    };
    useEditor.setState({ file: { ...state.file, document: { ...state.file.document, children: [{ ...page, children: [component] }] } } });
    return component;
  }

  it('publishes the file as a library and records the publication', () => {
    seedComponent();
    store().publishLibrary('Design system');
    const library = store().libraries[0]!;
    expect(store().libraries).toHaveLength(1);
    expect(library.name).toBe('Design system');
    expect(library.version).toBe(1);
    expect(library.components).toHaveLength(1);
    expect(library.components[0]!.name).toBe('Card');
    expect(store().file.publishedLibrary).toMatchObject({ id: library.id, version: 1 });
    // Re-publishing bumps the version and keeps one entry.
    store().publishLibrary();
    expect(store().libraries).toHaveLength(1);
    expect(store().libraries[0]!.version).toBe(2);
    expect(store().libraries[0]!.id).toBe(library.id);
    expect(store().file.publishedLibrary?.version).toBe(2);
  });

  it('inserts a linked instance from a library', () => {
    seedComponent();
    store().publishLibrary('Design system');
    const library = store().libraries[0]!;
    const key = library.components[0]!.key;
    store().insertFromLibrary(library.id, key);
    const page = store().file.document.children[0]!;
    const instance = page.children.find((node) => node.type === 'INSTANCE')!;
    expect(instance).toBeTruthy();
    expect(instance.libraryId).toBe(library.id);
    expect(instance.libraryKey).toBe(key);
    expect(instance.libraryVersion).toBe(1);
    expect(instance.children).toHaveLength(1);
    expect(store().selection).toEqual([instance.id]);
    // The local component was materialised for the instance to point at.
    expect(page.children.some((node) => node.id === (instance as { componentId?: string }).componentId)).toBe(true);
  });

  it('reports and refreshes out-of-date instances after a republish', () => {
    seedComponent();
    store().publishLibrary('Design system');
    const library = store().libraries[0]!;
    store().insertFromLibrary(library.id, library.components[0]!.key);
    // Change the component, then republish.
    const page = store().file.document.children[0]!;
    const component = page.children.find((node) => node.id === 'comp:1')!;
    useEditor.setState({
      file: {
        ...store().file,
        document: { ...store().file.document, children: [{ ...page, children: page.children.map((node) => (node.id === component.id ? { ...node, width: 200 } : node)) }] },
      },
    });
    store().publishLibrary();
    const republished = store().libraries[0]!;
    expect(republished.version).toBe(2);

    const stale = staleLibraryInstances(store().file, store().libraries);
    expect(stale).toHaveLength(1);
    expect(stale[0]!.publishedVersion).toBe(1);
    expect(stale[0]!.currentVersion).toBe(2);

    store().updateLibraryInstances(republished.id);
    const refreshed = store().file.document.children[0]!.children.find((node) => node.type === 'INSTANCE')!;
    expect(refreshed.libraryVersion).toBe(2);
    expect(staleLibraryInstances(store().file, store().libraries)).toEqual([]);
  });

  it('removes a library without touching instances', () => {
    seedComponent();
    store().publishLibrary('Design system');
    const library = store().libraries[0]!;
    store().insertFromLibrary(library.id, library.components[0]!.key);
    store().deleteLibrary(library.id);
    expect(store().libraries).toEqual([]);
    expect(store().file.document.children[0]!.children.some((node) => node.type === 'INSTANCE')).toBe(true);
  });

  it('keeps publication undoable', () => {
    seedComponent();
    store().publishLibrary('Design system');
    expect(store().file.publishedLibrary).toBeTruthy();
    store().undo();
    expect(store().file.publishedLibrary ?? null).toBeNull();
  });
});

describe('panel widths', () => {
  beforeEach(reset);

  it('clamps widths to the usable range', () => {
    store().setPanelWidth('left', 10);
    expect(store().panelWidths.left).toBe(180);
    store().setPanelWidth('left', 10_000);
    expect(store().panelWidths.left).toBeLessThanOrEqual(560);
    expect(store().panelWidths.left).toBeGreaterThanOrEqual(180);
    store().setPanelWidth('right', 320);
    expect(store().panelWidths).toEqual({ left: store().panelWidths.left, right: 320 });
  });

  it('keeps both sides independent and rounds to whole pixels', () => {
    store().setPanelWidth('left', 300.4);
    store().setPanelWidth('right', 200.6);
    expect(store().panelWidths.left).toBe(300);
    expect(store().panelWidths.right).toBe(201);
  });

  it('does not touch the document history', () => {
    const before = store().past.length;
    store().setPanelWidth('left', 280);
    expect(store().past.length).toBe(before);
    expect(store().file).toBe(useEditor.getState().file);
  });
});

describe('mobile drawer and gesture abort', () => {
  beforeEach(reset);

  it('toggles the drawer and closes it when the same side is asked again', () => {
    store().setMobileDrawer('left');
    expect(store().mobileDrawer).toBe('left');
    store().setMobileDrawer('left');
    expect(store().mobileDrawer).toBeNull();
    store().setMobileDrawer('right');
    expect(store().mobileDrawer).toBe('right');
    store().setMobileDrawer(null);
    expect(store().mobileDrawer).toBeNull();
  });

  it('cancels an in-flight gesture without touching history', () => {
    const id = addRect(0, 0);
    const historyBefore = store().past.length;
    store().beginTransaction();
    store().moveSelection(60, 0);
    expect(findNode(store().file.document, id)!.transform.tx).toBe(60);

    store().cancelTransaction();
    expect(store().transaction).toBeNull();
    expect(findNode(store().file.document, id)!.transform.tx).toBe(0);
    // Nothing was pushed: a cancelled gesture is not undoable.
    expect(store().past.length).toBe(historyBefore);
  });

  it('keeps the committed move when the gesture ends normally', () => {
    const id = addRect(0, 0);
    store().beginTransaction();
    store().moveSelection(25, 5);
    store().endTransaction('Move');
    expect(findNode(store().file.document, id)!.transform.tx).toBe(25);
    expect(store().past[store().past.length - 1]!.label).toBe('Move');
    store().undo();
    expect(findNode(store().file.document, id)!.transform.tx).toBe(0);
  });
});

describe('png export options', () => {
  beforeEach(reset);

  it('opens, clamps the scale and toggles transparency', () => {
    expect(store().pngOptions).toEqual({ open: false, scale: 1, transparent: false, scope: 'page' });
    store().setPngOptions({ open: true });
    expect(store().pngOptions.open).toBe(true);
    store().setPngOptions({ scale: 9 });
    expect(store().pngOptions.scale).toBe(4);
    store().setPngOptions({ scale: 0.2 });
    expect(store().pngOptions.scale).toBe(1);
    store().setPngOptions({ scale: 3, transparent: true });
    expect(store().pngOptions).toMatchObject({ scale: 3, transparent: true });
    store().setPngOptions({ open: false });
    expect(store().pngOptions.open).toBe(false);
    // The document is untouched by export options.
    expect(store().past).toEqual([]);
  });

  it('ignores a no-op update', () => {
    const before = store().pngOptions;
    store().setPngOptions({ scale: 1, transparent: false, open: false, scope: 'page' });
    expect(store().pngOptions).toBe(before);
  });

  it('switches the export scope to the selection', () => {
    store().setPngOptions({ open: true, scope: 'selection' });
    expect(store().pngOptions.scope).toBe('selection');
    expect(store().pngOptions.open).toBe(true);
  });
});

describe('dev mode (M14)', () => {
  it('switches to the Inspect workspace and back', () => {
    const store = useEditor.getState();
    store.setRightTab('design');
    expect(useEditor.getState().devMode).toBe(false);

    useEditor.getState().toggleDevMode();
    // Dev Mode is a workspace: the panel follows it to Inspect.
    expect(useEditor.getState().devMode).toBe(true);
    expect(useEditor.getState().rightTab).toBe('inspect');

    useEditor.getState().toggleDevMode();
    expect(useEditor.getState().devMode).toBe(false);
    expect(useEditor.getState().rightTab).toBe('design');
  });

  it('sets and clears a frame development status, and persists it', () => {
    const file = emptyFile('Handoff');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 0, 0, 320, 240, { name: 'Checkout' });
    page.children = [frame];
    useEditor.setState({ file, pageId: page.id, selection: [frame.id], past: [], future: [], transaction: null });

    useEditor.getState().setDevStatus(frame.id, 'READY_FOR_DEVELOPMENT');
    expect((findNode(useEditor.getState().file.document, frame.id) as { devStatus?: string }).devStatus).toBe(
      'READY_FOR_DEVELOPMENT',
    );

    // The status is a document field: it survives a round trip.
    const round = parseFile(serializeFile(useEditor.getState().file)).file!;
    expect((findNode(round.document, frame.id) as { devStatus?: string }).devStatus).toBe('READY_FOR_DEVELOPMENT');

    useEditor.getState().setDevStatus(frame.id, 'COMPLETED');
    expect((findNode(useEditor.getState().file.document, frame.id) as { devStatus?: string }).devStatus).toBe('COMPLETED');

    // Clearing removes the field rather than storing a "none" value.
    useEditor.getState().setDevStatus(frame.id, null);
    expect((findNode(useEditor.getState().file.document, frame.id) as { devStatus?: string }).devStatus).toBeUndefined();

    // It is undoable like any other edit.
    useEditor.getState().undo();
    expect((findNode(useEditor.getState().file.document, frame.id) as { devStatus?: string }).devStatus).toBe('COMPLETED');
  });
});

describe('live booleans through the store (M14)', () => {
  it('re-evaluates when an operand moves, and undo restores the earlier geometry', () => {
    const file = emptyFile('Boolean');
    const page = file.document.children[0]!;
    const a = createRectNode(file.document, 0, 0, 100, 100);
    const b = createRectNode(file.document, 50, 50, 100, 100);
    page.children = [a, b];
    useEditor.setState({ file, pageId: page.id, selection: [a.id, b.id], past: [], future: [], transaction: null });

    useEditor.getState().booleanOp('UNION');
    const unionId = useEditor.getState().selection[0]!;
    const created = findNode(useEditor.getState().file.document, unionId) as { pathData?: string; width: number; children: Array<{ id: string }> };
    expect(created.pathData).toBeTruthy();
    const createdPath = created.pathData;
    const createdWidth = created.width;

    // Move an operand: the boolean is live, so its geometry changes with it.
    useEditor.getState().select([created.children[1]!.id]);
    useEditor.getState().moveSelection(200, 0);
    const moved = findNode(useEditor.getState().file.document, unionId) as { pathData?: string; width: number };
    expect(moved.pathData, 'moving an operand did not change the boolean').not.toBe(createdPath);
    expect(moved.width).toBeGreaterThan(createdWidth);

    // Undo restores the earlier evaluation exactly.
    useEditor.getState().undo();
    const undone = findNode(useEditor.getState().file.document, unionId) as { pathData?: string; width: number };
    expect(undone.pathData).toBe(createdPath);
    expect(undone.width).toBe(createdWidth);

    // ...and redo brings the live result back.
    useEditor.getState().redo();
    const redone = findNode(useEditor.getState().file.document, unionId) as { pathData?: string };
    expect(redone.pathData).toBe(moved.pathData);
  });
});

describe('nudge coalescing (history)', () => {
  /** A selected rectangle at x=100, with an empty history. */
  const scene = () => {
    const file = emptyFile('Nudge');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 100, 100, 50, 50);
    page.children = [rect];
    useEditor.setState({
      file,
      pageId: page.id,
      selection: [rect.id],
      past: [],
      future: [],
      transaction: null,
      editsSinceVersion: 0,
    });
    return rect.id;
  };
  const x = (id: string) => (findNode(useEditor.getState().file.document, id) as { transform: { tx: number } }).transform.tx;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('makes a rapid burst exactly one entry, so one undo restores the original', () => {
    const id = scene();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    for (let i = 0; i < 12; i += 1) {
      useEditor.getState().nudgeSelection(10, 0);
      vi.setSystemTime(1_000 + i * 20); // 20ms apart: one burst
    }
    expect(x(id)).toBe(220);
    expect(useEditor.getState().past.length, '12 nudges did not coalesce into one entry').toBe(1);
    // The burst is not split by the auto-version pass either (that was the
    // defect: one undo moved 11 of the 12 steps).
    expect(useEditor.getState().editsSinceVersion).toBe(12);

    useEditor.getState().undo();
    expect(x(id), 'one undo did not return the selection to where the burst started').toBe(100);
    expect(useEditor.getState().past).toHaveLength(0);
    useEditor.getState().redo();
    expect(x(id)).toBe(220);
  });

  it('starts a new entry after a pause, and one more for a later burst', () => {
    const id = scene();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    useEditor.getState().nudgeSelection(10, 0);
    useEditor.getState().nudgeSelection(10, 0);
    expect(useEditor.getState().past.length).toBe(1);

    // A pause longer than the window closes the burst.
    vi.setSystemTime(1_000 + BURST_WINDOW_MS + 50);
    useEditor.getState().nudgeSelection(10, 0);
    expect(useEditor.getState().past.length, 'a nudge after a pause was merged into the burst').toBe(2);

    // Undo steps back through the two entries, one burst at a time.
    useEditor.getState().undo();
    expect(x(id)).toBe(120);
    useEditor.getState().undo();
    expect(x(id)).toBe(100);
    useEditor.getState().redo();
    useEditor.getState().redo();
    expect(x(id)).toBe(130);
  });

  it('closes the burst when another action happens in between', () => {
    const id = scene();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    useEditor.getState().nudgeSelection(10, 0);
    // A different edit ends the burst even though it lands inside the window.
    useEditor.getState().apply('Rename', (file) => ({ ...file, name: 'Renamed' }));
    useEditor.getState().nudgeSelection(10, 0);
    expect(useEditor.getState().past.length).toBe(3);
    expect(x(id)).toBe(120);
    useEditor.getState().undo();
    expect(x(id)).toBe(110);
  });

  it('closes the burst on undo, so the next nudge is its own entry', () => {
    const id = scene();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    useEditor.getState().nudgeSelection(10, 0);
    useEditor.getState().undo();
    expect(x(id)).toBe(100);
    useEditor.getState().nudgeSelection(10, 0);
    expect(useEditor.getState().past.length).toBe(1);
    expect(x(id)).toBe(110);
  });
});

describe('version compare through the store', () => {
  it('reports changes, mutates nothing, and adds no history entry', () => {
    const file = emptyFile('Versions');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 0, 0, 100, 100);
    page.children = [rect];
    useEditor.setState({ file, pageId: page.id, selection: [rect.id], past: [], future: [], transaction: null });

    useEditor.getState().saveVersion('v1');
    const versionId = useEditor.getState().file.versions![0]!.id;

    // Move the layer, then add one: the comparison must see both.
    useEditor.getState().moveSelection(40, 20);
    useEditor.getState().addNode(createRectNode(null, 300, 0, 50, 50), page.id);
    const pastBefore = useEditor.getState().past.length;
    const documentBefore = useEditor.getState().file;

    useEditor.getState().compareVersion(versionId);
    const diff = useEditor.getState().compareDiff!;
    expect(diff.changed.map((change) => change.id)).toEqual([rect.id]);
    expect(diff.changed[0]!.properties).toContain('position');
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toEqual([]);

    // Read-only: the document is untouched and no history entry was added.
    expect(useEditor.getState().file).toBe(documentBefore);
    expect(useEditor.getState().past.length, 'comparing added a history entry').toBe(pastBefore);
    // The canvas is showing the version's content while comparing.
    expect(useEditor.getState().previewFile).not.toBeNull();
    expect(useEditor.getState().compareVersionId).toBe(versionId);

    // Leaving compare restores the normal view and still changes nothing.
    useEditor.getState().compareVersion(null);
    expect(useEditor.getState().compareDiff).toBeNull();
    expect(useEditor.getState().previewFile).toBeNull();
    expect(useEditor.getState().previewVersionId).toBeNull();
    expect(useEditor.getState().file).toBe(documentBefore);
    expect(useEditor.getState().past.length).toBe(pastBefore);
  });
});

describe('the burst closes on every path that ends one', () => {
  /** Two rectangles, the first selected, with an empty history. */
  const scene = () => {
    const file = emptyFile('Burst');
    const page = file.document.children[0]!;
    const a = createRectNode(file.document, 100, 100, 50, 50);
    const b = createRectNode(file.document, 300, 100, 50, 50);
    page.children = [a, b];
    useEditor.setState({
      file,
      pageId: page.id,
      selection: [a.id],
      past: [],
      future: [],
      transaction: null,
      editsSinceVersion: 0,
    });
    return { a: a.id, b: b.id, pageId: page.id };
  };
  const x = (id: string) => Math.round((findNode(useEditor.getState().file.document, id) as { transform: { tx: number } }).transform.tx);

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not merge nudges on two different nodes into one entry', () => {
    const { a, b } = scene();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    useEditor.getState().nudgeSelection(10, 0);
    useEditor.getState().nudgeSelection(10, 0);
    expect(useEditor.getState().past.length).toBe(1);

    // A selection change ends the burst even though it lands inside the window.
    useEditor.getState().select([b]);
    useEditor.getState().nudgeSelection(10, 0);
    expect(useEditor.getState().past.length, 'nudging a different node merged into the previous entry').toBe(2);
    expect(x(a)).toBe(120);
    expect(x(b)).toBe(310);

    // One undo steps back exactly one nudge.
    useEditor.getState().undo();
    expect(x(b)).toBe(300);
    expect(x(a)).toBe(120);
    useEditor.getState().undo();
    expect(x(a)).toBe(100);
  });

  it('starts a fresh burst when the document is replaced', () => {
    scene();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    useEditor.getState().nudgeSelection(10, 0);

    // A load inside the window: the burst belonged to the previous document.
    const importedFile = emptyFile('Imported');
    const importedPage = importedFile.document.children[0]!;
    importedPage.children = [createRectNode(importedFile.document, 500, 500, 40, 40)];
    useEditor.getState().loadFile(importedFile, 'Import');
    const imported = useEditor.getState().file.document.children[0]!.children[0]!;
    useEditor.getState().select([imported.id]);
    useEditor.getState().nudgeSelection(10, 0);
    expect(useEditor.getState().past.length, 'a nudge after a load merged into the previous document’s burst').toBe(3);

    // ...and the new document's nudge is its own entry.
    const before = useEditor.getState().past.length;
    const importedX = () => Math.round((findNode(useEditor.getState().file.document, imported.id) as { transform: { tx: number } }).transform.tx);
    expect(importedX()).toBe(510);
    useEditor.getState().undo();
    expect(useEditor.getState().past.length).toBe(before - 1);
    expect(importedX()).toBe(500);
  });

  it('closes the burst at a transaction boundary', () => {
    const { a } = scene();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    for (const boundary of ['begin', 'cancel', 'end'] as const) {
      useEditor.setState({ past: [], future: [], transaction: null, selection: [a] });
      useEditor.getState().nudgeSelection(10, 0);
      expect(useEditor.getState().past.length, boundary).toBe(1);

      if (boundary === 'begin') {
        useEditor.getState().beginTransaction();
        useEditor.getState().moveSelection(5, 0);
        useEditor.getState().endTransaction('Drag');
      } else if (boundary === 'cancel') {
        useEditor.getState().beginTransaction();
        useEditor.getState().moveSelection(5, 0);
        useEditor.getState().cancelTransaction();
      } else {
        useEditor.getState().beginTransaction();
        useEditor.getState().moveSelection(5, 0);
        useEditor.getState().endTransaction('Drag');
      }

      const entriesAfterBoundary = useEditor.getState().past.length;
      useEditor.getState().nudgeSelection(10, 0);
      expect(useEditor.getState().past.length, `a nudge after ${boundary} merged into the earlier burst`).toBe(
        entriesAfterBoundary + 1,
      );
    }
  });

  it('closes the burst when the view switches to a version', () => {
    const { a } = scene();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    useEditor.getState().saveVersion('v1');
    const versionId = useEditor.getState().file.versions![0]!.id;
    useEditor.setState({ past: [], future: [] });

    useEditor.getState().nudgeSelection(10, 0);
    expect(useEditor.getState().past.length).toBe(1);

    // Previewing clears the selection (the canvas shows the version), so the user
    // selects the layer again before the next nudge.
    useEditor.getState().previewVersion(versionId);
    useEditor.getState().previewVersion(null);
    useEditor.getState().select([a]);
    useEditor.getState().nudgeSelection(10, 0);
    expect(useEditor.getState().past.length, 'a nudge after a preview merged into the earlier burst').toBe(2);
    expect(x(a)).toBe(120);

    useEditor.getState().compareVersion(versionId);
    useEditor.getState().compareVersion(null);
    useEditor.getState().select([a]);
    useEditor.getState().nudgeSelection(10, 0);
    expect(useEditor.getState().past.length).toBe(3);
  });

  it('coalesces a plain burst, and a click on a layer ends it', () => {
    const { a } = scene();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    for (let i = 0; i < 6; i += 1) {
      useEditor.getState().nudgeSelection(10, 0);
      vi.setSystemTime(1_000 + i * 10);
    }
    expect(useEditor.getState().past.length).toBe(1);
    expect(x(a)).toBe(160);

    // Clicking a layer is a distinct action, so the next nudge is its own entry
    // even when the click lands on the same node.
    useEditor.getState().select([a]);
    useEditor.getState().nudgeSelection(10, 0);
    expect(useEditor.getState().past.length).toBe(2);
    expect(x(a)).toBe(170);
  });
});

describe('the burst key is O(1)', () => {
  it('never contains the selected ids, however many there are', () => {
    // Ten thousand ids is the select-all case the gate measured: the key must not
    // grow with the selection.
    const file = emptyFile('Many');
    const page = file.document.children[0]!;
    const ids: string[] = [];
    for (let i = 0; i < 10_000; i += 1) ids.push(`bulk-node-${i}`);
    useEditor.setState({ file, pageId: page.id, selection: ids, past: [], future: [], transaction: null });

    const key = currentBurstKey('nudge');
    // The key is the action, the document and a revision number — and the number
    // is its last segment (a document id is itself `session:counter`).
    expect(key.startsWith('nudge:')).toBe(true);
    const revision = key.slice(key.lastIndexOf(':') + 1);
    expect(Number.isFinite(Number(revision))).toBe(true);
    // The ids are absent, so the key cannot grow with the selection.
    expect(key).not.toContain('bulk-node');
    expect(key.length).toBeLessThan(120);
    expect(key.length).toBeLessThan(JSON.stringify(ids).length / 100);
  });

  it('still coalesces a burst on a huge selection, and a selection change splits it', () => {
    const file = emptyFile('Huge');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 100, 100, 50, 50);
    page.children = [rect];
    useEditor.setState({ file, pageId: page.id, selection: [rect.id], past: [], future: [], transaction: null });
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      // The key is built from a counter, so a burst is still one entry.
      useEditor.getState().nudgeSelection(10, 0);
      useEditor.getState().nudgeSelection(10, 0);
      useEditor.getState().nudgeSelection(10, 0);
      expect(useEditor.getState().past.length).toBe(1);

      // A selection change still starts a new burst, and the revision makes the
      // two keys distinct without ever comparing ids.
      const before = currentBurstKey('nudge');
      useEditor.getState().select([rect.id]);
      expect(currentBurstKey('nudge')).not.toBe(before);
      useEditor.getState().nudgeSelection(10, 0);
      expect(useEditor.getState().past.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('mask actions', () => {
  const setup = () => {
    useEditor.getState().loadFile(defaultDocument(), 'Mask actions');
    const page = useEditor.getState().file.document.children[0]!;
    return { page };
  };

  it('toggles the mask on the selection as one history entry', () => {
    const { page } = setup();
    const node = page.children[0]!;
    useEditor.getState().select([node.id]);
    const before = useEditor.getState().past.length;
    useEditor.getState().toggleMask();
    const after = useEditor.getState();
    expect((after.file.document.children[0]!.children[0] as { isMask?: boolean }).isMask).toBe(true);
    expect(after.past.length).toBe(before + 1);
    expect(after.past[after.past.length - 1]!.label).toBe('Use as mask');
  });

  it('removes the mask on a second toggle, also as one entry', () => {
    const { page } = setup();
    useEditor.getState().select([page.children[0]!.id]);
    useEditor.getState().toggleMask();
    const mid = useEditor.getState().past.length;
    useEditor.getState().toggleMask();
    const after = useEditor.getState();
    expect((after.file.document.children[0]!.children[0] as { isMask?: boolean }).isMask).toBeUndefined();
    expect(after.past.length).toBe(mid + 1);
    expect(after.past[after.past.length - 1]!.label).toBe('Remove mask');
  });

  it('undoes the whole toggle in one step', () => {
    const { page } = setup();
    useEditor.getState().select([page.children[0]!.id]);
    useEditor.getState().toggleMask();
    useEditor.getState().undo();
    expect((useEditor.getState().file.document.children[0]!.children[0] as { isMask?: boolean }).isMask).toBeUndefined();
  });

  it('applies to every unlocked node in a multiple selection', () => {
    const { page } = setup();
    const ids = page.children.slice(0, 3).map((child) => child.id);
    useEditor.getState().select(ids);
    useEditor.getState().toggleMask();
    const children = useEditor.getState().file.document.children[0]!.children;
    expect(ids.every((id) => (children.find((child) => child.id === id) as { isMask?: boolean }).isMask === true)).toBe(true);
  });

  it('ignores a locked node', () => {
    const { page } = setup();
    const node = page.children[0]!;
    useEditor.getState().apply('Lock', (file) => ({
      ...file,
      document: updateNode(file.document, node.id, (target) => ({ ...target, locked: true })),
    }));
    useEditor.getState().select([node.id]);
    const before = useEditor.getState().past.length;
    useEditor.getState().toggleMask();
    expect(useEditor.getState().past.length).toBe(before);
    expect((useEditor.getState().file.document.children[0]!.children[0] as { isMask?: boolean }).isMask).toBeUndefined();
  });
});
