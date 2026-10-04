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
| Prototype interactions (triggers, actions, overlay) | ✅ | ✅ | **FIXED, and proven through the REAL BINARY path.** A document carrying a `NAVIGATE` (`SMART_ANIMATE`, 250ms, `IN_CUBIC`) **and** a `SWAP_STATE` interaction round-trips with **both** interactions, the **trigger** intact, the **transition** intact, and the destination resolving to the **reimported** node. **The assertion that matters: the recovered swap still plays back as a `SWAP` AFTER the round trip** (applying it leaves the presented frame and the stack untouched) - which proves the feature survives a **FILE**, not just memory. | test-backed: `tests/figma/roundTripLoss.test.ts`; unit `src/model/prototype.test.ts` | test-backed: `b14-presentation`, `b21-prototype-inspect`; loss measured by `tests/figma/roundTripLoss.test.ts` |
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

**15 fields were CONFIRMED LOST** by that probe. **Three are fixed** and **12 are
being addressed** - none of the 12 is claimed fixed here, because a round trip has
not proved it yet.

**Fixed (3):** `dashPattern` and `windingRule` - both **wire-name** bugs, not
schema limits (see below) - and **`layoutGrids`**, which is now written
(`modelExport.ts`, `toNativeLayoutGrid`) and **proven both ways** through the real
binary round trip.

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

### What the round-84 probe measured

The three fields that were previously **unknown** are now two measured results and
one that is still genuinely unknown:

- **Image fills - NOT a defect: an API CONTRACT.** The ref **is** written
  (`fillPaints` with an `imageRef`) and the paint is resolved through the export
  **images map**, so it depends on the **caller supplying the bytes**. That is a
  contract rather than a loss, because a `.fig` carries images as **separate
  archive entries** - the paint cannot carry them inline. Related: Pigma's
  `naturalWidth` / `naturalHeight` / `dataUrl` / `scalingFactor` are **conveniences
  with no wire counterpart**.
- **Grid fields - LOST.** Nothing writes them. That was expected, and it is now
  **measured rather than assumed**.
- **`componentProperties` - STILL UNKNOWN.** The probe was **inconclusive**: the
  test component carried no properties, so an `undefined` result proves nothing.
  **An inconclusive probe is not a cleared candidate**, and this one has not been
  cleared.

### Grid: PARTLY landed, and the gap is pinned (do not read this as "grid survives")

The blocker was that `mapNativeAutoLayout` **explicitly refused `GRID`**, so a grid
auto layout was dropped on import *no matter what the export wrote* - and the
exporter wrote `stackMode` for `HORIZONTAL`/`VERTICAL` only, so a `GRID` never even
reached that check. **Both are fixed** and the grid mapper is partly landed.

**MEASURED - what survives the round trip:**

- the **mode** survives;
- **both gaps** survive.

**MEASURED - what does NOT:**

- the **track sizes and their guids** do not. The export writes `gridColumns` as a
  **`GUIDPositionMap`** and it does not come back through the parse.

**NOT MEASURED - do not read these as working:**

- the **child spans and anchors** are written and read, but they were **not
  measured**. They are **unmeasured**, which is not the same as verified.

**So: a grid does NOT survive a round trip.** State the parts, not the whole.

### The grid anchors cannot be converted - and it is not a naming bug

`gridColumnAnchor` / `gridRowAnchor` are **GUIDS** in the native schema: Figma
anchors a grid child to a track **NODE**. Our model stores an **index**
(`gridColumnAnchorIndex`) and its tracks are `GridTrackSize` **numbers**, not
nodes - so there is **no guid to convert from**. Unlike `dashPattern` and
`windingRule`, no rename can fix this. The fields stay unwritten and the field
check reports them. The fix would be a **MODEL change** - carry the track nodes,
or carry the guids alongside the indices - and **it is not done**.

What such a change would **touch**: the `GridTrackSize` shape, the layout engine
(`layoutGridContainer`), the panel's track editor, and validation. **None of it is
done**, and this is a model gap rather than a mapping one - no wire-name fix
reaches it.

### Styles: the native path is ABSENT, not guid-less - a corrected costing

The first costing was that this was **"one optional field"**: a `StyleId` is
`{ guid: GUID, assetRef: AssetRef }`, so it looked like one guid away from working.
**One grep showed that was wrong.** The **only** `styleID` in the entire native
path is a hardcoded **`styleID: 0`** (`src/figma/native/modelExport.ts`); the one
other occurrence is a type declaration. So **nothing about styles crosses the wire
at all** - a style binding does not fail for want of a guid, there is **no style
mapper**.

The editor added the field and then **REVERTED it**, because alone it is **dead
code**. **Nothing was half-landed** - which is the lesson: *"one optional field"*
was a guess, and a single grep replaced it with the truth before any code shipped.

### The variant swap was RESTORED - a feature recovered, not a bug fixed

