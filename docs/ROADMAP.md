# Pigma Roadmap

Status is based on what exists **and is verified**. A milestone is **Shipped**
only when behaviour is covered by a passing browser spec or unit test; every
Shipped line below cites its evidence.

- **Browser specs** — `tests/browser/bN-*.spec.ts` (Chromium, `CI=true npm run test:browser`)
- **Unit tests** — `npx vitest run`

Last verified: **1069 unit tests / 117 files**, **276 browser tests passing / 0 failing**,
0 orphan processes.

The repository has a **git baseline** - commit `697d88b`, the verified-green state.
Changes are reported against it with `git status --porcelain` and `git diff --stat`:
a real diff against a real baseline, rather than a content/mtime comparison.

Legend: **Shipped** verified · **In progress** built but not fully verified ·
**Planned** not started.

---

## Milestones

| # | Milestone | Status | Evidence |
| --- | --- | --- | --- |
| M1 | Canvas foundation — pan, zoom, rulers, grid, hit testing | **Shipped** | `b9-layout`, `b15-canvas-coords`, `b3-manipulation` (snapping, Ctrl bypass) |
| M2 | Drawing — rect, ellipse, frame, text, line, section, pen | **Shipped** | `b1-drawing`, `b19-features` (section, image), `b20-vector-styles-variables` (pen) |
| M3 | Selection & manipulation — select, marquee, move, resize, flip | **Shipped** | `b2-selection`, `b3-manipulation`, `b19-features` (flip H/V), `b22-round8` (min/max clamping) |
| M4 | Properties — geometry, fill, stroke, effects, text depth | **Shipped** | `b5-properties`, `b10-fidelity`, `b19-features` (shadow/blur), `b22-round8` (family, size, letter-spacing, case, decoration, auto-size), `b49-image-tile` (image scale modes: **TILE really repeats** — the emitted pattern is `userSpaceOnUse` sized to the bitmap, and pixels one tile period apart match while half a period differs), unit `src/render/imageTile.test.ts` |
| M5 | Structure — layers tree, groups, frames, sections | **Shipped** | `b2-selection`, `b6-pages`, `b10-fidelity` (single Layers header), `b19-features`. **Layer masks** are **alpha-based** like Figma's: an opaque mask emits the cheaper equivalent `clipPath`, a non-opaque one an SVG `<mask mask-type="alpha">` whose region covers the mask's transformed box — `b53-mask` 14 specs answering **real rasterised pixels** (`B53a` the shortcut clips the layer above; `B53b` the layer action is one undoable entry; `B53c` only siblings above are clipped; `B53d` inside a frame with a page-level sibling untouched; `B53e` nested into a group; `B53f` flag and clip survive a reload; `B53g`/`B53h` no dead defs; `B53i` a 50% fill blends (128/0/63); `B53j` a gradient masks by the gradient; `B53k` opaque uses `clipPath`, non-opaque declares `mask-type` as attribute AND style; `B53l` the region covers the transformed box; `B53m` a **CONTAINER** mask (a frame marked as a mask) masks by its rendered content rather than blanking its run; `B53n` a **gradient with a paint-level opacity** masks AT that opacity, taking the alpha path instead of being mis-judged opaque), unit `src/render/mask.test.ts`. Behaviour worth recording rather than a limitation: a mask is judged opaque by **one shared predicate** (`maskPaintIsOpaque`) that checks every paint type's own `opacity`, `blendMode` and a solid colour's alpha, and answers **conservatively** when in doubt - so a mask that is only *probably* opaque takes the alpha path rather than being clipped to its outline. |
| M6 | History — undo/redo, transaction coalescing | **Shipped** | `b4-history`, `b7-persistence`, `b24-plugins-theme` (a plugin run is one entry; redo re-applies) |
| M7 | Persistence & interchange — local, library, Figma import | **Shipped** | `b7-persistence`, `b8-interchange`, `b11-figma-import` (7/7 incl. embedded image), `b25-round11` (IndexedDB library, FS Access), `b27-storage` (crash marker) |
| M8 | Pages & input — pages, shortcuts, nudging | **Shipped** | `b6-pages`, `b3-manipulation` (arrow nudge 1px / Shift 10px) |
| M9 | UI fidelity vs Figma's documented UI | **Shipped for the SHELL, and the parity evidence is INTERNAL — not external** | `b9-layout`, `b10-fidelity`; parity diff 11/11, every delta 0 — reproducible: `node scripts/parity-spec.mjs` against a running dev server (exits non-zero on any row over tolerance). **What that number is NOT: an external verification.** An external audit established that the script compares the app against an **UNCITED `DOCUMENTED` constant table** (rail 56, panels 240, control height 24, toolbar radius 14, the colours) and that **four of its checks compare Pigma at DPR 2 against Pigma at DPR 1** — self-consistency, not a comparison against anything outside this repo. **No Figma rendering is measured.** So 11/11 is a **contract check on our own constants**, not evidence of 1:1 visual parity with Figma, and it must not be cited as such. The audit also lists four **observed structural differences** (from Figma's official illustrations, which may represent different UI revisions): a permanent third Inspect tab; Present in the bottom toolbar; the no-selection Design panel showing a prompt and disabled alignment controls; and individual shape tools where Figma groups them behind dropdowns. **A dated target must be chosen before the shell is changed to match any of them**, and any future external reference must record its **source URL, capture date, access role, node type, theme, viewport, zoom and DPR** |
| M10 | Layout systems — auto layout, wrap, sizing, constraints | **Shipped** | Row/Column: `b13-autolayout`, `b23-round9` (wrap packs lines, line gap, counter align), `b22-round8` (min/max + persistence), `b25-round11` (constraint icons, no overflow). **Grid auto layout — shipped for a SUBSET**: `LayoutMode` gains `GRID`, with Figma's own field names (`gridColumns`/`gridRows`/`GridTrackSize`, per-child `gridColumnAnchorIndex`/`gridColumnSpan`/...), FIXED tracks taking their pixels and the remainder shared by FLEX weights, row-major placement that skips manually anchored cells, honoured spans and a bounded scan; it is reached through `reflowTree`, the same choke point as the row/column flows, so every write path reflows a grid. Evidence: unit `src/model/gridLayout.test.ts`, browser `b57-grid-autolayout` (a 300-wide frame places three children at x 16 / 156 / 16 with the third wrapping to row 2; a column switched to FIXED 1px reflows to widths 1 / 255 / 1; resizing the frame resizes the fractional track). **Gaps, named: NOT full grid parity.** `gridRowSizing` is not implemented (the row count is derived); implicit tracks repeat the **last** declared track; **negative anchors** (Figma's -1) are unsupported; there is **no dense packing**; the track list **cannot be reordered** in the UI. Source: https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow |
| M11 | Components & design systems | **Shipped** | Components, instances and override isolation: `b12-components`. **Component slots / instance swap - shipped for a SUBSET**: `NodeOverride.children` is the slot content and `materializeInstance` **merges**, so a component edit re-materialises the subtree **without wiping what the instance put in the slot**; `ComponentPropertyType` gains `'SLOT'`; the importer accepts Figma's `SLOT` property instead of reporting it unsupported; `resolvePropertyReferences` now honours `INSTANCE_SWAP`, and the validator keeps `componentPropertyReferences` / `componentProperties` across a load. **Gaps, named - NOT full slot parity:** `preferredValues` exists but the INSTANCE_SWAP picker still offers **every** component rather than the property's preferred set; there is **no drag-to-rearrange** and **no panel slot row**; per-slot defaults beyond the component's own children, and **nested slots**, are not modelled. Sources, by name: the Figma Help Center guide on **component slots**, and the Plugin API's **`ComponentPropertyType` / `addComponentProperty` with `'SLOT'`** | Variant sets: `b12` (two components combine into a set). Styles, variable collections and binding: `b20-vector-styles-variables`. Library publish and instance insertion: `b31-libraries` (`B31a` publish status, `B31b` an `INSTANCE` node appears, `B31c` master edit + republish). Unit: `library.test.ts`, `instances.test.ts` |
| M12 | Prototyping — interactions, flows, overlays, presentation | **Shipped** | Start frame + hotspot: `b14-presentation`. Triggers incl. ON_HOVER, flows, overlay stacking: `b21-prototype-inspect`. Frame **scrolling** in presentation and **smart-animate interpolation** (35 intermediate samples between the two endpoints, read from the animated layer's computed CSS transform): `b33-animate-scroll`. Unit: `animate.test.ts`, `overlay.test.ts`, `prototype.test.ts` |
| M13 | Collaboration — presence, follow, conflict, E2E rooms | **Shipped** (local relay) | Presence, cursors, follow: `b28-rooms` 4/4 — two contexts join the same room with different nicknames, the remote cursor is a `<g>` carrying an arrow path and a `<text>` label with the peer nickname, remote edits reach the peer view, follow changes the viewBox and Esc stops it. Conflict resolution: `b32-conflict` — edits to different nodes both survive, edits to the same node converge to one value on both sides. Share links: `b35-share-link` 4/4. Unit: `merge.test.ts`, `presence.test.ts`, `e2e.test.ts`, `share.test.ts`. **Caveat: every spec here runs against a LOCAL relay started by the fixture. The hosted path is VALIDATED FOR HEADLESS CLIENTS ONLY** (a quick tunnel: `curl` gets mint + `initialize` + 35 tools). **The browser rig improved from 4/8 to 6/8** once the two allowlists were fixed (the panel mints its own token; the editor connects the public bridge) and **the security negatives held 6/6** - but **the remaining blocker is the TUNNEL, which does not stream SSE** (proven against a third-party SSE server), so **the hosted LOOP is not claimed to work** (see Known limitations). **`getpigma.com` itself remains NXDOMAIN** (measured 2026-10-05). |
| M14 | Developer handoff — inspect, redlines, codegen | **Shipped** | `b21-prototype-inspect` (Inspect tab renders measurements + CSS and React code; the Show CSS/React controls are clicked, not just present) |
| M15 | Extensibility — in-app plugins | **Shipped** | `b24-plugins-theme` (run a built-in; the document changes in exactly one history entry). Unit-only: `plugin.test.ts`, `run.test.ts`, `engine.test.ts` |
| M16 | Export — SVG, PNG, PDF, copy, selection scope | **Shipped** | `b8-interchange`, `b19-features` (PNG 1x/2x/3x really scale; PDF magic bytes), `b21-prototype-inspect` (Copy as SVG/CSS), `b23-round9` (Export selection as PNG/SVG, Copy as PNG) |
| — | MCP surface — bridge, panel, gating | **Shipped** | Bridge: `b16-mcp-bridge`, `b17-mcp-resilience` (a stalled ACK times out without killing the relay), `b18-mcp-workflow` (local edit → remote edit → undo → remote read, by node name), `b26-round12` (masked token, harness config, copy affordances). Panel gating: `b34-mcp-gating` — hosted advertises nothing and offers no connect UI, an advertised endpoint is `self-hosted` with its endpoint and token. **Both former blockers are retired.** The published-tool count is now **measured from the real server path**, not asserted: **35 tools**, enumerated over **stdio** (`src/mcp/bin.ts`, `initialize` + `tools/list`) and over **HTTP** (a real `POST /mcp`), the identical set — and the **ten hardcoded counts across four test files** that asserted it now measure it (`toolCatalog`, `rawHarness`, `stdioTransport`, `toolParity`). **The hosted LOOP is proven over a PUBLIC ORIGIN** (8/8, three consecutive runs over a public TCP tunnel - the app loaded from the internet, the browser's layer list gaining the node a public `/mcp` tool call created), so the six allowlist defects are closed and the **only** remaining public blocker is **environmental** (the Cloudflare edge not streaming SSE). **No client/vendor whitelist**: a deliberately non-vendor `clientInfo.name` over the real endpoint returns **200** with all 35 tools; `clientInfo` is never inspected, and the Claude/Cursor/Codex list is a **config generator**, not a filter. The desktop state **is reachable and verified in a browser spec**: the Tauri shell now **builds** (`cargo check` exit 0, `cargo test` 10/10 — a declared-but-unused `tauri-build` with no `build.rs`, and a missing `icons/icon.png`, were both fixed), and `b34-mcp-gating` **B34d** drives the real panel with the shell's payload injected → `data-mcp-state="desktop"`. **The webview IPC hop IS now exercised**, through the GENUINE bridge: `xvfb-run -a node tests/desktop/ipc-hop.mjs` drives `tauri-driver` -> `WebKitWebDriver` -> the real `target/debug/pigma-desktop`, invokes `desktop_info` over the actual IPC, and the panel reaches `data-mcp-state="desktop"`. **Remaining limits, stated precisely:** verified on **Linux / WebKitGTK only** (macOS WKWebView is untested); and **Xvfb / WebKitWebDriver / tauri-driver are not package dependencies**, so the hop is a **DOCUMENTED MANUAL VERIFICATION, not part of `npm test`** - **a green manual check is not a green suite**. **And the `bundle.icon` caveat went from INFERRED to CONFIRMED to FIXED:** `tauri build --debug --bundles deb` exited 0 and shipped a deb with **no icons at all** plus a dangling `Icon=pigma-desktop` reference; the canonical five icons are now derived with the project's own `tauri icon` and listed in `bundle.icon`. **Guarantee: a document built through the MCP is settled exactly like an editor edit.** The session runs `settleDocument` at one choke point before the atomic disk write, so derived geometry is correct for a harness too - an auto-sized text node gets its measured box (a 20px label is 152 x 24, not the factory's hardcoded 100 x 16.8) and a boolean created by a script re-evaluates. Evidence, through the protocol only: `b54-mcp-settle` (`B54a` the editor's own properties panel reports the settled box for a text node a script created; `B54b` a boolean a script created re-evaluates when an operand moves). **Guarantee: a plugin script that fails through the MCP changes NOTHING, and a legitimate one runs exactly ONCE.** The compile gate is a **compile-only probe** (bytecode; nothing executes) rather than an error-name check, so a runtime `SyntaxError` is not misread as a compile failure and the whole script is never re-run; the run is atomic, so a failed script leaves zero nodes. **Guarantee: every registered write tool carries the revision the session was at**, so a **missing OR wrong** revision fails, and the writer set is **pinned** - a tool that starts or stops writing is a deliberate edit. A registry-level test (`tests/mcp/tool-revision-coverage.test.ts`) enforces this and found a **real gap on its first run**: `create_new_file` wrote the document with a guarded revision, then cleared the selection with an **unguarded** `setSelection([])`. Fixed. **Guarantee: the revision guard is enforced on all three write paths, not one.** `expectedRevision` was checked on the relay path (`src/mcp/browserClient.ts`, asserted by `tests/mcp/relay.test.ts`) but **both** `createSession` and `createEditorSession` silently dropped the options argument, so a server started with a loaded file, and an MCP server running in-process with the editor, **accepted a stale write** — while the interface doc comment claimed "the editor rejects a stale write". One shared `checkRevision(current, expected)` now serves all three, throwing the relay's own message; both in-process sessions expose a revision via `getSnapshot()`, check it in `setFile` **and** `setSelection`, and bump it on change. Evidence: `tests/mcp/write-revision.test.ts` (15 tests), with `relay.test.ts` still green. **Guarantee: selection coherence.** A write that **deleted a selected node** left a dead id in the selection on **both** sessions. Every session now reports only **live** ids (`liveSelection`), and the editor session prunes the store selection after a write. **Guarantee GAP - recorded as a gap, not a bug list: the MCP write path is currently the ONLY path that enforces the document invariant.** `documentProblems` - the check that refuses an invalid document - has **exactly one caller** in the whole application (`src/mcp/session.ts:105`, the MCP write path), while `settleDocument` has about **13**. So every **UI action**, every **import**, every **in-app plugin run** and every **load** settles but does **not** validate. The sharpest instance: the **same plugin script is REFUSED through the MCP `use_pigma` tool and COMMITTED by the in-app plugin runner** - same engine, two entry points, two different outcomes. **The in-app plugin path has since been brought in line** (commit `a26389c`): `documentProblems` now has **two** callers, `src/mcp/session.ts:105` and the in-app plugin run at `src/store/editorStore.ts:2059`, and `invariants.ts` moved from `src/mcp/` to the model layer so both may use it. **The IMPORT and LOAD paths remain the open part - PENDING.** They still settle without validating, and nothing here claims otherwise: the editor is still probing them. **Guarantee: BOTH sessions enforce the same write invariants through ONE implementation.** The validation that refuses an invalid document lived on the **in-memory** session only: `createEditorSession.setFile` called `store.apply(...)` directly and never settled or validated, so a harness driving the **LIVE EDITOR** could commit an invalid document - opacity 42, a negative width, malformed colours - every one of which the in-memory session refused. That bridge is the path a real harness takes. Both sessions now go through a single shared `prepareWrite()` (settle + validate), called **before** `store.apply`, so a refusal leaves the document and the undo history untouched. Evidence: `tests/mcp/bridge.test.ts` and `tests/browser/b55-mcp-invariants.spec.ts`, which drives the live bridge. **A deliberate difference, not a defect - history.** An in-memory write has **no undo history**; a live-editor (bridge) write is **one undo entry**, and **none** when the write changes nothing or is refused. This was documented only in a code comment (the `src/mcp/bridge.ts` header and `src/mcp/session.ts`) and is now recorded here; the **caller-facing** treatment belongs in the MCP-owned `docs/MCP.md`. Measured write cost, on documents built to size. The **steady state** - re-writing an UNCHANGED document, where settle short-circuits - is linear and cheap: median **0.821 ms at 2000 nodes**, **1.524 ms at 5000**, **3.101 ms at 10000** (about 0.3 us per node), and `setFile` returns the **same object** at every size, so nothing downstream sees a spurious change. A **real** write - one that changes nodes - settles before it is stored, and two O(changed x nodes) passes have been removed: **(a) text measurement application** (round 59): `syncTextSizes` applied each measured box with its own root-walking `updateNode` call, so first-settle was **35.7 / 206.2 / 761.0 ms -> 4.4 / 3.1 / 6.2 ms** at 2k / 5k / 10k nodes; **(b) instance component lookup** (round 60): `syncInstances` resolved each instance's component with a per-instance `findNode`, so settle was **73.9 / 174.2 / 411.6 / 1094.4 ms -> 3.4 / 2.6 / 2.4 / 4.4 ms** at 500 / 1000 / 2000 / 4000 instances - now **flat in the instance count**, not merely faster. **(c) validation cost** (round 63): `documentProblems` built its message strings EAGERLY for every node, including the ones that are fine - per-node work, not the walk (the walk alone is 0.26 ms of the 6.17). At 12003 nodes with a realistic paint stack it went **6.17 ms median / 13.7 ms p95 -> 4.60 ms median / 6.09 ms p95** (~26% off the median, p95 halved), with the output proven **byte-identical** (old and new run over the same document). Nothing was weakened: every node is still checked. **(d) the instance index is built LAZILY** (round 63), on first use, so a document with no instances pays no index walk: zero-instance settle **4.1 / 3.0 / 5.5 ms** at 2k / 5k / 10k (was 4.4 / 3.1 / 6.2), while an instance-heavy document is unchanged and still flat (2.7 / 2.1 / 2.3 / 4.3 ms at 500-4000 instances). A component on **another page** still resolves - the index stays rooted at the document. **(e) the selection prune** (round 66): `liveSelection` called `findNode` per selected id, so it ran a full tree walk for **every** selected id on **every** write and **every** `getSelection` - select-all on a large document cost **~1.2 s per call** - measured at 10,003 nodes with a 10,003-id selection: **1174.9 ms median BEFORE -> 2.29 ms AFTER** (one walk, early exit; ~513x), with the early exit verified not to drop a live id (the LAST node as the last wanted id is returned; an absent id drops only itself; a select-all returns every id). It now builds the id set in **one** walk that stops as soon as every wanted id has been seen, and **nothing is cached** (a stale cache would silently drop live ids from a selection). That is the **fourth** quadratic on this path, after the text settle, the instance index and the validation messages. A component on **another page** still resolves - the index stays rooted at the document. Two honest negatives: a **change-set scan is not possible** (a plugin script hands back a whole file, so there is no delta to validate), and **sharing the walk with `settleDocument` is not worth it** - it would save 0.26 ms of 6 and couple two independent concerns. Pinned by `tests/mcp/settle-text-sync.test.ts`, `tests/mcp/settle-instances.test.ts`, `tests/mcp/invariants.test.ts` and `tests/mcp/write-churn.test.ts`. **Stated as what was checked rather than as a proof:** these are the passes *we measured*. A sweep of the other passes - `reflowTree`, `refreshBooleans` and the boolean `findNode` calls - found **no root lookups**, but that is a survey of those call sites, not a proof that the whole write path is O(n). The no-op figure above remains the **no-op** figure: it is not the cost of a write that changes many nodes. Evidence: `tests/plugins/script-semantics.test.ts`, `tests/mcp/bridge.test.ts`, `tests/mcp/write-churn.test.ts` |

---

## Shipped — what is verified today

| Area | Verified behaviour | Evidence |
| --- | --- | --- |
| Shell & layout | rail 56px, panels 240px, white 14px floating toolbar, canvas `#e5e5e5`, 24px controls | `b9-layout`, `b10-fidelity`, parity diff 11/11 - **an INTERNAL contract check on our own constants, not external verification** (see M9) |
| Drawing | rectangle at the dragged size, ellipse, frame, text, line, section, pen path (Enter commits) | `b1-drawing`, `b19-features`, `b20-vector-styles-variables` |
| Selection | click, Escape, empty-click deselect, shift-click, marquee, layer row | `b2-selection` |
| Manipulation | drag by exact delta, smart snapping + guides, Ctrl bypass, NW-handle resize pinning the opposite corner, no non-positive sizes, arrow nudge | `b3-manipulation` |
| Sizing | Min/Max W/H clamp field edits and handle drags with the anchored edge fixed; limits survive reload | `b22-round8` |
| History | undo/redo across draw and move, ordered; a plugin run is one entry and redo re-applies it | `b4-history`, `b24-plugins-theme` |
| Properties | W edit resizes on canvas; fill repaints; opacity reaches the node; rename; selection-scoped panel | `b5-properties`, `b10-fidelity` |
| Text depth | family, size, letter-spacing (percentage of size), case, decoration, hugging auto-size | `b22-round8` |
| Effects & constraints | shadow and blur reach the rendered SVG; constraint options are icon-only and never overflow | `b19-features`, `b25-round11` |
| Booleans | Union, Subtract, Intersect and Exclude each merge two overlapping shapes to one node; the op is **live** — moving or resizing an operand re-evaluates the result, and a JSON round trip stays live | `b20-vector-styles-variables`, `b50-live-boolean` (move an operand → the rendered path changes and equals a fresh evaluation; undo restores), unit `src/model/boolean.test.ts` |
| Styles & variables | style creation registers in the Assets panel; variable collection + fill binding | `b20-vector-styles-variables` |
| Components | create marks the component glyph; Assets lists it; double-click instantiates; an instance override does not change the master; two components combine into a variant set | `b12-components` |
| Auto layout | Row/Column reflow; wrap packs children onto extra lines; line gap changes the packed height; counter alignment moves mixed-height lines | `b13-autolayout`, `b23-round9` |
| Pages | add, delete, per-page content isolation | `b6-pages` |
| Persistence | localStorage document, survival across reload, geometry and pages preserved | `b7-persistence` |
| Document library | File panel actions; legacy payload adopted into the IndexedDB library; clean boot shows no spurious "Recovered" toast; a stale crash marker loses to newer work | `b25-round11`, `b27-storage` |
| Figma import | `.fig` (incl. embedded image), REST file + nodes endpoint, gradients render, unsupported features reported | `b11-figma-import` (7/7) |
| Interchange | Export JSON round-trips through import; Export SVG contains exactly one shape when one is selected | `b8-interchange`, `b23-round9` |
| Export raster & vector | PNG 1x/2x/3x really scale (IHDR-verified), PDF magic bytes, Copy as PNG puts `image/png` on the clipboard, Copy as SVG/CSS | `b19-features`, `b21-prototype-inspect`, `b23-round9` |
| Dev Mode inspect | measurements plus generated CSS and React, toggled by clicking the code controls | `b21-prototype-inspect` |
| Prototyping | start frame renders a stage; a link becomes a hotspot; overlay stacks the destination over the source; ON_CLICK/ON_HOVER/OVERLAY offered; flows addable | `b14-presentation`, `b21-prototype-inspect` |
| Plugins | a built-in runs and changes the document in exactly one history entry | `b24-plugins-theme` |
| Dark theme | toggling changes the shell appearance and toggling back restores it exactly | `b24-plugins-theme` |
| MCP bridge | panel mounts, connect/disconnect, wrong-token and unreachable-relay errors, client reporting; the relay survives a stalled ACK; a write after connect works; local → remote edit → undo → remote read by node name; pre-filled defaults, masked token, harness config | `b16`–`b18`, `b26-round12` |
| Collaboration presence | two contexts join one room with different nicknames; the remote cursor is a `<g>` in the canvas overlay holding an arrow path and a `<text>` label with the peer nickname; follow mode changes the viewBox and Esc stops it | `b28-rooms` (B28a/b/d) |

---

## Known limitations

- **Booleans are live, but their GEOMETRY is a polygon approximation.** A
  `BOOLEAN_OPERATION` keeps its operands and **re-evaluates** whenever one of
  them moves or resizes (wired as pass 4 of `settleDocument`, so every edit path
  re-evaluates; a JSON round trip stays live) — that part is done and verified.
  What is still not possible is a **curve-preserving** boolean: the result is
  produced with `polygon-clipping`, so curves are sampled and an ellipse becomes
  a 64-gon. **This is a decision, not an oversight.** No dependency was added:
  **paper** is 12.3 MB unpacked and needs a canvas shim, and **flatten-js** does
  arcs but not cubics. The source geometry IS preserved for cubics (`pathData`
  verbatim, control handles parsed), and **quadratics and arcs are refused rather
  than silently wrong**. The measured gap is a cubic sampled **16 times**
  deviating **1.25 px on a 100 px chord** (`CURVE_SAMPLES = 16`,
  `ELLIPSE_SAMPLES = 64` in `src/model/boolean.ts`). **Raising the sampling
  counts has LANDED** (commit `a26389c`): `CURVE_SAMPLES` went **16 -> 64**
  (the 1.25 px figure above was measured at 16), a deliberate call because the
  mission is 1:1 parity. The outline is therefore an approximation of the true intersection,
  not the exact Bezier result. Closing this needs a Bezier path-boolean (such as
  paper.js `PathItem` booleans, or a curve-clipping port), which polygon-clipping
  cannot provide.
- **An IMAGE mask cannot be resolved to alpha by a luminance-only renderer.**
  Masks are **alpha-based**, as Figma's are: a non-opaque mask declares
  `mask-type="alpha"` (SVG's `<mask>` defaults to *luminance*, which would invert
  dark fills), an opaque mask keeps the cheaper exactly-equivalent `clipPath`, and
  the result is measured — a 50% fill blends, a gradient masks by the gradient.
  The narrowing: an **image** mask masks by the image's alpha only wherever
  `mask-type` is honoured *and* the renderer can resolve an image to alpha; a
  renderer that can only work in luminance cannot.
- **Layer EFFECTS are not part of the mask alpha.** What a mask masks by is its
  fills and strokes — a shadow or blur on the mask layer does not contribute to
  its alpha, so it does not widen or soften the masked region.
- **Right-click context menu - BUILT, and it is a DIVERGENCE RECORD.** The rule
  **applied**, not bent.

  **The DOCUMENTED fragments are Figma's shape, used as documented, with their source
  URLs beside them in the code** (`src/ui/ContextMenu.tsx`): *Create component*,
  *Copy/Paste as properties*, *Plugins*, the *Select layer* submenu, and the
  copy-as-code items.

  **The FOUR CASES no primary source documents are OUR design**, each with a recorded
  reason: **nothing selected**, **several nodes**, **inside a frame**, **a text node**.
  For the last two the reason is a **design judgement, not a gap**: **the available
  actions do not differ by parent or kind, and a menu that changed shape without
  changing capability would be a difference the user cannot act on.**

  **What was deliberately NOT added, with its reason:**

  | Not added | Why |
  | --- | --- |
  | the *Select layer* submenu | it needs **hit-testing under the cursor** |
  | *Copy/Paste properties*, *Go to main component / Restore* | **documented but have NO ACTION** - so they are **REPORTED rather than rendered as dead entries** |
  | the copy-as-code items and *Plugins* | already in the **main menu** - a second route to the same action is **not new capability** |

  **The proof:** clicking **Group selection** changes the document in **EXACTLY ONE
  UNDO ENTRY**; the **empty menu shows Select all and NOT Use as mask**; a right-click
  **over a panel opens no canvas menu**; and **a plain left click opens nothing**.


- **The mask INDICATOR - NARROWED, not closed. Which parts:**

  **Built and proven - the Layers-panel BADGE beside the layer name.** It is **always
  on**, as Figma has it, it **reuses the existing badge shape** rather than inventing a
  second affordance (**no second source of truth**), and it is **discriminated from the
  selection mark in the browser**: the **badge is a separate ELEMENT**
  (`data-testid="layer-mask-badge"`) while **selection is a row CLASS**
  (`layer-row--selected`) - so **deselecting does not remove the badge**.

  **NOT built, with reasons:**

  | Part | Why not |
  | --- | --- |
  | the **UPWARD ARROW** on masked layers | a row **cannot know it is masked** without its parent and its index |
  | the **CANVAS OUTLINE** | Figma **gates it behind View > Mask outlines**, and we have **no View menu** - so there is **no option to hang it on**, and an always-on outline would be **a divergence AND a collision risk** |

  **Figma's actual shape, recorded with its source and its colours** (the colours are
  what make the two outlines distinguishable **by construction**): the mask outlines
  toggle lives under **View > Mask outlines** in Figma's documentation on **Masks**
  (`help.figma.com/hc/en-us/articles/360040450253-Masks`), and Figma draws the **mask
  outline in GREEN** while the **selection outline is PURPLE**. (A **SEPARATE** gap
  from the context menu above.)

  **WHY THIS ONE GOT BUILT AND THE CONTEXT MENU DID NOT - the difference is worth
  stating: the mask indicator was NOT blocked on a missing source.** Figma's documented
  indicator was available to build against, so the shape could be **established**
  rather than invented. The context menu **stopped** because its structure and
  per-selection cases could not be established from any primary source. **The rule did
  not block work; a missing source did.**
- **Hosted MCP runs through the relay.** Decision (2026-10-03, reversing the
  earlier one): getpigma.com is **intended** to offer a fully working MCP endpoint
  served by the relay, so Claude/ChatGPT can drive Pigma with no download. **That is
  a DECISION, NOT A DEPLOYMENT — measured 2026-10-05: `getpigma.com` returns
  NXDOMAIN** (DNS `Status: 3` from Google and Cloudflare DoH, authority `com.` TLD
  servers, so the name is absent from the zone rather than missing an A record;
  `www.`/`relay.`/`app.` are the same), while other hosts resolve normally from the
  same machine, so it is not a sandbox DNS block. `src/config/endpoints.ts` still
  points the panel's hosted state at `https://getpigma.com/mcp` and
  `wss://getpigma.com/relay`, so **the hosted state offers an endpoint that cannot
  resolve today**. **`getpigma.com` still returns NXDOMAIN and THAT DOES NOT CHANGE.**

  **But the hosted path is no longer merely unexercised — and the honest statement of
  what is validated has TWO HALVES.** It is **VALIDATED FOR HEADLESS CLI CLIENTS, NOT
  FOR A BROWSER** (a `curl` client gets mint + `initialize` + 35 tools).

  **Two allowlists were the earlier blockers, and both were fixed:** the **MCP ORIGIN**
  list kept `DEFAULT_ORIGINS` (loopback) while `server/deployment.ts` passed
  `allowedHosts` only, and the **BRIDGE HOST** check was `loopbackHost()` hardcoded with
  no option. **Measured after the fix: the identical 8-step browser rig went `4/8` to
  `6/8`** - the **panel now mints its own session token**, and the **editor connects the
  public bridge** (`connected=true`).

  **And the security negatives HELD 6/6** - a public host with no token is **401**, a
  wrong token is **401**, a foreign `Origin` is **403**, and `/mcp` with no token is
  **401**. **Neither gate became a pass-through.**

  **THE LOOP IS PROVEN OVER A PUBLIC ORIGIN - 8 of 8, three consecutive runs over a
  public TCP tunnel**: the app loaded **from the internet**, the panel's bridge
  **connected**, a tool call over the **public `/mcp`** creating a node, **the browser's
  layer list GAINING IT (0 -> 1)**, the canvas rendering it, and `get_metadata`
  returning **exactly the browser's node**. **This is ACHIEVED, not almost.**

  **The instrument, so the claim is checkable - the SAME 8-step rig on four fronts:**

  | Front | Result |
  | --- | --- |
  | loopback | **8/8** |
  | a public **TCP tunnel** | **8/8, three times** |
  | the **CLOUDFLARE QUICK TUNNEL** | **0/1, twice** - failing **deterministically at the bridge connect**, because it **never delivers SSE** |
  | **localtunnel** | connected **while it lived**, then was **dropped by the free front** |

  **The distinction that table makes is the point: the DEPLOYMENT IS CORRECT and the
  CLOUDFLARE EDGE is the blocker - two different KINDS of thing.** One was a **code
  gap** (now fixed) and one is **environmental**. **Do not merge them, and do not let
  "the tunnel blocks it" be read as "the hosted mode is broken".**

  **AND THE SIX DEFECTS ARE ONE STORY WITH ONE ROOT CAUSE.** The six were: the **host
  allowlist**, the **advertised URLs**, the **bridge path scope**, the **MCP origin
  allowlist**, the **bridge host allowlist**, the **bridge origin allowlist**. **The root
  cause of the last three: EACH ALLOWLIST CARRIED ITS OWN COPY OF A DEFAULT LIST**, so
  `--public-url` reached some and not others. **The fix is not vigilance, it is ONE
  DEFINITION.**

  **And the sweep that found it is worth naming: FOUR allowlists, THREE missed** - and
  **one thing that is not an allowlist at all**: `server/config.ts`'s `isLoopback`
  **CLASSIFIES the advertised URL** rather than gating anything.

  **The CLOUDFLARE QUICK TUNNEL does not stream SSE, and that is PROVEN - not
  inferred:** `GET /bridge/events` through a quick tunnel returns **nothing in 8 s**
  while the same request **on loopback returns `event: hello` immediately**; a
  **third-party SSE server carrying NO Pigma code** also returned nothing, even with
  `x-accel-buffering: no`; and **localtunnel DOES stream it**. So **the blocker is that
  edge - not tunnelling in general, and not our headers** (the relay's headers are
  **REFUTED**).

  **So the PUBLIC path has TWO INDEPENDENT BLOCKERS, of different kinds - do not merge
  them and do not describe it as blocked by one thing:**

  1. **a CODE GAP, one line**: a **sixth defect**, the same class as the fourth - the
     bridge's **ORIGIN** allowlist. `--public-url` extends the bridge **HOST** allowlist
     but **not** its **ORIGIN** one, so over a public origin the page's SSE **GET** (no
     `Origin`) passes while its **push POST** (which carries `Origin`) is **refused
     403**. It is **the same asymmetry as the MCP handler, now in the bridge**.
  2. **an ENVIRONMENTAL blocker**: the Cloudflare edge above.

  **Because this is the THIRD instance of the same pattern it is SYSTEMATIC, not
  accidental**: the editor is fixing it and **sweeping for every other allowlist
  `--public-url` does not reach**. **Room is left for that sweep table, and the count
  is NOT claimed fixed.**

  **And THREE defects came out of exposing it.** The shape is the
  lesson: **each defect HID the next**, and none was visible until the deployment was
  actually exposed.

  | # | Defect | Fixed by |
  | --- | --- | --- |
  | 1 | the MCP **host allowlist was loopback-only** and nothing passed one, so a public deployment refused **every** MCP request - **including the URL it advertised in `/config.json`** (observed: `403 'Host "<real host>" is not allowed'`, and `POST /mcp/token` returning an empty body) | `--public-url` / `PIGMA_PUBLIC_URL`: its **host joins the allowlist** beside the loopback defaults |
  | 2 | the advertised URLs were derived from the **BIND** address, so it advertised `http://127.0.0.1:8788/mcp` - **unreachable for every remote harness** | `--public-url`: it normalises to an **origin** and the advertised MCP and relay URLs come from it (the relay upgrading to **`wss://`** for an https origin) |
  | 3 | the **BRIDGE's** host/origin check ran **before any path check**, so it claimed **every** request and the app root got `403 {"error":"host/origin not allowed"}` instead of the app | **scope first (only `/bridge`), check second** - the check itself **unchanged and still strict**, because the bridge is the editor's private channel and its token is a deployment secret |

  **The result, verified on the tunnel:** app root **200** serving the app HTML;
  `/config.json` advertising the **public** origin; `POST /mcp/token` minting a
  **70-character** token; `initialize` succeeding; `tools/list` returning **35 tools
  from a NON-VENDOR identity**; and `/bridge/events` **still refusing a public Host
  (403)** while loopback gets **401** (passes the host check, needs the token).

  **And the sweep's other finding, being closed this round: THE COLLAB RELAY HAD NO
  ORIGIN OR HOST VALIDATION AT ALL.** The **room key is the boundary**, and that is a
  real mitigation - but a **cross-origin WebSocket with no origin gate IS CROSS-SITE
  WEBSOCKET HIJACKING**: any page a user visits could open a WebSocket to their relay.
  The gate is being added **using the same shared defaults and the same options, with
  the room key unchanged**. **Not claimed done.**

  **The pattern it completes:** the **MCP endpoint validates Host and Origin**, the
  **bridge now validates both**, and the **relay validated NEITHER** until this round.

  **Caveat, LOAD-BEARING and measured: behind a QUICK TUNNEL, EVERY PEER LOOKS
  LOOPBACK** - so **`POST /mcp/token` is open to anyone who knows the URL**. That is
  **a property of exposing a loopback service through a tunnel, NOT of the
  allowlists** - the allowlists are behaving correctly, as the 6/6 negatives show.
  And a quick tunnel remains **account-less, EPHEMERAL, no uptime guarantee, and for
  VALIDATION, not production**. So the honest statement is that the hosted path is
  **VALIDATED for HEADLESS CLIENTS over a public origin** - **a browser gets 4 of 8
  steps and the loop does not work yet** - **not** that the hosted service is
  production-ready, and **not** that `getpigma.com` exists.

  **And the mechanism that made defect 1 noticeable:** the **parity work had already
  established that the MCP endpoint validates `Host` and `Origin`** - which is
  **WHY** a public host was refused. A defect found by one round's evidence was
  **explained by another's**. The server
  executes the tools over the bridge, so it necessarily **sees tool calls** — accepted,
  under a hard policy that the relay **logs nothing and stores nothing** of MCP
  traffic (aggregate counters only, never payloads). The desktop app (loopback
  `http://127.0.0.1:<port>/mcp`) and a self-hosted server remain available for
  users who want the endpoint on their own machine; `stdio` stays an optional
  extra transport in the same binary.
