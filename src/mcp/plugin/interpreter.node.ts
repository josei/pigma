/**
 * Node interpreter with a static import: bundler-based runners (vite-node, tsx)
 * resolve `quickjs-emscripten` at load time instead of relying on a runtime
 * dynamic import. Used by the CLI; other hosts build the shared engine
 * (`src/plugins/engine.ts`) with their own loader.
 */
import { getQuickJS } from 'quickjs-emscripten';
import { createPluginEngine, type PluginInterpreter, type QuickJSModuleLike } from '../../plugins/engine';

export function createNodePluginInterpreter(): PluginInterpreter {
  return createPluginEngine(async () => {
    // The library's module type is structurally compatible with the minimal
    // surface the engine uses; the cast only reconciles nominal types.
    return (await getQuickJS()) as unknown as QuickJSModuleLike;
  });
}