**The round-74 withdrawal was WRONG.** It was reasoned against the **REST**
vocabulary, where the variant swap is `CHANGE_TO` and the target looked
inexpressible; the **NATIVE** wire disagrees on both counts - it names the swap
**`SWAP_STATE`** and carries **`transitionNodeID`** as the destination GUID. It is
now **IMPLEMENTED**.

What works that did not before:

- a **navigate -> swap -> open** trigger runs **ALL THREE actions in order**; before,
  the middle one was silently dropped on import;
- playback **swaps the instance variant IN PLACE with the stack untouched**, so
  **Back still returns correctly**.

**The naming decision, which is the lesson applied rather than described:** the
model uses Figma's **NATIVE** name **`SWAP_STATE`** rather than the REST name
`CHANGE_TO`, and handles the REST spelling as an importer **ALIAS**
(`NAVIGATION_ALIASES = { CHANGE_TO: 'SWAP_STATE' }`). So the model keeps **one
vocabulary** while a REST-sourced document still lands - which is exactly the
remedy for the sub-class named in the ROADMAP's pattern section.

**`SCROLL_TO` STAYS WITHDRAWN, on evidence rather than as deferred.** It is one
field short in **form** - `extraScrollOffset` is a `Vector` and the model has no
offset - but the missing part is the **semantics**: which coordinate space it
targets, whether it clamps to the scroll range, and how playback applies it.

### The swap is AUTHORABLE and PROVEN

`PrototypeActionKind` gains **`SWAP_STATE`**, `actionOfKind` builds it,
`prototypeDestinations` returns a component set's variants **grouped by set name**
with a "Set / Variant" label, and the panel offers **"Swap variant"** as a kind.
Driving the panel end to end now works: the **destination select appears** and
lists `Button / State=Default`-style entries, the **create button stays DISABLED
until a destination is chosen**, and applying the link creates a `SWAP_STATE`
action carrying the chosen `destinationId`. **Playback swaps the instance variant
IN PLACE** - the presented frame and the navigation stack are untouched, the same
assertion that proved the import path.

This section used to read "the MODEL is authorable, the PANEL is not yet". That was
correct when written, and it was **driving the panel that corrected the editor's
premise**: its smoke had reported that the kind control is not a `<select>` - it
**is** one - and the real failures were two panel **conditions**: the Target row
omitted `SWAP_STATE` (so the destination vanished), and the create button's
disabled test evaluated to `false` for a swap (so an action could be created
**pointing at nothing**). Both are fixed. Pinned by
`b59-prototype-swap-authoring`, whose negative control (the `Back` kind offers no
destination) keeps it from passing vacuously.

**A deliberate decision worth recording: Smart animate stays NAVIGATE-only.** A
swap *does* carry a transition in the model and the exporter writes it, but
**playback does not apply one** (`swapInstanceState` changes the component in
place, with no animation). Offering the row for a swap would therefore **promise an
animation that does not play** - so it is withheld, on purpose.

### The two name mismatches are MAPPERS, not renames - and the writes stay

The same probe established the two real wire names behind the round-99 findings:

| We write | The schema's name |
| --- | --- |
| `componentPropertyDefinitions` | **`componentPropDefs`** |
| `variableBindings` | **`variableData`** |

**Neither is a rename, because the SHAPES differ** - so each needs a **mapper**, not
a string swap. Treating either as a rename would be the same mistake as the
assumptions above.

**Standing decision: the mismatched writes are KEPT.** They stay so that the
pre-encode warning keeps **reporting the loss**, rather than the export silently
carrying less. **Removing a write is a product decision, not a passing one** - a
silent export that omits a field is worse than a loud one that names it.

### The schema diff - a STANDING TOOL, not a one-off

The most reusable thing this project has produced is a **method**. The editor
**diffed the field names `modelExport.ts` WRITES against the field names the
decoded schema DEFINES** - and found the **seventh and eighth** instances of the
vocabulary class **by looking**, rather than by losing another round to them:

- **`variableBindings`** and **`componentPropertyDefinitions`** are both written
  under names **the schema does not define**, so `kiwi` drops them **silently**.
  The pre-encode warning fires for them - which is the **only** reason they are not
  invisible.

**Record it as a standing tool: for any area we touch, enumerate the schema's field
names and diff them against the names our mapper writes.** The next instance
should be found by looking, not by losing a document.

**A correction that undoes an earlier correction - and it is the same error class.**
Round 98 recorded here that the wire's node-level binding is `styleID` and **not**
`styleIdForFill`. **That was wrong.** The field list had been read as a **slice of
16 names**, and the truncation cut off **exactly the five being looked for**. Checked
against the decoded schema (**3189 field names**), **all five DO exist**:
`styleIdForFill`, `styleIdForStrokeFill`, `styleIdForText`, `styleIdForEffect`,
`styleIdForGrid` - plus a **separate legacy `styleID`** and the `inherit*StyleID`
family.

**So round 95 was right, and the round-98 "correction" was the error** - an
assumption drawn from an **INCOMPLETE READ**, which is the same class as the
vocabulary instances this section exists to catalogue. **Nothing was ever built on
it.** The style mapper shape is **CONFIRMED and being built**.

