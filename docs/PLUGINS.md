# Plugin engine

Pigma runs Figma Plugin API scripts in an isolated QuickJS (WASM) sandbox. The
engine is **shared** so the MCP `use_pigma` tool (Node) and the in-app editor
(browser) execute plugins with identical semantics.

## Module path

| Piece | Path | Environment |
| --- | --- | --- |
| Engine (generic interpreter + guest bootstrap) | `src/plugins/engine.ts` | any (no Node/bundler imports) |
| Plugin API host (model bridge) | `src/plugins/host.ts` | any (imports the model only) |
| Node binding (loader) | `src/mcp/plugin/interpreter.ts` | Node |
| Node binding, static import | `src/mcp/plugin/interpreter.node.ts` | Node + bundler |

The engine never imports a runtime, a Node builtin, or a bundler alias. Hosts
inject the QuickJS module as a **loader**.

## Exported API

```ts
import {
  createPluginEngine,
  type PluginEngineLoader,
  type PluginInterpreter,
  type PluginRunOptions,
  type PluginRunResult,
  type QuickJSModuleLike,
} from '../plugins/engine';

const engine: PluginInterpreter = createPluginEngine(loader);
const { file, output, logs, warnings, closed }: PluginRunResult = await engine.run(code, file, options);
```

- `createPluginEngine(loader: PluginEngineLoader): PluginInterpreter` — builds an
  engine. Construction never touches a runtime; the loader runs on the first
  `run`. Passing a non-function throws `TypeError`.
- `PluginEngineLoader = () => Promise<QuickJSModuleLike>` — returns the QuickJS
  module. `QuickJSModuleLike` is the minimal structural surface used
  (`newRuntime()`); it avoids a hard dependency on `quickjs-emscripten`.
- `PluginInterpreter.run(code, file, options?): Promise<PluginRunResult>`

### `run(code, file, options)`

`code` is a Figma Plugin API script; `file` is the document it edits; `options`:

| Option | Default | Meaning |
| --- | --- | --- |
| `timeoutMs` | `2000` | Wall-clock budget; the runtime interrupts the script past it. |
| `memoryLimitMb` | `32` | QuickJS memory ceiling. |
| `maxStackBytes` | `1 MB` | QuickJS stack ceiling. |
| `parameters` | — | Plugin parameter values, delivered to `figma.on('run')`. |
| `command` | — | Plugin command, delivered to the run event. |

The result:

| Field | Meaning |
| --- | --- |
| `file` | The document after the script ran. |
| `output` | The script's completion value, or the `figma.on('run')` handler's value. |
| `logs` | Full transcript, including guest `figma.notify` output. |
| `warnings` | Recoverable degradations: input the engine **converted or skipped** rather than honoured. Also present in `logs`. A non-empty list means the script ran but something was approximated. |
| `closed` | Whether the script called `figma.closePlugin()`. |

Failures (syntax errors, unsupported members, timeouts) **reject** the promise
with the guest error message; they are never reported as a successful run.

## Guarantees

Enforced by the engine for every host:

- The guest sees **no host bindings** beyond the Plugin API implemented in
  `src/plugins/host.ts`: no filesystem, network, process, `require`, or host
  `eval`. `figma.currentPage` and node objects are strict: any member outside
  the supported subset throws an explicit unsupported error instead of
  returning `undefined`.
- Memory, stack, and wall-clock ceilings are set on the QuickJS runtime.
- Unsupported input that can still be honoured is converted and reported in
  `warnings` (for example a `vectorNetwork` assignment becomes `pathData`).

## Writing a loader

Node (already provided by `src/mcp/plugin/interpreter.ts`):

```ts
export function createNodeQuickJSLoader(): PluginEngineLoader {
  return async () => (await import('quickjs-emscripten')).getQuickJS() as unknown as QuickJSModuleLike;
}
```

Browser (editor): bundle a QuickJS/WASM module and return it from the loader; the
engine, the host, and every behaviour above are unchanged.

```ts
import { createPluginEngine } from '../plugins/engine';
import { getQuickJS } from 'quickjs-emscripten'; // or a bundled WASM module

export const engine = createPluginEngine(async () => (await getQuickJS()) as unknown as QuickJSModuleLike);
```

## Supported Plugin API subset

The subset is documented in [`MCP.md`](./MCP.md#use_pigma--real-plugin-api-scripts-isolated)
(shared with `use_pigma`, since both run this engine).
