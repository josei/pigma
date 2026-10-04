/**
 * Shared, environment-agnostic plugin engine.
 *
 * Runs Figma Plugin API scripts against a Pigma document with the same
 * semantics everywhere: the MCP `use_pigma` tool (Node) and the in-app editor
 * (browser) both build an engine here. The QuickJS/WASM module is injected as a
 * *loader*, so this module never imports a runtime, Node builtin, or bundler
 * alias:
 *
 * ```ts
 * import { createPluginEngine } from '../plugins/engine';
 * const engine = createPluginEngine(async () => (await getQuickJS()) as QuickJSModuleLike);
 * const { file, output, logs, warnings } = await engine.run(code, file, { timeoutMs: 2000 });
 * ```
 *
 * Loaders: `src/mcp/plugin/interpreter.ts` supplies the Node loader (lazy
 * `quickjs-emscripten`); a browser host supplies its own (e.g. a bundled WASM
 * module). See `docs/PLUGINS.md`.
 *
 * Guarantees, enforced for every host:
 * - the guest sees **no host bindings** beyond the Plugin API implemented in
 *   `./host`: no filesystem, network, process, `require`, or host `eval`;
 * - memory, stack, and wall-clock ceilings are set on the QuickJS runtime;
 * - anything outside the supported subset fails with an explicit error, never a
 *   silent no-op.
 *
 * Async support: the script is wrapped in an async function and QuickJS's job
 * queue is drained, so `await figma.loadFontAsync(...)` and async helpers work.
 */
import type { BooleanMode } from '../model/boolean';
import type { PigmaFile } from '../model/types';
import { createPluginHost, type PluginHost } from './host';
import { BOOTSTRAP } from './bootstrap';

export interface PluginRunOptions {
  /** Wall-clock budget for the script. Default 2000 ms. */
  timeoutMs?: number;
  /** Memory ceiling for the QuickJS runtime. Default 32 MB. */
  memoryLimitMb?: number;
  /** Stack ceiling. Default 1 MB. */
  maxStackBytes?: number;
  /** Plugin parameter values, delivered to `figma.on('run')` like Figma's. */
  parameters?: Record<string, unknown>;
  /** Plugin command, delivered to the run event. */
  command?: string;
}

export interface PluginRunResult {
  file: PigmaFile;
  /** The script's completion value, or the `figma.on('run')` handler's value. */
  output: unknown;
  /** Full transcript, including guest `figma.notify` output. */
  logs: string[];
  /**
   * Recoverable degradations — input the engine converted or skipped rather
   * than honoured (also present in `logs`). A non-empty list means the script
   * ran but something was approximated; it is never a silent success.
   */
  warnings: string[];
  /** Whether the script called `figma.closePlugin()`. */
  closed: boolean;
}

export interface PluginInterpreter {
  run(code: string, file: PigmaFile, options?: PluginRunOptions): Promise<PluginRunResult>;
}

/**
 * Supplies the QuickJS/WASM module. Hosts inject their own: the Node MCP server
 * lazily imports `quickjs-emscripten`, a browser host bundles its own module.
 */
export type PluginEngineLoader = () => Promise<QuickJSModuleLike>;

// ─── Minimal QuickJS surface (structural; avoids a hard dependency) ─────────

interface QjsHandle {
  dispose(): void;
}

interface QjsEvalResult {
  value?: QjsHandle;
  error?: QjsHandle;
}

interface QjsContext {
  global: QjsHandle;
  undefined: QjsHandle;
  true: QjsHandle;
  false: QjsHandle;
  /** `options.compileOnly` gives bytecode without running anything. */
  evalCode(code: string, filename?: string, options?: { compileOnly?: boolean }): QjsEvalResult;
  newFunction(name: string, impl: (...args: QjsHandle[]) => QjsHandle): QjsHandle;
  newString(value: string): QjsHandle;
  setProp(target: QjsHandle, key: string, value: QjsHandle): void;
  dump(handle: QjsHandle): unknown;
  dispose(): void;
}

interface QjsRuntime {
  setMemoryLimit(bytes: number): void;
  setMaxStackSize(bytes: number): void;
  setInterruptHandler(handler: () => boolean): void;
  executePendingJobs(): number;
  newContext(): QjsContext;
  dispose(): void;
}

interface QjsModule {
  newRuntime(): QjsRuntime;
}

/** The minimal QuickJS surface a loader must provide. */
export type QuickJSModuleLike = QjsModule;

