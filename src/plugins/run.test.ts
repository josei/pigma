import { beforeEach, describe, expect, it } from 'vitest';
import { createPluginEngine, type PluginInterpreter, type PluginRunResult } from './engine';
import { BUILTIN_PLUGINS } from './builtins';
import { setPluginEngine } from './browserLoader';
import { useEditor } from '../store/editorStore';
import { emptyFile } from '../model/validate';
import { createFrameNode, createRectNode } from '../model/factory';
import { findNode } from '../model/tree';
import type { PigmaFile, SceneNode } from '../model/types';

const store = () => useEditor.getState();

function scene(): PigmaFile {
  const file = emptyFile('Plugins');
  const page = file.document.children[0]!;
  const frame = createFrameNode(null, 0, 0, 200, 200, { name: 'Frame' });
  const rect = createRectNode(null, 10, 10, 40, 40);
  rect.name = 'Rect';
  frame.children = [rect];
  page.children = [frame];
  return file;
}

/** Interpreter double: returns a fixed document and transcript. */
function fakeEngine(result: Partial<PluginRunResult> & { throw?: string }): PluginInterpreter {
  return {
    async run(_code, file) {
      if (result.throw) throw new Error(result.throw);
      return {
        file: result.file ?? file,
        output: result.output ?? null,
        logs: result.logs ?? [],
        warnings: result.warnings ?? [],
        closed: result.closed ?? false,
      };
    },
  };
}