- **Relay-only transport; peer-to-peer is NOT IMPLEMENTED.** Not *deferred* and
  not *planned* - collaboration goes through a relay server and there is no direct
  peer-to-peer path. This is **not** because NAT makes it impractical: ICE
  hole-punching works through **most** NATs (full-cone, restricted-cone and
  port-restricted-cone, which is what home routers almost always are - commonly
  cited STUN-only success is around 80-90% of connections), IPv6 usually has no
  NAT at all, and a LAN needs no traversal. The minority that cannot punch - 
  symmetric NAT (roughly 10-20%, higher on mobile and corporate networks) and
  UDP-blocking firewalls - needs **TURN**, which is a fallback for that remainder
  rather than the norm. The argument against it is therefore not feasibility: it
  is a **latency optimisation with a permanent dual-path cost**, on design-op
  traffic that is already tiny messages, over a relay that costs almost nothing -
  and the fallback for the minority is already owned, because the relay can carry
  those ops.
- **No server-side document storage.** Documents live in the browser
  (`localStorage`, IndexedDB) or in a file the user picks; the relay stores room
  snapshots only.
- **No accounts.** Nicknames are labels, not identities — the panel says so.

## Open QA items

**No failing specs.** The suite is green: `CI=true npm run test:browser` = **262
passed / 0 failed**, measured twice back-to-back, with **0 orphan processes**;
`npx vitest run` = **1069 passing / 117 files**, deterministic whether or not
`dist/` has been built. Every item previously listed here
(B29c, B29d, B31b, B31c, B33a, B33b, B28b) now passes and has been removed.