function guestError(vm: QjsContext, handle: QjsHandle): string {
  const dumped = vm.dump(handle);
  if (typeof dumped === 'string') return dumped;
  if (typeof dumped === 'object' && dumped !== null) {
    const record = dumped as { name?: unknown; message?: unknown };
    return `${String(record.name ?? 'Error')}: ${String(record.message ?? 'unknown')}`;
  }
  return 'unknown error';
}

/**
 * Compile the source WITHOUT running it, returning the error message on failure.
 * `compileOnly` gives QuickJS the bytecode and nothing executes, so probing can
 * never repeat a side effect.
 *
 * This is the retry gate. Classifying by the error name would be wrong: a script
 * that compiles and then throws a runtime `SyntaxError` would be mistaken for a
 * parse failure and run twice.
 */
function compileError(vm: QjsContext, source: string, asFunctionBody: boolean): string | null {
  const probe = asFunctionBody ? `(async function () {\n${source}\n})` : source;
  const compiled = vm.evalCode(probe, undefined, { compileOnly: true });
  const failure = compiled.error ? guestError(vm, compiled.error) : null;
  compiled.error?.dispose();
  compiled.value?.dispose();
  return failure;
}

interface Captured {
  ok: boolean;
  value?: unknown;
  error?: string;
}

function defineHostBridge(vm: QjsContext, host: PluginHost, captured: { current: Captured | null }): void {
  const define = (name: string, impl: (...args: unknown[]) => unknown): void => {
    const fn = vm.newFunction(name, (...handles) => {
      const args = handles.map((handle) => vm.dump(handle));
      const value = impl(...args);
      if (value === undefined) return vm.undefined;
      if (typeof value === 'boolean') return value ? vm.true : vm.false;
      return vm.newString(typeof value === 'string' ? value : JSON.stringify(value));
    });
    vm.setProp(vm.global, name, fn);
    fn.dispose();
  };

  define('__pigmaCreate', (kind, argsJson) => host.create(String(kind), JSON.parse(String(argsJson)) as Record<string, unknown>));
  define('__pigmaCombine', (idsJson, parentId) => {
    const ids = JSON.parse(String(idsJson)) as string[];
    const parent = parentId === null || parentId === undefined || parentId === 'null' ? undefined : String(parentId);
    return host.combineAsVariants(ids, parent);
  });
  define('__pigmaBoolean', (idsJson, mode, parentId) => {
    const ids = JSON.parse(String(idsJson)) as string[];
    const parent = parentId === null || parentId === undefined || parentId === 'null' ? undefined : String(parentId);
    return host.booleanOperation(ids, String(mode) as BooleanMode, parent);
  });
  define('__pigmaWarn', (text) => {
    host.warn(String(text));
    return null;
  });
  define('__pigmaGet', (nodeId, prop) => JSON.stringify(host.get(String(nodeId), String(prop)) ?? null));
  define('__pigmaSet', (nodeId, prop, valueJson) => {
    host.set(String(nodeId), String(prop), JSON.parse(String(valueJson)));
  });
  define('__pigmaCall', (nodeId, method, argsJson) => {
    const result = host.call(String(nodeId), String(method), JSON.parse(String(argsJson)) as unknown[]);
    return JSON.stringify(result ?? null);
  });
  define('__pigmaPageId', () => host.pageId());
  define('__pigmaDocumentId', () => host.documentId());
  define('__pigmaHasNode', (nodeId) => host.hasNode(String(nodeId)));
  define('__pigmaChildren', (nodeId) => JSON.stringify(host.children(String(nodeId))));
  define('__pigmaSelection', () => JSON.stringify(host.getSelection()));
  define('__pigmaSetSelection', (idsJson) => {
    host.setSelection(JSON.parse(String(idsJson)) as string[]);
  });
  define('__pigmaLog', (text) => {
    host.log(String(text));
  });
  define('__pigmaClose', () => {
    host.close();
  });
  define('__pigmaResult', (json) => {
    captured.current = { ok: true, value: JSON.parse(String(json)) };
  });
  define('__pigmaError', (message) => {
    captured.current = { ok: false, error: String(message) };
  });
}

/** Run pending promise jobs to completion (bounded). */
function drain(runtime: QjsRuntime): void {
  for (let i = 0; i < 1_000_000; i++) {
    if (!runtime.executePendingJobs()) break;
  }
}

/**
 * Invoke the script's `figma.on('run')` handlers (Figma's real entry point).
 * Returns whether any handler was registered.
 */
function fireRun(vm: QjsContext, runtime: QjsRuntime): boolean {
  const fired = vm.evalCode('globalThis.__pigmaFireRun()');
  if (fired.error) {
    const message = guestError(vm, fired.error);
    fired.error.dispose();
    fired.value?.dispose();
    throw new Error(`Plugin script failed: ${message}`);
  }
  const didFire = fired.value === undefined ? false : vm.dump(fired.value) === true;
  fired.value?.dispose();
  if (didFire) drain(runtime);
  return didFire;
}

