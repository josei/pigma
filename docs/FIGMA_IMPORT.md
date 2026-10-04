# Figma Import

Real Figma import for Pigma: both the **Figma REST API document model** and the
**native `.fig` binary format**. Imported documents become a
[`PigmaFile`](../src/model/types.ts) with the original hierarchy, ids, and
ordering preserved; every node keeps its source object verbatim in `raw`, and
anything that cannot be represented is reported — never silently dropped.

Owner: `src/figma/**`, `tests/figma/**`, this file.

---

## TL;DR

```ts
// REST JSON (zero dependencies)
import { parseFigmaRestFile, toPigmaFile } from './src/figma';
const { file, report } = toPigmaFile(parseFigmaRestFile(await res.json()));

// Native .fig (Node)
import { nodeDecompressors } from './src/figma/native/node';
import { parseFigFile } from './src/figma';
const doc = parseFigFile(new Uint8Array(await blob.arrayBuffer()), nodeDecompressors);
const { file: nativeFile, report: nativeReport } = toPigmaFile(doc);
```

`report.unsupported` lists every feature with no Pigma representation
(`{ nodeId, path, feature, detail }`); `report.warnings` lists approximations.

---

## Public API (`src/figma/index.ts`)

| Function | Purpose |
| --- | --- |
| `parseFigmaRestFile(json, opts?)` | `GET /v1/files/:key` response → `FigmaRestFile` |
| `parseFigmaRestNodes(json, opts?)` | `GET /v1/files/:key/nodes?ids=…` response → `FigmaRestFile` |
| `parseFigmaRest(json, opts?)` | Auto-detects either response shape |
| `walkFigmaRest(node, visit)` | Depth-first walk of a REST subtree |
| `parseFigFile(bytes, decompress)` | Native `.fig` ZIP **or** bare `canvas.fig` |
| `parseFigArchive(bytes, decompress)` | Native `.fig` / `.deck` / `.jam` ZIP |
| `parseFigBinary(bytes, decompress)` | Raw `canvas.fig` (prelude + chunks) |
| `indexNativeNodes(nodes)` | Hierarchy index + cycle/duplicate validation |
| `decodeBinarySchema(bytes)` / `compileSchema(schema)` | Kiwi binary schema/message codec |
| `decodeCommandsBlob(bytes)` / `commandsToSvgPath(cmds)` | Native vector path geometry |
| `parseVectorNetworkBlob(bytes)` / `vectorNetworkToSvgPath(net)` | Native vector network |
| `figmaRestToPigmaFile(source, opts?)` | REST → `PigmaFile` |
| `figDocumentToPigmaFile(source, opts?)` | Native → `PigmaFile` |
| `toPigmaFile(source, opts?)` | Either → `PigmaFile` |
| `loadDecompressors()` | Browser: lazily resolve optional `fflate` + `fzstd` |

Key types: `FigmaRestFile`, `FigmaRestNode`, `FigmaRestFileResponse`,
`FigmaRestNodesResponse` (REST); `FigDocument`, `FigNode`, `FigPaint`,
`FigEffect` (native); `NormalizedNode`, `ImportReport`, `UnsupportedItem`,
`FigmaImportResult` (conversion); `FigmaImportError` with a stable `code`.

### `FigmaImportError.code`

`INVALID_INPUT`, `INVALID_DOCUMENT`, `MISSING_FIELD`, `DUPLICATE_ID`, `CYCLE`,
`INVALID_BINARY`, `TRUNCATED`, `UNSUPPORTED_ARCHIVE`, `UNSUPPORTED_COMPRESSION`.

Malformed input is rejected up front: missing `id`/`type`, non-array
`children`, duplicate node ids, dangling parents, and cyclic hierarchies (REST
child chains and native `parentIndex` chains).

---

## Integration contract for the editor

`toPigmaFile` returns `{ file: PigmaFile, report: ImportReport }`. The editor
loads `file` directly:

- `file.document` is a `DocumentNode`; `file.document.children` are `CanvasNode`
  pages (Figma `CANVAS`).
- Every node's `transform` is **parent-relative** (`[[a, c, tx], [b, d, ty]]` →
  `Transform`), matching Figma's `relativeTransform`.
- `raw` on each node is the **original source object** (same reference for REST),
  so a future export path can round-trip fields the model does not name.
