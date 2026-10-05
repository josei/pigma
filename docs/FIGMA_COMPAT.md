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

## 0. The governing principle: prefer Figma's shape

**Prefer Figma's shape. If we diverge, record the reason.**

**This is not a style preference - it is the lesson of this run, and the evidence is
that every divergence we chose became a bug:**

- **nine** vocabulary instances, all of them **name mismatches** against a shape we
  had chosen differently;
- a **shape blindness** the name check cannot see (a map written under the right
  name as an empty list);
- the **guid-vs-id** match in style bindings;
- the **second-pass ordering** problem (a table built after the nodes are converted);
- **two fields invented purely to bridge the two models**.

**A divergence is a place a translation can be wrong - and ours have been wrong at a
measurable rate.** Where the wire's shape can be adopted instead, adopting it removes
a translation step, and with it a place to be wrong.

### The inventory is now MECHANICAL, not archaeology

The divergences above were all found **by hand, one at a time, by accident** - which
is archaeology, not a rule. `scripts/divergence-inventory.ts`
(`npx vite-node scripts/divergence-inventory.ts`) now **enumerates** them instead of
remembering them: it reads the **real schema** out of a `.fig` fixture (nothing is
hardcoded), encodes a document that exercises every node type **and the paths that
have repeatedly gone wrong**, and diffs the field names we **WRITE** against the
field names the schema **DEFINES**.

It reports three kinds, worst first, and **fixes nothing** - the point is the count:

