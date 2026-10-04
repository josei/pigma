# Figma compatibility matrix

What actually survives a round trip through Figma's native `.fig` format, in each
direction, and what does not. This document is deliberately pessimistic: where a
capability is lost, it says so and names the code that loses it.

Source of truth, by direction:

| Direction | Code |
| --- | --- |
| Figma `.fig` → Pigma | `src/figma/native/parse.ts`, `kiwi.ts`, `zip.ts`, `vector.ts`; then `src/figma/convert/convert.ts` + `mappers.ts` |
| Pigma → Figma `.fig` | `src/figma/native/modelExport.ts` |
| Figma REST JSON → Pigma | `src/figma/rest/parse.ts` |
| Loss reporting | `src/figma/convert/report.ts` |

**The table pins what is KNOWN; it is not a promise that nothing is lost
silently.** Every import produces an `ImportReport` with a
structured `unsupported` list (`{ nodeId?, path, feature, detail? }`), using
stable feature keys such as `nodeType:STICKY`, `paint:VIDEO`,
`autoLayout:GRID`. The UI surfaces it. `rawPreserved` is always `true`: each node
keeps its original source object, so unknown fields survive inside Pigma even
when they cannot be mapped onto the model.

**A field with no row here and no mapping can still be dropped without a
warning, and one was.** `locked` was never written on export and had no row in
this table, so a locked layer came back unlocked silently - the importer reads
`locked === true`, and a missing field is false. The exporter now writes it
(`src/figma/native/modelExport.ts`); this table still has no row for it, which is
the gap this paragraph exists to admit. Treat an unlisted field as **unknown**,
not as safe.

---

## 1. Round-trip matrix (native `.fig`)

Legend: **✅** survives · **≈** survives with a stated approximation ·
**❌** lost · **—** not applicable in that direction.