**The lesson applies to the standing tool itself:** a diff is only as good as the
**completeness** of what it diffs - a truncated field list produced a confident
wrong answer. Trust the next sweep only after checking the sweep did not truncate.

**The same sweep exposed a second gap in that area:** the wire `StyleType` has
**SEVEN** members - `NONE`, `FILL`, `STROKE`, `TEXT`, `EFFECT`, `EXPORT`, `GRID` -
against our **three** (`FILL`, `TEXT`, `EFFECT`).

### Style bindings: the EXPORT half landed, the IMPORT half does not

**Export - landed.** The exporter writes the **five per-property binding fields** -
`styleIdForFill`, `styleIdForStrokeFill`, `styleIdForText`, `styleIdForEffect`,
`styleIdForGrid` - as **`StyleId { guid }`**, resolved through the file's **style
table**. A binding that has **no wire guid writes nothing**, which is deliberate: the
pre-encode check then **reports** it rather than the export quietly carrying less.

**Import - does NOT survive, with two established causes:**

- **(a)** the wire value is a style **GUID** while the model binds by **style ID**,
  so the guid has to be matched against the file's style **table** - and that table
  is built **after** the nodes are converted;
- **(b)** **the style table itself does not cross the wire.** Measured: on reimport,
  `styles["style:1"].guid` is **undefined**.

Both are being closed now. **The binding does not survive a round trip**, and
nothing here claims otherwise.

**And a MODEL gap sits underneath.** The wire has **five** binding fields, and
`NodeStyleBinding` has **three**:

| Wire | Model |
| --- | --- |
| `styleIdForFill` | `fill` |
| `styleIdForText` | `text` |
| `styleIdForEffect` | `effect` |
| `styleIdForStrokeFill` | **no source field** |
| `styleIdForGrid` | **no source field** |

`styleIdForStrokeFill` and `styleIdForGrid` are **reported, not invented** - writing
a guessed value would be worse than writing none. Carrying them would need a **model
change**.

### Open model gaps - the remaining list

Everything the earlier rounds landed still survives; these are what is still open:

**None of these is fixed** until a round trip proves it.

| Gap | Nature |
| --- | --- |
| **Style bindings** | **EXPORT landed; IMPORT does not survive** (two causes: guid-vs-id matched against a table built too late, and the style table itself not crossing the wire). **Plus a model gap**: 5 wire fields vs 3 model fields. The wire `StyleType` also has **7** members against our **3** |
| **Variable bindings** | a **NAME MISMATCH** - written as `variableBindings`, which the schema does not define, so `kiwi` drops it silently (being fixed) |
| **Component property definitions** | a **NAME MISMATCH** - written as `componentPropertyDefinitions`, likewise (being fixed) |
| **Grid track sizes** | still lost (the **track guids** half is closed) |
| **`assetRef`** | not carried |
| **`FIXED_MIN` / `FIXED_MAX`** | a **MODEL gap** - deliberately unmapped rather than coerced into `MIN`/`MAX` |
| **`SCROLL_TO`** | withdrawn; the **semantics** are unknown (coordinate space, clamping, playback) |

### The three map fixes

- **(a) `DRAG` and (b) `MOUSE_IN` / `MOUSE_OUT` - FIXED**, by the
  **native-vocabulary remedy**: the maps now list the native spellings
  (`ON_DRAG` -> `DRAG`, `MOUSE_ENTER`/`MOUSE_LEAVE` -> `MOUSE_IN`/`MOUSE_OUT`)
  instead of the REST ones. Each was a document being **silently dropped** on
  import.
- **(c) `FIXED_MIN` / `FIXED_MAX` - a MODEL gap, deliberately unmapped.** They are
  **not** coerced into `MIN`/`MAX`: coercing would be **silently wrong**, while
  leaving them unmapped makes the constraint **ABSENT rather than invented**. That
  is the correct trade - an absent constraint is honest, a wrong one is not.

**The vocabulary count STAYS AT FIVE.** (a) and (b) are fixes to the *same two
maps* already counted as instances 4 and 5 - they are the remedy working, not new
instances. **And the audit found no further gaps** in transitions, easings,
navigation types or overlay positions.

### The two shapes the editor established - the plan for the writes in progress

- **`LayoutGrid`** is a **near match** to our model: `count` <-> `numSections`, and
  `type` / `axis` derive from our `pattern`.
- **`PrototypeInteraction` is a REAL MAPPER both ways**: `PrototypeEvent.interactionType`
  carries the trigger, `PrototypeAction.transitionNodeID` the destination **GUID**,
  alongside `navigationType` / `connectionType` / `connectionURL` and the transition
  fields.

**The importer reads NONE of that today, so prototype links vanish through
`.fig`.** That is why the "Prototype interactions" row above is a **LOSS, not an
OK** - and it stays a loss until the write lands.

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