/**
 * Create a plugin engine. The QuickJS module is loaded on first `run` through
 * the supplied loader, so construction never touches a runtime.
 */
export function createPluginEngine(load: PluginEngineLoader): PluginInterpreter {
  if (typeof load !== 'function') {
    throw new TypeError('createPluginEngine(loader) requires a loader returning the QuickJS module');
  }
  return {
    async run(code, file, options = {}) {
      const qjs = await load();
      const runtime = qjs.newRuntime();
      runtime.setMemoryLimit((options.memoryLimitMb ?? 32) * 1024 * 1024);
      runtime.setMaxStackSize(options.maxStackBytes ?? 1024 * 1024);
      const deadline = Date.now() + (options.timeoutMs ?? 2000);
      runtime.setInterruptHandler(() => Date.now() > deadline);

      const vm = runtime.newContext();
      try {
        const host = createPluginHost(file);
        const captured: { current: Captured | null } = { current: null };
        defineHostBridge(vm, host, captured);

        const runContextJson = JSON.stringify({
          command: options.command ?? null,
          parameters: options.parameters ?? null,
        });
        const contextFn = vm.newFunction('__pigmaRunContextJson', () => vm.newString(runContextJson));
        vm.setProp(vm.global, '__pigmaRunContextJson', contextFn);
        contextFn.dispose();

        const bootstrap = vm.evalCode(BOOTSTRAP);
        if (bootstrap.error) {
          const message = guestError(vm, bootstrap.error);
          bootstrap.error.dispose();
          bootstrap.value?.dispose();
          throw new Error(`Plugin bootstrap failed: ${message}`);
        }
        bootstrap.value?.dispose();

        // A Figma plugin script is always an async function body, so a top-level
        // `return` is legal and idiomatic. Compile-only probes decide how to run
        // it — neither executes anything, so no side effect can ever repeat:
        //
        //  - not valid as an async body at all -> a genuine syntax error, reported
        //    as such (nothing ran);
        //  - valid as a plain script -> run it as written, which keeps eval's
        //    completion value (the last expression) for the common case;
        //  - valid only as a function body (a top-level `return` or `await`) ->
        //    run it wrapped in an async function.
        const syntax = compileError(vm, code, true);
        if (syntax !== null) {
          throw new Error(`Plugin script failed: the script is not valid JavaScript (${syntax})`);
        }
        let evaluated;
        let wrapped = false;
        if (compileError(vm, code, false) === null) {
          evaluated = vm.evalCode(code);
        } else {
          wrapped = true;
          evaluated = vm.evalCode(`(async function () {
            try {
              const __pigmaValue = await (async function () {
${code}
              })();
              globalThis.__pigmaResult(JSON.stringify(__pigmaValue === undefined ? null : __pigmaValue));
            } catch (error) {
              globalThis.__pigmaError(String((error && error.message) || error));
            }
          })();`);
        }
        if (evaluated.error) {
          // The code compiles, so this is a runtime failure: reported as it is,
          // never retried.
          const message = guestError(vm, evaluated.error);
          evaluated.error.dispose();
          evaluated.value?.dispose();
          throw new Error(`Plugin script failed: ${message}`);
        }

        // The wrapped form reports through __pigmaResult; the unwrapped form keeps
        // eval's completion value.
        const completion = wrapped || evaluated.value === undefined ? null : vm.dump(evaluated.value);
        evaluated.value?.dispose();

        // Drive promises to completion (QuickJS resolves them via the job queue).
        drain(runtime);

        // A wrapped script reports its own outcome; a failure it caught is a
        // failure of the run, and the run handler must not fire after it.
        if (captured.current && !captured.current.ok) {
          throw new Error(`Plugin script failed: ${captured.current.error ?? 'unknown error'}`);
        }

        const fired = fireRun(vm, runtime);
        if (wrapped && !captured.current && !fired) {
          // The wrapped script always reports unless its promise never settled.
          throw new Error('Plugin script failed: the script did not complete (no result reported).');
        }
        // A run handler reports after the script, so `captured` holds the
        // handler's value when one registered — Figma's entry point wins — and
        // the script's own value otherwise.
        const output = captured.current ? captured.current.value ?? null : completion;
        return {
          file: host.file,
          output,
          logs: host.logs,
          warnings: host.warnings,
          closed: host.closed,
        };
      } finally {
        vm.dispose();
        runtime.dispose();
      }
    },
  };
}