| Feature | Figma → Pigma | Pigma → Figma | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Document / pages (`DOCUMENT`, `CANVAS`) | ✅ | ✅ | Page-per-`CANVAS` maps 1:1 | test-backed: `b11-figma-import` |
| Frames, groups, sections | ✅ | ✅ | | test-backed: `b11-figma-import` |
| Rectangle, ellipse, line, text | ✅ | ✅ | | test-backed: `b11` (rect/ellipse/text), `b36-shapes` (line) |
| Polygon, star | ✅ | ≈ | `POLYGON` exports as `REGULAR_POLYGON`; point counts preserved | test-backed: `b40-polygon-star`, `b41-polygon-star-editing` |
| Vector networks | ≈ | ≈ | `pathData` survives when its commands are understood; otherwise **geometry is omitted** with a warning (`node.…: pathData uses unsupported commands; geometry omitted`) | **partly test-backed**: `b43-figma-float32-pathdata` (command survival + rejection); the parser itself is `src/figma/native/vector.ts` (code) |
| Boolean operations | ✅ | ✅ | `BOOLEAN_OPERATION` maps both ways; the *result* is a flattened path (see known losses) | documented-from-code: `src/figma/native/modelExport.ts` + `src/model/boolean.ts` |
| Slice | ✅ | ✅ | | test-backed: `b11-figma-import` |
| Component (`COMPONENT`) | ✅ | ✅ | Exports as `SYMBOL` | test-backed: `b12-components` |
| **Component set (`COMPONENT_SET`)** | ✅ | **❌** | **The native wire format has no `COMPONENT_SET` type.** Sets export as `SYMBOL` and re-import as `COMPONENT` — the set/variant grouping is flattened. Stated in `modelExport.ts` as a documented limitation. | test-backed: `b38-figma-lossiness` `B38a` asserts the loss directly |
| Instance (`INSTANCE`) | ✅ | ✅ | `componentId`, properties and overrides map | test-backed: `b12-components` |
| `componentSnapshot` (materialised subtree) | — | — | **Pigma-only.** A convenience copy; not a wire concept | documented-from-code (Pigma-only, no wire counterpart) |
| Node `raw` passthrough | — | — | **Pigma-only.** Preserves *Figma* fields Pigma does not model; not itself written to the wire | documented-from-code (Pigma-only, no wire counterpart) |
| Solid fills | ✅ | ≈ | **float32 precision** (see below) | **partly test-backed**: `b43` `B43b` (message layer, alpha forced to 1); the float32 codec itself is documented-from-code |
| Gradient fills (linear/radial/angular/diamond) | ✅ | ≈ | float32 precision on stops and transforms | documented-from-code: `src/figma/native/modelExport.ts` |
| Image fills | ✅ | ≈ | Image bytes are carried; float32 precision on the transform | documented-from-code: image bytes keyed by `imageRef`, `modelExport.ts` |
| Video / pattern paints | ❌ | ❌ | No model equivalent — reported as `paint:VIDEO` / `paint:PATTERN` | documented-from-code: the `paint:VIDEO` / `paint:PATTERN` report keys |
| Blend modes | ✅ | ✅ | Full enum mapped in `modelExport.ts` | documented-from-code: the `BLEND` table in `modelExport.ts` |
| Drop / inner shadow | ✅ | ≈ | float32 precision on colour, radius, offset | documented-from-code: the effect branch of `modelExport.ts` |
| Layer / background blur | ✅ | ✅ | | documented-from-code: the effect branch of `modelExport.ts` |
| Stroke weight, align, cap, join, dashes | ✅ | ✅ | **Dashes were lost and are FIXED.** The cause was a **WIRE-NAME bug, not a schema limit**: the exporter wrote `strokeDashes` - the **REST** API spelling - into the **NATIVE** message, where the schema says `dashPattern`, so the encoder dropped it in **every** schema silently. That is why the probe found it lost in all four and why it *looked* schema-dependent. Corrected on both sides; measured after, it survives the binary round trip in **all four fixture schemas** where it survived in **none** before, and the pre-encode warning no longer fires for it because it is encodable now. | test-backed: `tests/figma/roundTripLoss.test.ts` |
| Corner radius / per-corner radii | ✅ | ✅ | | test-backed: `b41-polygon-star-editing` `B41c` (rendering) + `src/render/svgExport.test.ts` |
| **Text: family + named style** | ✅ | ✅ | Modelled as `fontName { family, style }` | test-backed: `b42-figma-italic-roundtrip` |
| **Text: numeric weight** |  ≈ | **❌** | See below — the wire carries a *named style*, not a number | test-backed: `b42-figma-italic-roundtrip` (`B42b` native, `B42d` REST) |
| Text: size, line height, letter spacing | ✅ | ✅ | | test-backed: `src/figma` unit suite |
| Text: alignment, case, decoration | ✅ | ✅ | | test-backed: `src/figma` unit suite |
| Text: auto-resize | ✅ | ✅ | | test-backed: `src/figma` unit suite |
| Constraints (min/center/max/stretch/scale) | ✅ | ✅ | | documented-from-code: `mappers.ts` constraints branch |
| Auto layout (direction, spacing, padding, alignment, sizing) | ✅ | ✅ | | test-backed: `src/figma` unit suite |
| Auto layout: wrap | ✅ | ✅ | | test-backed: `src/figma` unit suite |
| Auto layout: **grid** | ❌ | ❌ | No model equivalent — reported as `autoLayout:GRID` | documented-from-code: no model equivalent, reported as `autoLayout:GRID` |
| Prototype interactions (triggers, actions, overlay) | ✅ | **❌** | `interactions` goes **1 -> 0** across the binary round trip (probe). The editor and the REST import are unaffected - this is the `.fig` EGRESS losing them. | test-backed: `b14-presentation`, `b21-prototype-inspect`; loss measured by `tests/figma/roundTripLoss.test.ts` |
| Prototype transitions incl. smart animate | ✅ | ✅ | Duration and type carried | test-backed: `b33-animate-scroll` |
| Unknown / future node types | ❌ | ❌ | Reported as `nodeType:<TYPE>`; the source object is still preserved in `raw` | documented-from-code: reported as `nodeType:<TYPE>` |