**TWO DIFFERENT SYMPTOMS, both recorded - do not merge them.**

**1. A real assertion failure, NAMED and FIXED.** The editor caught it with a 6-run
`--bail=1` loop on run 3: `tests/mcp/relay.test.ts > browser relay bridge > resets
revision tracking when the editor reconnects`, `AssertionError: expected null not to
be null` at `expect(file).not.toBeNull()`. **The cause:** the test waited for the
reconnecting editor's **revision** to reset and *then* read the file - but the
revision resets **before** the file is re-established, so there is a window with no
file. **Fixed by waiting for the file the assertion is about**, and proven with **six
consecutive clean runs**. Ruled out with evidence: **a port** (no test opens a real
server), **the build output** (the read is conditional and returns early when `dist/`
is absent), and **first-run state** (it appeared on run **3** - a **RACE**, not a
first-run effect).

**4. A BRIDGE COMMAND TIMEOUT under load - observed once, not yet chased.** RUN 1 of
round 116 reported **1 flaky**: `B11d` (a Figma REST import) failed with
**`Bridge command "setFile" timed out after 10000 ms`** (`isError: true`), so the
import never completed and the expected *"Imported"* toast never appeared; it passed
on retry. **A distinct symptom** from the three above - it is the **MCP bridge's 10 s
command timeout** being exceeded under load, not a fixture, a collection phase or an
assertion. **Observed once; not yet pursued.** Recorded rather than dismissed.

