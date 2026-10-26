import { createPluginEngine, type PluginEngineLoader, type PluginInterpreter, type QuickJSModuleLike } from './engine';

/**
 * Browser binding for the shared plugin engine (M15).
 *
 * QuickJS is WebAssembly and weighs more than the editor itself, so nothing here
 * is imported statically: the loader pulls the module (and the wasm asset) on the
 * first plugin run, which keeps the initial bundle free of it. The wasm URL comes
 * from a `?url` import so Vite emits the asset and the Emscripten loader is told
 * where it lives, instead of guessing a path next to the bundled chunk.
 */
export function createBrowserQuickJSLoader(): PluginEngineLoader {
  let modulePromise: Promise<QuickJSModuleLike> | null = null;
  return () => {
    modulePromise ??= (async () => {
      const [core, variantModule, wasmUrl] = await Promise.all([
        import('quickjs-emscripten-core'),
        import('@jitl/quickjs-wasmfile-release-sync'),
        import('@jitl/quickjs-wasmfile-release-sync/wasm?url'),
      ]);
      const variant = core.newVariant(variantModule.default, {
        locateFile: () => wasmUrl.default,
      });
      return (await core.newQuickJSWASMModuleFromVariant(variant)) as unknown as QuickJSModuleLike;
    })();
    return modulePromise;
  };
}

let engine: PluginInterpreter | null = null;

/**
 * The editor's engine. Created on first use; tests replace it through
 * `setPluginEngine` so the store's run path can be exercised without WASM.
 */
export function getPluginEngine(): PluginInterpreter {
  engine ??= createPluginEngine(createBrowserQuickJSLoader());
  return engine;
}

/** Swap the engine (tests, or a future server-backed interpreter). */
export function setPluginEngine(next: PluginInterpreter | null): void {
  engine = next;
}