## 2. What the round-trip probe measured

The compat table above pins what is **known**. A probe drove the **real** binary
round trip (`exportPigmaFile` -> `parseFigArchive` -> `figDocumentToPigmaFile`)
against the fixture schemas and measured what actually survives, which is how the
two rows above were corrected.

**Root cause, and it is not ours:** the encoder is
**`kiwi-schema`'s `compileSchema(...).encodeMessage(...)`** (`src/figma/native/export.ts`)
- a **third-party** encoder driven by the `.fig` **schema**. It writes only the
fields the schema defines and **drops the rest with no warning**. So a field
Pigma models, and even writes into the message, can still be discarded on its way
to bytes.

**15 fields were CONFIRMED LOST** by that probe. **Two are fixed** and **13 are
being addressed** - none of the 13 is claimed fixed here, because a round trip has
not proved it yet.

**Fixed (2):** `dashPattern` and `windingRule` - both **wire-name** bugs, not
schema limits (see below).

**Being addressed (13), with the AUTHORITATIVE wire names** the editor read out of
the decoded schema. These names are the **plan**, not a result:

| Pigma field | Wire name in the schema |
| --- | --- |
| `isMask` | `mask` |
| `constraints` | `horizontalConstraint` / `verticalConstraint` |
| `layoutAlign` | `stackCounterAlign` |
| `layoutGrow` | `stackChildPrimaryGrow` |
| `minWidth` / `minHeight` / `maxWidth` / `maxHeight` | `minSize` / `maxSize` |
| `styles` | the `styleIdFor*` set |
| `interactions` | `prototypeInteractions` |
| grid columns/rows/gaps | `gridColumns` / `gridRows` / the gaps |
| grid anchors | `gridColumnAnchor` / `gridRowAnchor` - **`Anchor`, not `AnchorIndex`** |
| `textAutoResize` | `textAutoResize` |
| `layoutGrids` | `layoutGrids` |

**No wire name exists for two of the fifteen** - so no rename can fix them:
`overflowDirection` is **not in the schema at all**, and no wire name has been
found for `componentPropertyReferences`.

**9 probed fields SURVIVE** - recorded because a probe that clears nine
candidates is as valuable as one that finds fifteen: `visible`, `clipsContent`,
`cornerRadius`, `rectangleCornerRadii`, `blendMode`, `effects`, `strokeWeight`,
`strokeAlign`, `raw`.

### Missing is one thing; WRONG is another

`windingRule` does not vanish: it came back **`EVENODD` -> `NONZERO`**. A lost
field leaves a default you can notice; a **silently wrong** one changes how a path
fills while looking perfectly healthy - worse than a loss, because nothing looks
broken. **It is FIXED, and the cause was again a naming mismatch:** the schema
spells the enum **`ODD`**, and the exporter had hardcoded `NONZERO` because
writing `EVENODD` made the encoder throw.

Both of these are the same lesson, and it is why they are called out together: a
**name mismatch can look exactly like a missing capability.** `dashPattern` and
`windingRule` were filed as losses caused by the third-party encoder; both were
really Pigma writing a name the schema does not use.

### Still unknown

**Image, grid and `componentProperties` fields remain UNPROBED.** They are
recorded here as **unknown**, not as safe - which is the whole point of the
correction above.

### In progress

The editor is building a **pre-encode warning**, so these losses stop being
silent and a caller can **learn** about a dropped field rather than having to
read this table. **That is in progress, not landed** - the table remains the only
source of truth until it ships.

## 3. The known losses, stated plainly

### 3.1 `COMPONENT_SET` cannot be represented on the wire

`modelExport.ts`:

```ts
COMPONENT: 'SYMBOL',
// The native wire format has no COMPONENT_SET type; sets export as SYMBOL
// (and re-import as COMPONENT). Documented limitation.
COMPONENT_SET: 'SYMBOL',
```