**3. A GENUINE FAILURE - REPRODUCIBLE, and now CLOSED.** Do **not** merge this into
the two above, and do **not** call it flaky: it was **reproducible**.

`B18a` failed **outright and failed on retry** - *"Test timeout of 30000ms exceeded
while setting up `relay`"* - because the **relay fixture's setup was spending the
test's own 30 s budget** spawning `vite-node` **per test** (`tests/browser/relay.ts`
is test-scoped). **Fixed with a fixture-scoped timeout**, so the process start has
its own budget instead of the assertion's, and **verified under deliberate load**
(b18 run concurrently with a four-worker suite: 2/2 passing).

**2b. THE INTERMITTENT IS NAMED - and it is NOT test logic.** What looked like two
unknown symptoms is **ONE CAUSE SEEN AT TWO MAGNITUDES.** It was reproduced
deliberately: **writing a source file WHILE VITE TRANSFORMS IT** produces a
**Pre-transform error (`Unexpected end of file`)** - **42 to 46 failures at a 1.5 s
write window, and 64 at 5 seconds**. That matches **Shape 1 exactly**
(`1 failed | 1067 passed`). **One mechanism:** a **mid-transform write fails FILES TO
COLLECT**, and the count **scales with the write window and the files' fan-in** -
which is how Shape 1 and Shape 2 (24 files uncollected, 832 of 1057) are the **SAME
CAUSE** at different magnitudes.

