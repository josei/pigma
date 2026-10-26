/**
 * In-app plugin registry (M15).
 *
 * A plugin is a name plus Figma Plugin API source. Built-ins ship with the app
 * and are merged in at load time, so an app update refreshes them; only the
 * user's own plugins are persisted. The registry is pure data plus small
 * helpers, which keeps the store and the panel thin.
 */
import { nextNodeId } from '../model/ids';

export interface PluginRecord {
  id: string;
  name: string;
  source: string;
  /** Built-ins cannot be deleted; editing one forks it into a user plugin. */
  builtin?: boolean;
}

export const PLUGIN_NAME_MAX = 60;

/** Trim and bound a plugin name, falling back to a stable default. */
export function normalizePluginName(name: string, fallback = 'Untitled plugin'): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return fallback;
  return trimmed.length > PLUGIN_NAME_MAX ? `${trimmed.slice(0, PLUGIN_NAME_MAX - 1)}…` : trimmed;
}

/** A new, empty user plugin. */
export function newPlugin(name = 'Untitled plugin', source = DEFAULT_SOURCE): PluginRecord {
  return { id: nextNodeId(), name: normalizePluginName(name), source };
}

export const DEFAULT_SOURCE = `// Figma Plugin API script. \`figma\` edits the open document.
const page = figma.currentPage;
console.log('Layers on this page:', page.children.length);
`;

/**
 * Built-ins first, then the user's plugins; a user plugin that shares a built-in
 * id replaces it (an edited built-in becomes a user copy with the same id).
 */
export function mergePlugins(builtins: PluginRecord[], stored: PluginRecord[]): PluginRecord[] {
  const byId = new Map<string, PluginRecord>();
  for (const plugin of builtins) byId.set(plugin.id, plugin);
  for (const plugin of stored) {
    const existing = byId.get(plugin.id);
    byId.set(plugin.id, {
      id: plugin.id,
      name: normalizePluginName(plugin.name, existing?.name ?? 'Untitled plugin'),
      source: typeof plugin.source === 'string' ? plugin.source : '',
      ...(existing?.builtin && plugin.source === existing.source ? { builtin: true } : {}),
    });
  }
  return [...byId.values()];
}

/** Insert or replace a plugin, keeping built-ins in front. */
export function upsertPlugin(plugins: PluginRecord[], plugin: PluginRecord): PluginRecord[] {
  const index = plugins.findIndex((entry) => entry.id === plugin.id);
  if (index < 0) return [...plugins, plugin];
  const next = [...plugins];
  next[index] = plugin;
  return next;
}

/** True when the plugin has something to run. */
export function isRunnable(plugin: PluginRecord): boolean {
  return plugin.source.trim().length > 0;
}

/** Only user-authored plugins are persisted. */
export function persistablePlugins(plugins: PluginRecord[]): PluginRecord[] {
  return plugins.filter((plugin) => !plugin.builtin).map(({ id, name, source }) => ({ id, name, source }));
}

/** Structural guard for a restored payload: anything malformed is dropped. */
export function readPlugins(value: unknown): PluginRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id === '') return [];
    if (typeof record.source !== 'string') return [];
    return [{ id: record.id, name: normalizePluginName(typeof record.name === 'string' ? record.name : ''), source: record.source }];
  });
}