A **Pigma → Figma** round trip of a variant set therefore returns a plain
component, not a set. Inside Pigma the set is intact (`COMPONENT_SET` is a
first-class model type, and variant sets are browser-verified via combination and
instance overrides); it is the *export* that cannot express it. **Figma → Pigma is
unaffected** — a set imported from Figma stays a set.

### 3.2 No numeric font weight on the wire

The wire carries a **named style**, not a number. Export maps a weight through a
fixed table:

```ts
const WEIGHT_STYLES = { 100: 'Thin', 200: 'Extra Light', 300: 'Light',
  400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold',
  800: 'Extra Bold', 900: 'Black' };
```

Consequences:

- A weight **outside** the table (e.g. a variable-font axis at 450, or 350)
  has no name and cannot be written.
- Re-import recovers a *named* weight, so the numeric value you get back is the
  table's value for that name, not necessarily the one you exported.
- Pigma's model does keep a numeric `fontWeight`, so this is a wire limitation,
  not a model one.

### 3.3 Colours are float32

The codec transports floats as 32-bit (`kiwi.ts`: `Float32Array` over a shared
`ArrayBuffer`). Colour components, gradient stops, effect radii and offsets are
therefore rounded to float32 precision on the wire. In practice:

- Values written as decimal fractions may not read back bit-identical.
- This affects **both** directions and every float field, not only colour.
- It is a precision loss, not a correctness one: 32-bit floats are what Figma's
  own format uses.

### 3.4 Geometry can be dropped for unparseable paths

If `pathData` contains commands the importer/exporter does not understand, the
geometry is omitted and a warning is emitted rather than a wrong shape being
produced. The node survives; its outline does not.

### 3.5 Boolean results are flattened

Boolean operations are carried as a flattened path, not as a live polygon op.
Figma → Pigma works and the *rendered result* is correct; what is not preserved
is the parametric operation with its inputs recoverable as such.

### 3.6 Archive-level limits

`.fig` is a ZIP container read by `zip.ts`. An entry using a compression method
the reader does not implement raises `UNSUPPORTED_ARCHIVE` rather than returning
corrupt data. Native `.fig` import also needs the `fflate` and `fzstd`
decompressors; without them the import fails with a clear
`UNSUPPORTED_COMPRESSION` error instead of hanging.

## 4. What this means in practice

| If you need… | Do this |
| --- | --- |
| Loss-free round trip inside Pigma | Use **Pigma JSON** (`pigma/1` / `pigma/persist/1`), not `.fig`. See [FORMAT.md](FORMAT.md) |
| To read a real Figma file | `.fig` or Figma REST JSON import — both report what they could not represent |
| To hand a file back to Figma | `.fig` export. Expect the losses above, and read the export warnings |
| Variant sets to survive | Keep them in Pigma JSON; `.fig` export flattens sets to components |

## 5. Honesty notes

- The matrix describes **the code as it stands**, not a target. Where a row says
  ❌, there is no partial support to discover — the `unsupported` report is the
  authoritative answer for any given file.
- The `unsupported` list is per-file, so a capability marked ✅ may still be
  reported for a specific node if that node uses a construct the mapper does not
  cover. Trust the report over the table when they disagree.
- **Every row above carries an explicit Evidence entry**: either
  `test-backed:` naming the artefact that exercises it, or
  `documented-from-code:` naming the code the claim was read from. A row marked
  `documented-from-code` has **no** passing test behind it - it is a statement
  about what the code does, verified by reading it.
- The float32 rows are now *partly* test-backed: `b43` drives the real
  commands-blob codec and shows exact float32 rounding, but a **colour** through a
  whole `.fig` archive is still documented-from-code, because serialising one
  needs a real `.fig` schema and compressors (`KiwiReader` has no writer here).
- `b43` also pins a sharper statement of §2.4: an unsupported command discards the
  **entire** path's geometry, not just that segment, and `H`/`V` are normalised to
  `lineTo`, so the command *spelling* is an approximation even when the geometry
  is exact.