**Ruled out with 24 clean runs across five conditions:** load, worker count, shuffle,
cache contention between concurrent instances, memory (min 1284 MB) and fds (max 24).

**THE CAUSE IS CONCURRENT WRITERS: this repo has three agents editing it while suites
run.**

**The honest implication, which is the point of the record:**
- it is **NOT fixable by a test change**;
- `scripts/flake-hunt.sh` now **captures the next sighting**;
- **A FUTURE READER WHO SEES THAT SUMMARY SHOULD KNOW IT MEANS THE TREE MOVED, NOT
  THAT THE CODE IS BROKEN.** The state to avoid is a reader hunting a ghost.

**Each sighting above was real - the history stands - but they are not two mysteries:
that is what they turned out to be.**

**2. A COLLECTION failure - the same cause as 2b, at its larger magnitude.**
On the pass's first run: `24 test files failed | 89 passed` with only **832 of 1057
tests collected**. That is a different shape from an assertion failure: it fails to
**collect**, in the transform phase - it is **not** the same defect as (1).

**What was tried (round 114):** eight iterations of running the unit suite
**immediately and concurrently** with a four-worker browser-suite subset, to
reproduce the load-at-collection-time condition.

**Result: NOT REPRODUCED - 8/8 clean, `114 files passed / 1059 tests`, zero error
lines each time.** That is a **stronger statement than the hypothesis alone**: the
symptom has now been deliberately pursued under load and did not appear. It remains
**open and unnamed**, and the cause is still unestablished - but "attempted eight
times under load, not reproduced" is the honest current state, not "probably load".