| Kind | Meaning | Measured |
| --- | --- | --- |
| **1. We write a name the schema does not define** | the **silent** kind: `kiwi` drops it and nothing fails | **2** - `variableBindings` and its nested `fills`, i.e. the **known** divergence, now **confirmed mechanically** rather than remembered |
| **2. The wire has a field we never write** | a **capability gap** | the wide `NodeChange` message defines **556** fields; we write **42** |
| **3. Same name, a different message** | usually legitimate (a nested struct's own fields) | 38 |

**Kind 1 is the one to watch**, and it is the kind the rule exists for. The
inventory confirms the §0 rows rather than claiming discovery: `variableBindings`
appears because it is **still** written under a name the schema lacks.

**Classification, not just a list:** grid track sizes are a **WIRE LIMIT** (the wire
cannot carry `px`/`fr`) and `SCROLL_TO` is a **SEMANTICS** gap (the shape is fine) -
neither is our divergence, and neither should be "changed" to satisfy the rule.

### KNOWN LIMITATION of the shape audit (the tool, not the exporter)

**The shape audit OVER-REPORTS on a real file**: **1830 mismatches, all `empty`**, on
real nodes. The cause is that its matching **falls back to NAME**, and a real file's
**3712 nodes share repeated names** - so it pairs the wrong nodes and calls
everything empty.

**The round trip itself is fine.** This is recorded as a **KNOWN LIMITATION OF THE
TOOL**, being fixed this round - **not** as a finding about the exporter.

### The inventory, measured

`scripts/divergence-inventory.ts` reads the real schema and diffs what we **write**
against what the schema **defines**. Measured, with its own limits stated:

- **the wire is FLAT**: `NodeChange` is **one message with 556 fields**, so "per node
  type" collapses to a single vocabulary - which is why the vocabulary bugs kept
  looking scattered when they were all in one place;
- **we write 42** of those 556;
- **kind 1** - a name **the schema does not define**, the **silent** kind - is
  **exactly 2**, and both are the **known `variableBindings`** case;
- **kind 2** - the wire has it, we do not write it - is the **capability gap**, 556
  vs 42;
- **kind 3** is **38**, and **mostly legitimate** nested-struct fields.

**Kind 1's count is COVERAGE-DEPENDENT**: it is **0 on a plain document**. **Two is
the count for the enriched document, not a proof the exporter is clean.**

### The divergences, with a verdict on each

| Our shape | Figma's shape | Verdict |
| --- | --- | --- |
| styles as a **file-level table** | **Figma stores a style as a NODE ENTRY in `nodeChanges`, distinguished by `styleType`, parented to the Internal Only Canvas** | **CHANGE IT** - model styles as entries on that canvas, with the table as the **in-memory index**. **IMPORT half DONE** and **EXPORT half DONE** (this round) |
| `NodeStyleBinding` keyed by **id** | keyed by **GUID** | **CHANGE IT** - queued |
| `StyleType` with **3** members | the wire has **7** | **CHANGE IT** - queued |
| `boundVariables` as `Record<field, id>` | the wire's **per-field `VariableData`** | **CHANGE IT** - queued |
| grid **track sizes** | the wire cannot carry `px`/`fr` | **KEEP** - a **WIRE LIMIT**, not our divergence |
| `SCROLL_TO` withdrawn | the shape is fine | **KEEP withdrawn** - we lack the **SEMANTICS**, not the shape |

**One row is in progress, three are queued, and two are deliberate keeps.** None is
claimed done until a round trip proves it.

### The styles row was WRONG TWICE - and OBSERVATION settled it

This table has now been wrong **twice** about the same row, and the direction of the
corrections is the point.

- **First:** "styles are NODES" - inferred from `sharedStyleMasterData` being a node
  field.
- **Round 107:** "styles are their **own messages**, NOT nodes" - inferred from the
  schema: `MessageType` carries `STYLE`/`STYLE_SET`, and `NodeType` has **no** style
  member.
- **Round 109: both were wrong, and the payload settled it.** Real `.fig` files were
  obtained and **observed**: `open-peeps.fig` (3712 nodes) contains **four** style
  definitions, and **each one IS an entry in the message's `nodeChanges` array**:

```
{"guid":{...},"phase":"CREATED","parentIndex":{"guid":{...}},
 "type":"ROUNDED_RECTANGLE","name":"Skin/05","styleType":"FILL", ...
 "fillPaints":[{"type":"SOLID",...}], "strokePaints":[...], "fillGeometry":[...]}
```

**A style IS a node entry.** `styleType` is the distinguishing field; `type` is a
**normal node kind** - `FILL` -> `ROUNDED_RECTANGLE` (the swatch), `GRID` -> `FRAME`
(confirmed in `hellomate.fig`, whose single style is `{name: Grid, type: FRAME,
styleType: GRID, isPublishable: true, layoutGrids}`). The payload is the **normal
node fields**: `fillPaints` for `FILL`, `layoutGrids` for `GRID`. They live on the
canvas named **"Internal Only Canvas"** (decoded through each entry's
`parentIndex.guid`; the canvases are *Introduction | Symbols | Internal Only
Canvas*). `sharedStyleMasterData` / `styleID` appeared on **none** of them - those
belong to library/published styles, so they are **optional**.

**THE LESSON, and it is sharper than the last one: a field's presence is not
evidence of the shape - AND AN ENUM'S ABSENCE IS NOT EVIDENCE EITHER.** `NodeType`
having no style member did **not** mean styles are not nodes; it meant the type is a
**normal node kind** and `styleType` carries the distinction. **Two schema-based
conclusions in a row were wrong, and observation settled it in one step.**

**So the rule now reads: when the shape is UNOBSERVABLE, GET A FILE.**

**And a SECOND rule, for the opposite move: A RETRACTION IS A CONCLUSION TOO, AND IT
NEEDS THE SAME EVIDENCE STANDARD AS A CLAIM.** Round 100 reported
**`variableConsumptionMap`** as a schema field. Round 104 **RETRACTED** it - saying it
was "not a field anywhere" - because a grep of **DEFINITION names** matched a **field
name in another definition**. **The retraction was WRONG: the field is real and
used.** It is a field on `NodeChange`, and its entry type `VariableDataMapEntry`
carries `variableField`.

So this is the **FOURTH partial-read conclusion of the run, and THE FIRST ONE THAT
DELETED A CORRECT FINDING**. **Before withdrawing a finding, find the field on the
schema definition that USES it.** This rule is the more dangerous of the two, because
the first lesson guards against adding a wrong claim while this one guards against
**removing a right one** - and a retraction quietly takes knowledge away.

### The export half, and WHICH proof proves WHAT

The export half landed. Style entries go into the **same `nodeChanges` message** -
there is **no second message**, because a style **is** a node entry, so the round-109
"second message" concern was **moot**. Each carries `styleType`, a **normal node
kind**, the payload in the **normal fields** (`fillPaints` for `FILL`, `layoutGrids`
for `GRID`), plus `guid`, `phase: CREATED`, `sortPosition` and `parentIndex`.

**The canvas choice:** **reuse the document's "Internal Only Canvas" if it has one,
otherwise emit a synthetic `CANVAS` node change - and the MODEL IS NOT MUTATED.**
The round-109 **no-dangling mitigation is REMOVED**, with its test replaced: the
definition now crosses the wire, so the binding no longer dangles.

**Two proofs, and they are not interchangeable:**

| Proof | What it actually proves |
| --- | --- |
| `open-peeps.fig` import -> export -> re-import | the **STYLES**: 4 styles survive with their **names, types, guids and paints** |
| a **CONSTRUCTED** document | the **BINDING**: a rect bound to a table style comes back bound as `{"fill": "0:4"}` and **resolves** |

**One observation worth recording: the table KEY changes across the round trip**
(`style:1` -> `1:42`), because the imported table is keyed by the **wire guid**. What
must hold is that the binding **RESOLVES** - not that the literal local id is stable.

### The style cost estimate was wrong in the opposite direction

**The import filter is ONE place.** `adaptNativeTree` diverts **any** entry with
`styleType` set into the table and continues, so a style is **never** a tree node.
That means the **"six tree-consumer exclusions"** earlier rounds enumerated - `walk`,
the layers panel, hit testing, marquee, `settleDocument`'s passes, the MCP
enumeration, export - **DO NOT EXIST as work**. The estimate was mine and it was
wrong the **other** way: the real change is **smaller**, not larger.

**And a parser finding from the same probe:** `parseFigBinary` reads **only
`rawChunks[1]`**, so a file carrying a **second message** would be **silently
truncated**. That is being guarded this round.

### The style row, confirmed

**The style row reads `IMPORT half DONE` and `EXPORT half DONE`** - both halves, as of
the previous round. Nothing about it is in progress.

**And the three labels stay distinct - this is the most valuable distinction in the
document:**

| Style kind | Its node kind | Evidence label |
| --- | --- | --- |
| `FILL` | `ROUNDED_RECTANGLE` | **OBSERVED** |
| `TEXT` | `TEXT` | **CORROBORATED** |
| `EFFECT` | - | **INFERRED** |

### `StyleType` moved to the wire's SEVEN members - per-member, with reasons

The type now has **seven** members, and each one is a **decision**:

| Wire member | Decision |
| --- | --- |
| `GRID` | **ADDED** - it unblocked **three reported gaps at once** |
| `STROKE` | **deliberately NOT modelled** - a stroke **BINDING** reuses a **FILL** style, so there is no stroke style to hold |
| `EXPORT` | **deliberately NOT modelled** - **no model concept** to hold it |
| `NONE` | **not a style kind** |

**The type change was NOT free.** Adding `GRID` exposed **two real UI bugs** -
`bindingKey('GRID')` returned **`'effect'`** and `defaultStyleName('GRID')` returned
**`'Effect'`** - a **type the UI would have rendered as an effect**. Carrying the
type through is exactly **what found them**; a type-only change would have shipped
both. (Both are since fixed: `bindingKey` returns `grid`, `defaultStyleName` returns
`Grid`.)

**And the GRID round trip is NOT DONE.** The model's `LayoutGridPattern` is
**`COLUMNS | ROWS | GRID`** with a **count**, while the wire's is only
**`STRIPES | GRID`** with the **axis** carried in `type` + `axis`; the encoder
**rejected `COLUMNS` LOUDLY**. A **mapper** is being written this round. **The GRID
style is not claimed to work.**

### The three evidence labels for style node kinds - keep them distinct

- **`FILL` -> `ROUNDED_RECTANGLE`: OBSERVED** (seen in the real payload).
- **`TEXT` -> `TEXT`: CORROBORATED** (confirmed by the independent implementation).
- **`EFFECT` -> its node kind: INFERRED** - a derivation, **not** observed.

**A STROKE style is `styleType: FILL` on the wire** - strokes **reuse fill styles** -
so there is **no `STROKE` styleType to invent**.

**And the two style-binding fields our model lacks - `styleIdForStrokeFill` and
`styleIdForGrid` - REMAIN A REPORTED GAP.**

### Corroborated by an independent implementation

The shape is **CORROBORATED** - not just measured by us - by an independent working
`.fig` implementation (**open-pencil**). It confirms:

- the **FIVE** binding fields: `styleIdForFill`, `styleIdForStrokeFill`,
  `styleIdForText`, `styleIdForEffect`, `styleIdForGrid`. **Our model has three**, so
  **two remain a reported gap**;
- **`styleType` per kind**: fill and stroke -> `FILL`, text -> `TEXT`, effect ->
  `EFFECT`, grid -> `GRID`;
- that a **`TEXT` style's node kind is `TEXT`**;
- the **TEXT payload fields**: `fontSize`, `fontName`, `lineHeight`, `letterSpacing`,
  `textDecoration`, `textCase`.

**Limit: the `EFFECT` style's node kind is INFERRED, not observed.** Everything else
above is observed; that one is a derivation, and it is labelled as such.

### The real-file proof is DEFENDED, but not REPRODUCIBLE

A distinction that matters, stated exactly:

- **The behaviour is PINNED synthetically** (`tests/figma/nativeStyleFilter.test.ts`),
  so **the contract is DEFENDED** - a regression fails a test.
- **The observation itself is NOT reproducible from this checkout.**
  `open-peeps.fig` and `hellomate.fig` are **not in the repository**; they were
  obtained externally for the observation.

**That is the difference between a defended contract and a re-runnable proof.** The
reference files are staged, **gitignored, under `.fig-refs/`** for local use - they
are **not redistributed**, so a reader of this repo cannot re-run the real-file step.

### What this rule does NOT fix

It is **not a cure-all**, and it should not be read as one. It does not touch:

- **wire-shape limits** - where the wire genuinely cannot express what we hold;
- **unknown semantics** - `SCROLL_TO` is withdrawn for meaning, not for form;
- the **memory-sourced parity numbers** - a shape cannot make an unverified value
  verified. **Nothing in this document should be read as external parity evidence:
  `scripts/parity-spec.mjs` compares the app against an UNCITED `DOCUMENTED`
  constant table and four of its checks are Pigma-at-DPR-2 vs Pigma-at-DPR-1, so
  no Figma rendering is measured and 11/11 is a contract check on our own
  constants** (see the M9 row in the ROADMAP);
- the **environment blockers** - hosted infrastructure, the Tauri **system
  libraries**, and the **unit transient**.

**Fewer places to be wrong is not no places.**

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
The **name** `overflowDirection` is **not in the schema at all** - but the wire does
carry overflow-ish fields (`scrollDirection`, `scrollOffset`, `scrollBehavior`,
`scrollContractedState`, `transitionPreserveScroll`), and **which of those is
ours is not established** (see the kind-1 section above). No wire name has been
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

### Kind-1 divergences: the count is 0, and the NAME CLASS is CLOSED

**Measured, not claimed: `NOT in the schema: []`.** The inventory now reports **zero**
kind-1 divergences, and the category is **CLOSED for the name class**. Three things
closed it, and each is named:

| Closed by | Now written as |
| --- | --- |
| `componentPropertyDefinitions` | **`componentPropDefs`** (round 103) |
| `variableBindings` | **`variableConsumptionMap`** (round 113) |
| `overflowDirection` | **`scrollDirection`** (round 114) |

**How `overflowDirection` closed - established by evidence, not assumed.** The
schema's `scrollDirection => ScrollDirection` has exactly the scrolling directions as
its members - **`NONE`, `HORIZONTAL`, `VERTICAL`, `BOTH`** - while **`scrollBehavior`**
(`SCROLLS` / `FIXED_WHEN_CHILD_OF_SCROLLING_FRAME` / `STICKY_SCROLLS`) is a
**different concept** and was **NOT** collapsed into it.

**The values differ too** - the `BOOLEAN` / `BOOL` class again: the model keeps the
**REST** vocabulary and the wire uses the **short** forms
(`VERTICAL_SCROLLING` -> `VERTICAL`, `HORIZONTAL_AND_VERTICAL_SCROLLING` -> `BOTH`),
translated **both ways**.

Earlier rounds recorded this count as 3, then 1. **Both were right when written**;
the honest record is that it is now **0**.


Measured, not claimed:

| Was a kind-1 divergence | State |
| --- | --- |
| `variableBindings` | **GONE** - now written as **`variableConsumptionMap`**, the real field (this round) |
| `componentPropertyDefinitions` | **GONE** - now written as **`componentPropDefs`** (round 103) |
| **`overflowDirection`** | **REMAINS - the last one** |

**ONE REMAINS, and it is named: `overflowDirection`** - a model-side name the schema
does not define. The wire's overflow-ish fields are **`scrollDirection`**,
**`scrollOffset`**, **`scrollBehavior`**, **`scrollContractedState`** and
**`transitionPreserveScroll`** - and **WHICH ONE IS OURS IS NOT ESTABLISHED**. It is
being established this round.

**The count is 1.** It is **not** rounded down to 0, and the category is **not
closed** - a single named, still-open divergence is the honest state.

### The last KIND-1 divergence: `variableConsumptionMap`

An independent working implementation (**open-pencil**) writes a design node's
variable binding as **`variableConsumptionMap`**, shaped **`{ entries }`**, where
each entry carries **`variableField`** - and that is the **field-to-variable
association we could not find**.

**Our model's `boundVariables` (a `Record` from field to `variableId`) maps onto
`variableConsumptionMap`'s entries.** We write **`variableBindings`**, a name the
schema does not define, so `kiwi` drops it **silently**. **That is the last silent
drop in the inventory.**

**Not done:** the `variableConsumptionMap` write is **being written this round** -
nothing here claims it landed, and the inventory's **kind-1 count stays at 2** until
the round reports the new number.

### The two name mismatches are MAPPERS, not renames - and the writes stay

The same probe established the two real wire names behind the round-99 findings:

| We write | The schema's name |
| --- | --- |
| `componentPropertyDefinitions` | **`componentPropDefs`** |
| `variableBindings` | **`variableConsumptionMap`** - shaped `{ entries }`, each entry carrying **`variableField`** (the field-to-variable association) |

**`variableData` / `variableDataValues` is NOT that.** It is a **different thing**:
it lives on the **VARIABLE node** (the definition) and carries **that variable's
values per mode**. The docs previously called it the home of a node's binding
values; **that was wrong** - a node's binding is `variableConsumptionMap`, not
`variableData`. There is a parallel **`parameterConsumptionMap`** for component
parameters. (All three confirmed as fields on `NodeChange`; the entry type is
`VariableDataMapEntry`, carrying `nodeField`, `variableData` and `variableField`.)

**Neither is a rename, because the SHAPES differ** - so each needs a **mapper**, not
a string swap. Treating either as a rename would be the same mistake as the
assumptions above.

**Standing decision: the mismatched writes are KEPT.** They stay so that the
pre-encode warning keeps **reporting the loss**, rather than the export silently
carrying less. **Removing a write is a product decision, not a passing one** - a
silent export that omits a field is worse than a loud one that names it.

### A SECOND CLASS: the name check is STRUCTURALLY BLIND to shape

The name diff catches **name** mismatches. `componentPropDefs` found the form it
**cannot catch by construction**: the mapper wrote a **MAP** under the **CORRECT
FIELD NAME**, encoded as an **EMPTY LIST**. Every definition was lost with **NO
WARNING**, because the **name was right** and only the **VALUE SHAPE** was wrong.

That is the **NINTH** instance of this family, in a **NEW FORM**:

| | Form |
| --- | --- |
| Instances 1-8 | **name** losses - written under a name the schema does not define |
| **Instance 9** | a **SHAPE** loss - the right name, the wrong value shape |

**The field-name check cannot catch this by construction**, which is why a **SHAPE
check is now being built** - so the next one is caught the same way the name ones
are, by looking.

### componentPropDefs: landed BOTH ways

`VARIANT` / `BOOLEAN` / `TEXT` definitions survive the binary round trip with their
**names** and their **defaults**, and **two negatives are pinned**.

**A TYPE VOCABULARY difference sits underneath:** the wire's property-type enum has
**NINE** members against our **FIVE** - writing `BOOLEAN` through unchanged would
have **dropped every boolean**.

**And the values are boxed:** `boolValue` / `textValue` / `guidValue` / `floatValue`
/ `easingData` - where **`textValue` is a `TextData` STRUCT**, not a bare string.

### Styles: BLOCKED ON A MODEL DECISION - not work in progress

A **third cause** is established, and it is the decisive one: **Figma styles are
NODES; ours are a table.** The three options have been put to the product owner, so
this is **awaiting that decision** - not in progress, and not fixed.

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
| **Style bindings** | **BLOCKED ON A MODEL DECISION** - a third cause is established (Figma styles are NODES, ours are a table) and three options are with the product owner, so this is **awaiting that decision, not in progress**. The EXPORT half landed; the IMPORT does not survive; plus a **model gap** (5 wire fields vs 3) and a `StyleType` that has **7** members against our **3** |
| **Variable bindings** | the **LAST kind-1 divergence**: we write `variableBindings`, which the schema does not define, so `kiwi` drops it silently. The real field is **`variableConsumptionMap`** (`{ entries }`, each with **`variableField`**). **Being written this round - not done** |
| **Component property definitions** | **landed BOTH ways** (`componentPropDefs`: VARIANT/BOOLEAN/TEXT with names and defaults; two negatives pinned). What it *found* is a **SHAPE** loss - a map written under the RIGHT name as an EMPTY LIST - which is **instance 9** and which the name check is blind to; a **shape check is being built** |
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
