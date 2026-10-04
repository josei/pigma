import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE,
  PLUGIN_NAME_MAX,
  isRunnable,
  mergePlugins,
  newPlugin,
  normalizePluginName,
  persistablePlugins,
  readPlugins,
  upsertPlugin,
  type PluginRecord,
} from './registry';
import { BUILTIN_PLUGINS } from './builtins';

const user = (patch: Partial<PluginRecord> = {}): PluginRecord => ({
  id: 'user:1',
  name: 'Mine',
  source: 'console.log(1)',
  ...patch,
});

describe('plugin registry', () => {
  it('normalizes names and bounds their length', () => {
    expect(normalizePluginName('  My   plugin ')).toBe('My plugin');
    expect(normalizePluginName('   ')).toBe('Untitled plugin');
    expect(normalizePluginName('   ', 'Fallback')).toBe('Fallback');
    const long = normalizePluginName('x'.repeat(PLUGIN_NAME_MAX + 20));
    expect(long.length).toBeLessThanOrEqual(PLUGIN_NAME_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('creates plugins with a default source and a unique id', () => {
    const first = newPlugin();
    const second = newPlugin('Other');
    expect(first.source).toBe(DEFAULT_SOURCE);
    expect(first.id).not.toBe(second.id);
    expect(second.name).toBe('Other');
  });

  it('merges built-ins with stored plugins', () => {
    const merged = mergePlugins(BUILTIN_PLUGINS, [user()]);
    expect(merged).toHaveLength(BUILTIN_PLUGINS.length + 1);
    expect(merged.slice(0, BUILTIN_PLUGINS.length).every((plugin) => plugin.builtin)).toBe(true);
    expect(merged[merged.length - 1]!.name).toBe('Mine');
  });

  it('lets a stored plugin override a built-in with the same id', () => {
    const builtin = BUILTIN_PLUGINS[0]!;
    const edited = user({ id: builtin.id, name: 'Mine', source: 'figma.notify("hi")' });
    const merged = mergePlugins(BUILTIN_PLUGINS, [edited]);
    expect(merged).toHaveLength(BUILTIN_PLUGINS.length);
    const replaced = merged.find((plugin) => plugin.id === builtin.id)!;
    expect(replaced.name).toBe('Mine');
    expect(replaced.source).toBe('figma.notify("hi")');
    // It is no longer a built-in: the shipped source was replaced.
    expect(replaced.builtin).toBeUndefined();
  });

  it('keeps the built-in flag when the stored copy is unchanged', () => {
    const builtin = BUILTIN_PLUGINS[0]!;
    const merged = mergePlugins(BUILTIN_PLUGINS, [{ id: builtin.id, name: builtin.name, source: builtin.source }]);
    expect(merged.find((plugin) => plugin.id === builtin.id)!.builtin).toBe(true);
  });

  it('upserts by id, appending new plugins', () => {
    const list = [user()];
    const updated = upsertPlugin(list, user({ name: 'Renamed' }));
    expect(updated).toHaveLength(1);
    expect(updated[0]!.name).toBe('Renamed');
    const appended = upsertPlugin(list, user({ id: 'user:2' }));
    expect(appended.map((plugin) => plugin.id)).toEqual(['user:1', 'user:2']);
  });

  it('only persists user plugins, and restores them defensively', () => {
    const persisted = persistablePlugins([...BUILTIN_PLUGINS, user()]);
    expect(persisted).toEqual([{ id: 'user:1', name: 'Mine', source: 'console.log(1)' }]);

    expect(readPlugins(persisted)).toHaveLength(1);
    expect(readPlugins(null)).toEqual([]);
    expect(readPlugins([{ id: '', source: 'x' }, { id: 'a' }, 'nope', 42])).toEqual([]);
    // A missing name falls back rather than throwing.
    expect(readPlugins([{ id: 'a', source: 'x' }])[0]!.name).toBe('Untitled plugin');
  });

  it('knows which plugins can run', () => {
    expect(isRunnable(user())).toBe(true);
    expect(isRunnable(user({ source: '   \n ' }))).toBe(false);
  });

  it('ships runnable built-ins with unique ids', () => {
    expect(BUILTIN_PLUGINS.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(BUILTIN_PLUGINS.map((plugin) => plugin.id));
    expect(ids.size).toBe(BUILTIN_PLUGINS.length);
    for (const plugin of BUILTIN_PLUGINS) {
      expect(plugin.builtin).toBe(true);
      expect(isRunnable(plugin)).toBe(true);
      // Built-ins must not reach for host-only APIs.
      expect(plugin.source).not.toMatch(/\brequire\(|\bprocess\.|\bfetch\(/);
    }
  });
});