Coverage added since: PWA offline reload (`b37-pwa-offline`), the line tool
(`b36-shapes`), polygon and star creation and editing (`b40`/`b41`), a committed
screenshot baseline diff (`b39-pixel-diff`) and the italic face round trip on
both import paths (`b42-figma-italic-roundtrip`), which now pass end to end.

What follows is *coverage* still missing, not failures:


- **Hosted infrastructure is not exercised.** Browser specs run against the dev
  server and a **local** relay started by the fixture, so the **hosted** relay at
  getpigma.com is unverified by a browser spec.
- **The MCP `desktop` state IS reached and verified, INCLUDING the real webview IPC
  hop** (see the MCP row, now **Shipped**). Two independent defects made it
  unreachable in the real app, and **fixing the first would not have revealed the
  second**:
  - **Defect 1:** `DesktopInfo` had `#[derive(Serialize)]` with **no `rename_all`**,
    so the shell emitted snake_case `mcp_endpoint` while the reader read camelCase
    `mcpEndpoint` -> `normalizeEndpoint(undefined)` -> null -> **silent fall-through
    to hosted**.
  - **Defect 2, found by running the real hop:** the webview had **no
    `window.__TAURI__` at all**, so `desktop_info` was unreachable and the panel fell
    through to the embedded `dist/config.json` advertisement. Cause: Tauri injects
    that global only when **`app.withGlobalTauri`** is true, and the config did not
    set it. Fixed with `"withGlobalTauri": true`.

  **Remaining limits, stated precisely:** verified on **Linux / WebKitGTK only**
  (macOS WKWebView untested); and **Xvfb / WebKitWebDriver / tauri-driver are not
  package dependencies**, so the hop is a **DOCUMENTED MANUAL VERIFICATION, not part
  of `npm test`** - **a green manual check is not a green suite**.
- **File System Access** — the menu entries are asserted (`b25-round11` `B25c`);
  the OS file-picker round trip cannot be driven headlessly.
- **Figma pixel parity - the most important finding in these docs.** The parity
  script now keeps the two kinds of evidence **separate on purpose** and prints, as
  measured 2026-10-05:

  - **INTERNAL 11 passed / 11**
  - **EXTERNAL 0 passed / 1** - **1 structure, 0 pixel**
  - **VISUAL PARITY: UNSUPPORTED**
  - and it **EXITS NON-ZERO BY DESIGN**, because it cannot support its own claim.

  **The red exit is INTENTIONAL, not a regression.** A reader who sees a failing
  script and assumes breakage would be wrong; a reader who sees it and assumes the
  claim is fine would be wrong too.

  **The one measured external row - the FIRST external number this project has ever
  had against Figma:** the **properties-panel tab count**. Figma documents **TWO**
  tabs with edit access; Pigma renders **THREE**; **delta 1**. It is cited to the
  Figma Help Center article with its **capture date** (2026-10-05) and the article's
  own sentence quoted. **It currently FAILS.** Both halves matter: it is **real
  external evidence**, and **it does not pass**.

  **Why the two counts are separate, and must stay so:** **INTERNAL 11/11 is a
  contract check on OUR OWN constants**; **EXTERNAL 0/1 is a comparison against a
  cited outside source**. Counted together, either could be read as the other.

  **A future external geometry reference - and what kind it is.** Figma's own
  **shipped CSS** is being attempted this round: numeric, citable, and needing **no
  pixel interpretation**. If it lands, **what it establishes must be stated
  precisely: Figma's shipped stylesheet describes Figma's DOCUMENTED / IMPLEMENTED
  geometry, NOT its rendered pixels.** That would upgrade the claim from *"we match
  our own constants"* to *"we match Figma's stylesheet"* - a **real step up, and
  NOT pixel parity**. **It must not become "pixel parity achieved".** Room is left
  for the result; no numbers are pre-empted.

### How the Figma matching was actually done

**Nothing visits figma.com.** The only `figma.com` strings in `src/` are three
documentation URLs in comments and one Plugin API identifier
(`figma.combineAsVariants`); there is no web tool in the MCP surface. The REST
import only **parses** responses - the fetch is user-initiated in the UI with the
user's own token - and `src/mcp/bin.ts` instructs the model to *never* fetch a
design from figma.com.

**The parity numbers are MEMORY-SOURCED and UNVERIFIED, and the parity script is
self-referential by construction.** `scripts/parity-spec.mjs` compares the app's
measured values against a `DOCUMENTED` object of **hardcoded literals**
(`railWidth: 56`, `panelWidth: 240`, `controlHeight: 24`, `toolbarRadius: 14`,
`canvasBg`, `toolbarBg`) typed into the repo from the model's memory of Figma. The
loop is therefore: **memory -> literals in the repo -> the app diffed against
them.** If a remembered number is wrong the test still passes, because both sides
of the comparison share the same source. **"11/11, every delta 0" means the app
agrees with these literals - it does NOT mean the app matches Figma.**

