/**
 * Node binding for the shared plugin engine.
 *
 * The engine itself is environment-agnostic (`src/plugins/engine.ts`); this
 * module is the Node side of the split: it supplies the loader for
 * `quickjs-emscripten`, which is an optional peer imported lazily by name so the
 * server starts without it until a script actually runs. Bundler-based Node
 * runners should use `./interpreter.node`, which imports the module statically.
 *
 * Browser hosts build the engine directly with their own loader — see
 * `docs/PLUGINS.md`.
 */
import { createPluginEngine, type PluginEngineLoader, type PluginInterpreter, type QuickJSModuleLike } from '../../plugins/engine';

let modulePromise: Promise<QuickJSModuleLike> | null = null;

/**
 * Node loader: resolves `quickjs-emscripten` on first use and caches it. Throws
 * a clear, actionable error when the optional peer is not installed.
 */
export function createNodeQuickJSLoader(): PluginEngineLoader {
  return async () => {
    modulePromise ??= (async () => {
      try {
        const imported = (await import('quickjs-emscripten')) as { getQuickJS: () => Promise<unknown> };
        return (await imported.getQuickJS()) as QuickJSModuleLike;
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `use_pigma code execution needs the optional \`quickjs-emscripten\` package (npm install quickjs-emscripten): ${detail}`,
          { cause },
        );
      }
    })();
    return modulePromise;
  };
}

/**
 * Create the Node interpreter. The WASM runtime loads on first `run` through
 * the Node loader unless another loader is injected.
 */
export function createPluginInterpreter(loader?: PluginEngineLoader): PluginInterpreter {
  return createPluginEngine(loader ?? createNodeQuickJSLoader());
}