describe('running plugins through the store', () => {
  beforeEach(() => {
    const file = scene();
    useEditor.setState({
      file,
      pageId: file.document.children[0]!.id,
      selection: [],
      past: [],
      future: [],
      transaction: null,
      plugins: BUILTIN_PLUGINS,
      pluginConsole: [],
      pluginRunning: null,
    });
    setPluginEngine(null);
  });

  it('applies the result as exactly one undo entry', async () => {
    const before = store().file;
    const renamed = { ...before, name: 'Renamed by plugin' };
    setPluginEngine(fakeEngine({ file: renamed, logs: ['hello'], output: { changed: 3 } }));
    await store().runPlugin('builtin:rename-layers');

    expect(store().file.name).toBe('Renamed by plugin');
    expect(store().past).toHaveLength(1);
    expect(store().past[0]!.label).toBe('Run plugin: Rename layers to a pattern');
    store().undo();
    expect(store().file).toBe(before);
    store().redo();
    expect(store().file.name).toBe('Renamed by plugin');
  });

  it('records logs, warnings, the completion value and a summary', async () => {
    setPluginEngine(fakeEngine({ logs: ['one', 'two'], warnings: ['approximated'], output: 'done', closed: true }));
    await store().runPlugin('builtin:frame-grid');
    const console_ = store().pluginConsole;
    expect(console_.map((entry) => entry.kind)).toEqual(['info', 'log', 'log', 'warning', 'log', 'success']);
    expect(console_.map((entry) => entry.text)).toContain('one');
    expect(console_.map((entry) => entry.text)).toContain('approximated');
    expect(console_.map((entry) => entry.text)).toContain('↩ done');
    expect(console_[console_.length - 1]!.text).toContain('closed the plugin');
  });

  it('reports failures as console errors without touching the document', async () => {
    const before = store().file;
    setPluginEngine(fakeEngine({ throw: 'figma.ui is not supported by Pigma (headless interpreter).' }));
    await store().runPlugin('builtin:round-corners');
    expect(store().file).toBe(before);
    expect(store().past).toHaveLength(0);
    const last = store().pluginConsole[store().pluginConsole.length - 1]!;
    expect(last.kind).toBe('error');
    expect(last.text).toContain('figma.ui is not supported');
    expect(store().pluginRunning).toBeNull();
  });

  it('refuses an empty plugin and an unknown id', async () => {
    await store().runPlugin('missing');
    expect(store().pluginConsole).toHaveLength(0);
    const id = store().savePlugin({ name: 'Empty', source: '   ' });
    await store().runPlugin(id);
    expect(store().pluginConsole[0]!.kind).toBe('error');
    expect(store().pluginConsole[0]!.text).toContain('no source');
  });

  it('saves, forks built-ins and deletes user plugins', () => {
    const builtin = BUILTIN_PLUGINS[0]!;
    const created = store().savePlugin({ name: 'Mine', source: 'console.log(1)' });
    expect(store().plugins.find((plugin) => plugin.id === created)!.name).toBe('Mine');
    // Editing an existing user plugin updates it in place.
    store().savePlugin({ id: created, name: 'Renamed', source: 'console.log(2)' });
    const updated = store().plugins.find((plugin) => plugin.id === created)!;
    expect(updated.name).toBe('Renamed');
    expect(updated.source).toBe('console.log(2)');
    // Editing a built-in forks it.
    const fork = store().savePlugin({ id: builtin.id, name: builtin.name, source: 'console.log(3)' });
    expect(fork).not.toBe(builtin.id);
    expect(store().plugins.find((plugin) => plugin.id === builtin.id)!.builtin).toBe(true);
    // Built-ins cannot be deleted; user plugins can.
    store().deletePlugin(builtin.id);
    expect(store().plugins.some((plugin) => plugin.id === builtin.id)).toBe(true);
    store().deletePlugin(created);
    expect(store().plugins.some((plugin) => plugin.id === created)).toBe(false);
  });

  it('keeps the console bounded', () => {
    for (let index = 0; index < 400; index += 1) store().appendPluginConsole({ kind: 'log', text: `line ${index}` });
    expect(store().pluginConsole.length).toBe(300);
    expect(store().pluginConsole[store().pluginConsole.length - 1]!.text).toBe('line 399');
    store().clearPluginConsole();
    expect(store().pluginConsole).toEqual([]);
  });

  it('runs the built-in sources through the real engine', async () => {
    // A loader that fails the test if the browser loader were needed: this suite
    // exercises the shared engine with the model, not the WASM binding.
    const quickjs = await import('quickjs-emscripten');
    const engine = createPluginEngine(async () => (await quickjs.getQuickJS()) as never);
    setPluginEngine(engine);

    await store().runPlugin('builtin:rename-layers');
    const page = store().file.document.children[0]!;
    expect((page.children[0] as SceneNode).name).toBe('Layer 1');
    expect(((page.children[0] as SceneNode & { children: SceneNode[] }).children[0] as SceneNode).name).toBe('Layer 2');
    expect(store().past).toHaveLength(1);
    expect(store().pluginConsole.some((entry) => entry.text.includes('Renamed 2 layers'))).toBe(true);

    await store().runPlugin('builtin:round-corners');
    expect((findNode(store().file.document, page.children[0]!.id) as SceneNode).cornerRadius).toBe(16);

    await store().runPlugin('builtin:frame-grid');
    const created = (store().file.document.children[0]!.children as SceneNode[]).filter((node) => node.name.startsWith('Grid '));
    expect(created).toHaveLength(6);
    expect(created[0]!.transform.tx).toBe(40);
    expect(created[3]!.transform.ty).toBe(224);
  }, 60_000);

  it('restores layer names with one undo after a rename plugin', async () => {
    const quickjs = await import('quickjs-emscripten');
    setPluginEngine(createPluginEngine(async () => (await quickjs.getQuickJS()) as never));
    const before = store().file;
    const namesBefore = (before.document.children[0]!.children as SceneNode[]).map((node) => node.name);
    expect(namesBefore).toEqual(['Frame']);

    await store().runPlugin('builtin:rename-layers');
    const renamed = (store().file.document.children[0]!.children as SceneNode[]).map((node) => node.name);
    expect(renamed).toEqual(['Layer 1']);
    // Exactly one entry, and it carries the whole pre-run document: names included.
    expect(store().past).toHaveLength(1);
    expect(store().past[0]!.file.document.children[0]!.children).toBe(before.document.children[0]!.children);

    store().undo();
    expect((store().file.document.children[0]!.children as SceneNode[]).map((node) => node.name)).toEqual(['Frame']);
    store().redo();
    expect((store().file.document.children[0]!.children as SceneNode[]).map((node) => node.name)).toEqual(['Layer 1']);
  }, 60_000);

  it('keeps the sandbox closed: require, process and fetch are unavailable', async () => {
    const quickjs = await import('quickjs-emscripten');
    const engine = createPluginEngine(async () => (await quickjs.getQuickJS()) as never);
    setPluginEngine(engine);
    const id = store().savePlugin({ name: 'Escape attempt', source: 'const fs = require("fs");' });
    await store().runPlugin(id);
    const last = store().pluginConsole[store().pluginConsole.length - 1]!;
    expect(last.kind).toBe('error');
    expect(last.text.toLowerCase()).toContain('require');
    expect(store().past).toHaveLength(0);

    const fetchId = store().savePlugin({ name: 'Fetch attempt', source: 'fetch("https://example.com")' });
    await store().runPlugin(fetchId);
    const fetchLine = store().pluginConsole[store().pluginConsole.length - 1]!;
    expect(fetchLine.kind).toBe('error');
    expect(fetchLine.text).toContain('fetch');
  }, 60_000);
});