The repo's own evidence vocabulary already says this. Every
[FIGMA_COMPAT.md](FIGMA_COMPAT.md) row is `documented-from-code` ("we read our own
implementation") or `test-backed` ("our own test passes") - 17 and 22 of them -
and **not one says "verified against Figma"**, because none is.

**Confidence differs by layer and is not uniform:**

| Layer | Confidence | Why |
| --- | --- | --- |
| **What** a feature is - Dev Mode is a toggle plus an Inspect panel with measurements, code targets, Code Connect and a ready-for-development status | **High** | Famous public knowledge about Figma |
| **Specific values** - a 56px rail, 240px panels, `#e5e5e5`, the tab order | **Low, UNVERIFIED** | Memory of specifics; nothing checks them against Figma |
| **Implementation choices** - the badge reading "Ready"/"Done", no right-click menus anywhere, geometry-based masks | **Ours by design** | Deliberate; some already listed as divergences above |

**What would close it:** Figma itself, or Figma's published specs/screenshots
brought into the repo as **committed fixtures** and diffed against the `DOCUMENTED`
values - which turns those literals from memory into evidence. Until then, this
row is a statement about our own consistency, not about Figma.

### The shortcut table, swept in BOTH directions

A surface in its own right: not only "does every key do something", but "does every
action have a key, and is the key shown".

| Category | Finding |
| --- | --- |
| **Advertised but not bound** | the context menu advertised **Command-Option-K** for *Create component* with **no `k` binding** - measured by pressing it (the row stayed **byte-identical**) against clicking it (the row **changed**); and **`C` for Comment**. |
| **A divergence, cited** | **Shift-D** was bound to **Toggle dark theme** while Figma documents **Shift+D as DEV MODE**, and our Dev Mode toggle has **no shortcut** - the same key meaning different things, with Figma's use of it **unreachable by keyboard here**. |
| **Missing vs Figma's documented set, cited** | **Shift+Enter** (select parent), **F6** / **Ctrl+F6** (focus the toolbar), **Option or Ctrl+Space** (keyboard box selection). |
| **Bound but not advertised** | **eleven families**, all functional, **none shown in the UI**, while Figma's own shortcut panel documents its equivalents - a **DISCOVERABILITY divergence, not a defect** (worth saying which it is). |
| **Collisions** | every letter shared between a meta and a non-meta form (**G, D, V, R, X, H**) was checked and **NONE** collide - **a clean bill**, recorded as one rather than left unsaid. |

**AND A CODE-LEVEL BUG, NOW FIXED: `Enter` was handled TWICE**, and the second block
called `preventDefault()` **before** testing whether the node is a container - so on a
plain shape the key was **SWALLOWED with nothing happening**. **Consumed is worse than a
dead binding**, because nothing downstream can use it either.

**VERIFIED IN SOURCE, and this is ahead of the brief: three of the items above have
already LANDED.** `src/hooks/useKeyboardShortcuts.ts` now binds **`meta+alt+k` to
`createComponentFromSelection`** (with the comment *"the context menu advertised it and
nothing bound it, which is the defect this fixes"*), carries **`c: 'comment'`** in
`TOOL_KEYS` (*"Figma uses C for Comment; the toolbar advertised it and nothing bound
it"*), and the `Enter` block now reads **"TEST FIRST, PREVENT ONLY WHEN ACTING"**,
naming the old behaviour in exactly those terms. **And no dark-theme shortcut binding
exists in the tree at all**, so the **Shift-D divergence is not present in this
revision** either. **The brief describes the state before these landed.**

**`C` for Comment was a PARITY GAP rather than a divergence** - Figma binds it.

**And the retraction, which is the method working against itself:** an agent concluded
**from a grep** that **space+drag pan** was absent, then **measured** it and found it
**PANS**, and wrote the retraction into its own report. **A retraction caught by
measurement** - the same lesson as the earlier one, **applied to the agent's own
conclusion**.

### The desktop shell: a feature that does ALL its work and then never uses it

**Two findings, both OPEN. Neither outcome is claimed - the editor is deciding this
round whether to WIRE it or REMOVE it.**

1. **The asset auto-update path fetches a bundle, sha256-verifies it, and installs it
   into the cache - and then THE WINDOW NEVER LOADS IT.** The serving path is real and
   **registered** (`register_asynchronous_uri_scheme_protocol("pigma", …)`,
   `src-tauri/src/main.rs:279`), with path normalisation and `..` refused. But
   **measured, the window config sets NO `url`**, so it loads the **embedded
   `frontendDist` (`../dist`)** - and **no code in `src-tauri` or `src` ever REQUESTS
   the scheme.** Every `pigma://` in the frontend and the tests is the **MCP RESOURCE
   uri**, not the shell scheme.
2. **`desktop_info.assetOrigin` is a HOLLOW FIELD.** Its own documentation says *the
   scheme origin when a bundle is active*, and it is **hardcoded `None` in every
   measured payload**, with **nothing able to make it non-null**.

**So the feature does the entire expensive half of its job, and the thing it exists for
- shipping a fix WITHOUT REBUILDING THE APP - does not happen.**

**And the documentation currently CLAIMS the wired behaviour**: `docs/DESKTOP.md` says
*"the window loads the active bundle through the `pigma://localhost`"*. **A documented
feature that does not exist is worse than no feature** - the same lesson as the earlier
claim defects: a reader ACTS on it.

**The proof standard it was given, and it is the point:**
- show the window **LOADING the marker bundle**;
- show the **FALLBACK with no cached bundle** - an asset path that can *fail to a blank
  window* would be **a worse bug than the one being fixed**;
- show a **BAD-HASH bundle is REJECTED AT THE SERVING PATH**, not only at the install
  path.

### Two surfaces still being swept

- **The TEXT EDITOR's own gestures** - double-click into the inline editor, typing,
  Escape, auto-size, and the edges: **empty string, long line, multi-line paste, a
  missing font**.
- **`scripts/**` other than the flake harness** - starting with whether
  `desktop-assets.mjs`'s output is **USED** at all. **A build step nobody reads is the
  same class as the desktop scheme.** Room is left for both; no findings are pre-empted.

### The signature defect class, swept SYSTEMATICALLY for the first time

**About 300 UI affordances enumerated with `file:line` citations, about 296 wired, and
SIX HOLLOW.** The method is the point: **the question asked was "does it DO something
observable", not "does it render"** - which is the only question that finds this class.

**The six, and what makes each hollow:**

| Hollow | Why |
| --- | --- |
| **Frame selection** in the **empty** menu | a **GUARANTEED no-op**: `frameSelection` returns immediately when the selection is empty - **the very condition that renders that menu** |
| **Group selection** with one node | a **CONDITIONAL no-op with the item ENABLED** |
| **Ungroup** on a non-container | idem |
| **Paste** with an empty clipboard | idem |
| the **`pigma:open-menu` listener** | **ZERO DISPATCHERS**, while its own comment claims the left File section dispatches it |
| the **Comment tool's shortcut `C`** | it **advertises `C`** while the key table **has no `c`** |

**These are an OPEN list.** The editor is fixing them this round and **nothing is claimed
fixed until it reports.**

**THE MCP HALF IS NOW COMPLETE, AND THE INFERENCE IS GONE.** `22` of `35` tools were
called for real and **none** was hollow; the other **`13` were left on the parity
table's word - an INFERENCE, and it was recorded as one.** This round **all thirteen
were called**, and each answered its **DOCUMENTED CAPABILITY ERROR** (`isError` true,
`supported` false, `capability` equal to the tool's name, a reason, and at least one
alternative). So **`35` of `35` tools are verified by REAL CALL**, and "all 35 tools are
wired" is now **OBSERVED rather than INFERRED**.

**Keep the shape of that claim honest: the tool LIST was measured long ago; the CALLS
are what closed this; the two are DIFFERENT claims.**

**The method note - the same lesson as the retraction: a heuristic is a FILTER FOR WHERE
TO LOOK, not a verdict.** The first heuristic was **too narrow**: creating tools return
**new ids** and search/library tools return **their own records**, so each flagged
response was **verified** rather than the heuristic reported.

*Note: the sweep's enumeration is not committed to this repository - it is reported
here, and a reader cannot re-run it from this checkout.*

### The pattern this project keeps finding: a feature that is present and does nothing

**Six times now**, a capability has looked implemented - present in the schema, offered in the UI, or simply absent from anyone's suspicion - while the path that should exercise it did nothing. Every one was found by **PROBING a path** (driving it and measuring the result), never by reading the schema. That is the same method the external audit used, and it is the most valuable thing this project has learned about itself.

| # | Instance | What it looked like | What it was |
| --- | --- | --- | --- |
| 1 | `actions[0]` | a prototype with several actions | only the first one ran |
| 2 | the imported `OVERLAY` | a prototype overlay that was imported | it never overlaid |
| 3 | `liveSelection`'s cost | a correct-looking de-duplication | a full tree walk per selected id - O(selection x nodes) (see item (e) above) |
| 4 | `resolvePropertyReferences` | an `INSTANCE_SWAP` property offered in the panel and stored on the instance | it resolved **nothing**: only `'visible'` and `'characters'` were handled |
| 5 | the validator | instance property values and layer bindings | **dropped on load** - `componentPropertyReferences` and `componentProperties` did not survive a save |
| 6 | the instance property panel | a documented "switch per variant property plus BOOLEAN/TEXT/INSTANCE_SWAP controls" on an instance | **the precise scope: an instance of a STANDALONE component lost every property control (BOOLEAN, TEXT, INSTANCE_SWAP), while an instance inside a component set worked.** The panel resolved the definitions from `componentSetOf(instance.componentId)` and fell back to the instance's own node, which owns none. **FIXED** - `propertyOwnerOf(file, node)` (`src/model/variants.ts:263`) resolves the node that OWNS the definitions, and the panel is now one call. Pinned by `b58-component-slots`, now asserting the control is present |
| 7 | `nodesEquivalent` | instance override propagation | it did **not** compare `componentPropertyReferences`, so a **binding** change never reached an instance's materialised children. Found the same way - by making the propagation test pass. |

Items 6 and 7 are both **resolved** - they stay in the table because the LESSON is the point, not the bug. **The governing principle now covers this whole class:** *prefer Figma's shape, and
if we diverge, record the reason* - because **every divergence we chose became a
bug**, at a measurable rate. See
[FIGMA_COMPAT.md](FIGMA_COMPAT.md), "The governing principle", for the divergence
table with a verdict on every row and for what the rule does **not** fix.

**A named sub-class, and it is now FIVE instances: decisions reasoned against the
WRONG vocabulary.** Time after time a capability was judged from the **REST** API's
vocabulary when the **NATIVE** wire disagrees:

| # | Pigma / REST | Native wire | What it caused |
| --- | --- | --- | --- |
| 1 | `strokeDashes` | `dashPattern` | dashes dropped in every schema, silently |
| 2 | `EVENODD` | `ODD` | a silently **wrong** fill rule (`NONZERO`) |
| 3 | `CHANGE_TO` | `SWAP_STATE` | the variant swap was **withdrawn as inexpressible** when it was not |
| 4 | `ON_DRAG` | `DRAG` | the drag trigger was unmapped |
| 5 | `MOUSE_ENTER` / `MOUSE_LEAVE` | `MOUSE_IN` / `MOUSE_OUT` | the hover pair was unmapped |

**The remedy is now demonstrated rather than asserted.** Fixing the triggers by
**listing the NATIVE vocabulary** immediately surfaced instances 4 and 5 - the same
class, found by the same method. The rule: **list the NATIVE vocabulary in every
map on the conversion path**, and treat the REST spelling as an importer alias
where a document may arrive that way (`CHANGE_TO` -> `SWAP_STATE`). The editor is
**auditing the other maps this round** - connections, transitions, easings,
navigation types and overlay positions - so the count may still grow. **In
progress.**

Anyone reading this project should check which vocabulary a claim was reasoned
against before trusting it.

**And the remedy has now been APPLIED, not merely described.** The withdrawn
variant swap was restored (`SWAP_STATE`), and the fix for the naming problem is a
**rule**: the model uses Figma's **NATIVE** name and handles the **REST** spelling
as an importer **alias** (`CHANGE_TO` -> `SWAP_STATE`) - one vocabulary in the
model, and a REST-sourced document still lands. That is the sub-class closed by
policy rather than by a third patch.

The lesson is in the method, not the list: **schema presence and panel presence are not evidence.** Items 1, 2, 4, 5 and 6 all had a plausible-looking implementation; items 3 and 6 had no user-visible symptom at all, which is why only probing or measuring finds them. A reader should treat "the field exists" and "the control is rendered" as **unproven** until something drives the path end to end.

### External audit - what it found

An external audit visited **Figma's official Help Center** and compared it against
the running editor. This is the **first external verification this project has
had**, and it confirms the provenance problem above.

**It confirms the parity script is a Pigma contract check, not external
verification.** `scripts/parity-spec.mjs` compares the app against an **uncited**
`DOCUMENTED` object (rail 56, panels 240, control height 24, toolbar radius 14,
the colours), and **four of its checks compare Pigma at DPR 2 against Pigma at
DPR 1** - self-consistency, not a comparison against anything external. **No
Figma rendering is measured.** The requirement the audit proposes, and the rule
this repo should adopt: **separate internal geometry checks from external
reference comparisons**, and for every external reference record the **source
URL, capture date, access role, selected node type, theme, viewport, browser zoom
and DPR**.

**Observed structural differences - a DECISION LIST, not a fix list.** These are
**observations from Figma's official illustrations, NOT measured pixel errors**.
**Nothing here should be changed until a dated target is chosen** (below), and the
choice is the **product owner's**.

| Observed difference | Source | What changing it would cost | What it would break |
| --- | --- | --- | --- |
| A **permanent third Inspect tab** | the audit's read of Figma's official illustrations | a visibility rule (tab only with a selection) plus a new empty state | specs that select that tab directly (`b21`, `b34-mcp-gating`), and wherever the no-selection experience currently lives |
| **Present in the bottom toolbar** | the official toolbar reference | moving it to Figma's position - a markup/CSS move | the layout contract in `b9-layout` / `b10-fidelity` and the parity constants; the specs drive it by **aria-label** (`b14`, `b59`) so they would survive a move |
| The **no-selection Design panel** shows a prompt and **disabled alignment controls** | the official illustration | rendering the full panel in a disabled state instead of a prompt | `b5-properties` `B5e`, which asserts the panel shows geometry **for the selection only** |
| **Individual shape tools** where Figma **groups them behind dropdowns** | the official toolbar reference | a dropdown component plus keyboard handling | the toolbar contract in `b9-layout`, and **every** spec that clicks a tool by aria-label - those labels would move inside a menu |

**A DATED TARGET MUST BE CHOSEN before any of these is matched, and the choice is the
product owner's.** The reason is in the warning above: **official help images can
represent DIFFERENT UI REVISIONS**, so "match the illustrations" is not a
specification until it says *which* revision and *when* it was captured.

**Dev Mode and Code Connect EXIST here** - statuses plus CSS / React / SwiftUI /
Compose codegen, and the Code Connect mapping tools. Nothing in these documents
should imply they are absent. The gap is **scope**, and the editor is fixing the
status gate.

**Confirmed missing features, recorded as milestone gaps** (rather than left
implied):

| Gap | Figma has | Pigma has | Milestone |
| --- | --- | --- | --- |
| **Grid auto layout** | a third auto-layout flow: row/column tracks, fractional fill sizing, automatic/manual placement, spanning children | **Shipped for a subset** (tracks, fractional fill, placement, spans) in `LayoutMode = GRID`; still missing `gridRowSizing`, negative anchors, dense packing, track reordering, and implicit tracks repeat the last declared track. The Cols/Rows/Grid controls remain layout **GUIDES** (`LayoutGrid`), a separate control by design | **M10** - partly closed |
| **Component slots** | native slot properties | `ComponentPropertyType` is `VARIANT / BOOLEAN / TEXT / INSTANCE_SWAP` - **there is no `SLOT`** | gap in **M11** |
| **Prototype variables and conditionals** | `Set variable` actions and expressions | not implemented; plus a **multi-action execution defect** the editor is fixing | **M12** |

The sources are Figma's official Help Center guides (grid auto layout, component
slots, and setting variables in prototypes). **Their exact URLs are deliberately
not recorded here:** by the rule stated just above, an external reference must
carry its URL and capture date *when it is committed*, and this section was
written from the audit's report rather than from a visit to Figma. Writing down a
URL that was never fetched would be the same unverified-memory problem this
section exists to expose.



- **`.fig` round-trip lossiness beyond the pinned rows** — float32 geometry
  precision and path-data command survival are now test-backed (`b43`); a
  **colour** through a whole `.fig` archive is still documented-from-code, because
  serialising one needs a real `.fig` schema and compressors. Every row of
  [FIGMA_COMPAT.md](FIGMA_COMPAT.md) now carries an explicit
  `test-backed:`/`documented-from-code:` evidence entry.