- `file.meta` carries file-level Figma resources: `components`,
  `componentSets`, `styles`, `role`, `editorType`, `version`, `schemaVersion`,
  `thumbnailUrl` (REST) or `figmaFormat`, `formatVersion`, `fileMeta`, `images`
  (native).
- `file.source = { kind: 'figma', fileKey?, importedAt }`.

Call `bumpSession` (`src/model/ids.ts`) after import if locally created nodes
must not collide with imported ids.

### Coordinate derivation

- If the source provides a relative transform (REST `relativeTransform`, native
  `transform`), it is used verbatim.
- Otherwise REST `absoluteBoundingBox` is converted to parent-relative
  translation by subtracting the parent's absolute box. Rotated nodes without a
  `relativeTransform` are **approximated** and produce a warning — request
  `geometry=paths` from the REST API to get exact transforms.
- Native children are ordered by `parentIndex.position` (Figma's z-order), not
  by `nodeChanges` order.

---

## What maps to what

| Figma | Pigma |
| --- | --- |
| `DOCUMENT` / `CANVAS` | `DocumentNode` / `CanvasNode` (page) |
| `FRAME`, `GROUP`, `SECTION`, `BOOLEAN_OPERATION` | `ContainerNode` |
| `COMPONENT`, `COMPONENT_SET` | `ComponentNode` (+ `componentPropertyDefinitions`, `description`) |
| `INSTANCE` | `InstanceNode` (+ `componentId`, `componentProperties`) |
| `RECTANGLE`, `ROUNDED_RECTANGLE` | `ShapeNode` `RECTANGLE` (+ `cornerRadius`, `rectangleCornerRadii`) |
| `ELLIPSE`, `LINE`, `STAR`, `REGULAR_POLYGON`/`POLYGON` | `ShapeNode` `ELLIPSE`/`LINE`/`STAR`/`POLYGON` |
| `VECTOR` | `ShapeNode` `VECTOR` (+ `pathData`, `windingRule`) |
| `TEXT` | `TextNode` (+ `characters`, `style`, `styleRuns`) |
| `SYMBOL` (native) | `ComponentNode` |
| `SOLID` / `GRADIENT_*` / `IMAGE` paints | `SolidPaint` / `GradientPaint` / `ImagePaint` |
| `DROP_SHADOW` / `INNER_SHADOW` / `*_BLUR` | `ShadowEffect` / `BlurEffect` |
| auto-layout fields | `AutoLayout` |
| `constraints` | `Constraints` (`TOP_BOTTOM`→`STRETCH`, `LEFT_RIGHT`→`STRETCH`, …) |
| prototype `interactions` | `PrototypeInteraction[]` |

Paints, effects, text styles, auto-layout, constraints, vector geometry, and
text style runs are mapped. Embedded native images become `ImagePaint.dataUrl`
(inline `data:` URL), so imported assets render without a network fetch; REST
image paints keep their `imageRef`. Per-character overrides and line metadata
are preserved verbatim in `TextNode.style.styleRuns`.

### Gradient transforms

The model's `GradientPaint.gradientTransform` is consumed directly as an SVG
`gradientTransform`, so the importer always produces the **gradient space →
object space** matrix:

- REST: computed from the three `gradientHandlePositions` (start, end, width).
- Native: `paint.transform` is inverted, because Figma stores **node space →
  gradient space** (verified against openfig-core's `resolveGradientGeometry`).

Orientation is therefore preserved for rotated gradients, and degenerate
geometry is reported instead of silently falling back to identity.

---

## Reported as unsupported (never silent)

- **Node types with no Pigma equivalent** (FigJam `STICKY`, `SHAPE_WITH_TEXT`,
  `CONNECTOR`, `TABLE`, `TABLE_CELL`, `TEXT_PATH`, `WIDGET`, `EMBED`, native
  `SLIDE`, `CODE_BLOCK`, …): imported as `FRAME` (with children) or `RECTANGLE`
  (leaf), original in `raw`; reported as `nodeType:<TYPE>`.
- **Paint types** `EMOJI`, `VIDEO`, `PATTERN`, `NOISE`, … → `UnsupportedPaint`,
  reported as `paint:<TYPE>`.
- **Effect types** `TEXTURE`, `NOISE`, native `REPEAT`/`GRAIN`/`GLASS`/… →
  `UnsupportedEffect`, reported as `effect:<TYPE>`.
- **Gradients with no usable geometry** — a gradient paint is reported as
  `paint:gradient:noTransform` only when it has neither a `gradientTransform`
  nor three non-degenerate `gradientHandlePositions`.
- **Ellipse arcs** (`arcData`) — no Pigma field; retained in `raw`, reported as
  `ellipse:arcData`.
- **Instance overrides** — REST lists overridden field names only (values are
  already on the instance subtree); native `symbolOverrides` are retained in
  `raw`. Reported as `instance:overrides`.
- **Unsupported prototype triggers/actions** (`ON_MEDIA_END`, `ON_KEY_DOWN`,
  `SET_VARIABLE`, …) are dropped from the model but retained in `raw`, reported
  as `trigger:<TYPE>` / `action:<TYPE>`.
- **Grid auto-layout** (`layoutMode: GRID`) → reported as `autoLayout:GRID`.

Native nodes with `phase: 'REMOVED'` (Figma deletions) are excluded from the
tree and counted in `report.warnings`; they remain in the source message.

---

## Native `.fig` format

A `.fig`/`.deck`/`.jam` file is a ZIP archive containing `canvas.fig`,
`meta.json`, `thumbnail.png`, and `images/*`. `canvas.fig` is:

```
[8B prelude "fig-kiwi"][u32 version]
[u32 len][chunk 0: deflate-raw Kiwi binary schema]
[u32 len][chunk 1: zstd (or deflate-raw) Kiwi message]  ← nodeChanges, blobs
[u32 len][chunk 2+ …]                                     ← opaque, retained
```

The Kiwi codec (`src/figma/native/kiwi.ts`) is a dependency-free interpreter
(`decodeBinarySchema` + `compileSchema` + `decodeMessage`). It reads the schema
embedded in every file, so no schema copy is bundled and no `new Function`
codegen is used (CSP-safe). `readVarFloat`, varints, enums, structs, messages,
and byte arrays follow the Kiwi wire format.

Native vector geometry is decoded from blobs: `fillGeometry[].commandsBlob`
(move/line/cubic/close) and `vectorData.vectorNetworkBlob`
(vertices/segments/regions). If only a vector network exists, it is scaled from
normalized space into node space using `vectorData.normalizedSize`.

### Decompression

Compression is injected so the parser stays isomorphic:

- **Node**: `nodeDecompressors` from `src/figma/native/node` (wraps `node:zlib`;
  `zstdDecompressSync` requires Node ≥ 22.15/23.8 — this repo runs Node 24).
- **Browser**: `loadDecompressors()` lazily imports `fflate` (deflate) and
  `fzstd` (zstd). Both are optional peers; REST import needs neither.

> **Dependency recommendation for the editor agent (do not apply mid-flight):**
> to enable native `.fig` import in the browser bundle, add `fflate` and `fzstd`
> to `dependencies`. Alternative: `openfig-core` (MIT) bundles the same three
> packages plus conversion helpers, if a single maintained dependency is
> preferred. This module intentionally ships no bundled copy so the importer
> works today with zero new dependencies.

---

## Testing

```bash
npx vitest run tests/figma
```

42 tests cover: Kiwi schema/message decoding (hand-built encoder), real `.fig`
archives (`circle.fig`, `word-outline-stroke.fig`), hierarchy validation
(cycles/duplicates/dangling parents), REST parsing (both endpoints, malformed
input), gradient-transform orientation (axis-aligned and rotated), embedded
image inlining, and conversion for every mapped feature plus the unsupported
report.

Fixtures under `tests/figma/fixtures/`:
`circle.fig`, `openfigs.fig`, `word-outline-stroke.fig` are from
[openfig-core](https://github.com/OpenFig-org/openfig-core) (MIT) and are used
verbatim as real-world `.fig` inputs; `with-image.fig` is derived from
`circle.fig` by this project and re-encoded so its ELLIPSE carries an IMAGE
fill referencing the bytes embedded in the archive (end-to-end image import).
`rest-file.json` / `rest-nodes.json` are authored here. Full upstream MIT
copyright notices are in [`tests/figma/fixtures/NOTICE.md`](../tests/figma/fixtures/NOTICE.md).

### Attribution / licensing

- Kiwi codec reimplements the read side of
  [`kiwi-schema`](https://github.com/evanw/kiwi) (MIT, © 2016-2023 Evan Wallace).
- Native format notes and vector/blob layouts follow openfig-core's `docs/`
  (MIT).
- Both are compatible with Pigma's MIT license; no code is vendored. The
  upstream fixtures are redistributed under their MIT terms with full copyright
  notices in [`tests/figma/fixtures/NOTICE.md`](../tests/figma/fixtures/NOTICE.md).

### Known scaffold gap

`tsc -b` currently fails on the repo because `tsconfig.node.json` declares
`"types": ["node"]` but `@types/node` is not in `devDependencies`. The importer
typechecks clean under `tsc -p tsconfig.app.json`. The editor agent should add
`@types/node` (and, for browser `.fig`, `fflate` + `fzstd`).

---

## Native `.fig` export

`src/figma/native/export.ts` re-encodes a **decoded native document** back into
`canvas.fig` (and a complete `.fig` archive), reusing the schema embedded in a
seed file — no bundled schema copy:

```ts
import { exportFigBinary, zipArchive } from './src/figma/native/export';
import { nodeExportCompressors } from './src/figma/native/export.node';

const canvas = await exportFigBinary(doc.message, {
  schemaFrom: originalFigBytes,          // .fig archive or bare canvas.fig
  decompress: nodeDecompressors,
  compress: nodeExportCompressors,       // zstd (Figma rejects deflateRaw on write)
});
const archive = zipArchive([['canvas.fig', canvas], ['meta.json', metaJson]]);
```

CLI: `npx vite-node src/mcp/bin.ts --file in.fig --export out.fig`.

Verified: parse → export → re-parse yields identical node ids/types/names/sizes/
fills; edits made to the decoded message survive; the message chunk is zstd.

### Editor model → `.fig`

`src/figma/native/modelExport.ts` implements the model → `nodeChanges` mapping:

```ts
import { exportPigmaFile } from './src/figma/native/modelExport';
const archive = await exportPigmaFile(pigmaFile, {
  schemaFrom: seedFigBytes,          // any real .fig supplies the wire schema
  decompress: nodeDecompressors,
  compress: nodeExportCompressors,
});
```

CLI: `npx vite-node src/mcp/bin.ts --file doc.json --export out.fig --schema-from seed.fig`.

Mapping: `guid` from the node id, `parentIndex.position` from a fixed-width
base-94 sibling sequence, `type` via the reverse of the import map, `transform`
/ `size` from the relative transform and width/height, `fillPaints`/
`strokePaints` (gradients are inverted back to the native node→gradient
transform), text (`textData`, font, line height, letter spacing), auto-layout
(`stackMode`, `stackPadding` + per-side overrides, `StackSize` sizing), corner
radii, clipping, components, and instances (`symbolData`). `pathData` is encoded
into a `commandsBlob` (absolute/relative M/L/H/V/C/Z); unsupported path commands
are reported as warnings rather than dropped silently.

Verified by `tests/figma/modelExport.test.ts`: the REST fixture exports and
re-imports with identical ids/names/types/sizes, preserved text, paints,
auto-layout, clipping, and vector geometry, and gradient orientation survives
the native inverse transform.

**Documented limitations.** The native wire format has no `COMPONENT_SET` type
(sets export as `SYMBOL` and re-import as `COMPONENT`) and no numeric font
weight (carried by the font style name); colors round-trip through float32.

## Limitations (honest)

- No `.fig` **write** path — import only. `raw` and the decoded message/schema
  are retained so an encoder can be added without re-parsing.
- **REST images have no bytes**: `ImagePaint.imageRef` holds the REST
  `imageRef`; fetch bytes via `GET /v1/files/:key/images`. Native `.fig`
  archives embed the bytes, so their image fills carry an inline
  `ImagePaint.dataUrl`.
- **Gradients**: both sources produce a renderer-facing `gradientTransform`
  (gradient space → object space, as SVG expects). REST handles are converted;
  native `paint.transform` is inverted (Figma stores node space → gradient
  space). Degenerate geometry is reported rather than silently defaulted.
- Grid auto-layout, FigJam node types, and prototype actions beyond
  `NODE`/`BACK`/`CLOSE`/`URL` are reported, not modelled.
