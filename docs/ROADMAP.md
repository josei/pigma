# Pigma Roadmap

Status is based on what exists **and is verified**. A milestone is **Shipped**
only when behaviour is covered by a passing browser spec or unit test; every
Shipped line below cites its evidence.

- **Browser specs** — `tests/browser/bN-*.spec.ts` (Chromium, `CI=true npm run test:browser`)
- **Unit tests** — `npx vitest run`

Last verified: **973 unit tests / 102 files**, **247 browser tests passing / 0 failing**,
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
| M9 | UI fidelity vs Figma's documented UI | **Shipped** | `b9-layout`, `b10-fidelity`; parity diff 11/11, every delta 0 — reproducible: `node scripts/parity-spec.mjs` against a running dev server (exits non-zero on any row over tolerance) |
| M10 | Layout systems — auto layout, wrap, sizing, constraints | **Shipped** | `b13-autolayout`, `b23-round9` (wrap packs lines, line gap, counter align), `b22-round8` (min/max + persistence), `b25-round11` (constraint icons, no overflow) |
| M11 | Components & design systems | **Shipped** | Components, instances and override isolation: `b12-components`. Variant sets: `b12` (two components combine into a set). Styles, variable collections and binding: `b20-vector-styles-variables`. Library publish and instance insertion: `b31-libraries` (`B31a` publish status, `B31b` an `INSTANCE` node appears, `B31c` master edit + republish). Unit: `library.test.ts`, `instances.test.ts` |
| M12 | Prototyping — interactions, flows, overlays, presentation | **Shipped** | Start frame + hotspot: `b14-presentation`. Triggers incl. ON_HOVER, flows, overlay stacking: `b21-prototype-inspect`. Frame **scrolling** in presentation and **smart-animate interpolation** (35 intermediate samples between the two endpoints, read from the animated layer's computed CSS transform): `b33-animate-scroll`. Unit: `animate.test.ts`, `overlay.test.ts`, `prototype.test.ts` |
| M13 | Collaboration — presence, follow, conflict, E2E rooms | **Shipped** (local relay) | Presence, cursors, follow: `b28-rooms` 4/4 — two contexts join the same room with different nicknames, the remote cursor is a `<g>` carrying an arrow path and a `<text>` label with the peer nickname, remote edits reach the peer view, follow changes the viewBox and Esc stops it. Conflict resolution: `b32-conflict` — edits to different nodes both survive, edits to the same node converge to one value on both sides. Share links: `b35-share-link` 4/4. Unit: `merge.test.ts`, `presence.test.ts`, `e2e.test.ts`, `share.test.ts`. **Caveat: every spec here runs against a LOCAL relay started by the fixture; the hosted relay at getpigma.com is not exercised by QA.** |
| M14 | Developer handoff — inspect, redlines, codegen | **Shipped** | `b21-prototype-inspect` (Inspect tab renders measurements + CSS and React code; the Show CSS/React controls are clicked, not just present) |
| M15 | Extensibility — in-app plugins | **Shipped** | `b24-plugins-theme` (run a built-in; the document changes in exactly one history entry). Unit-only: `plugin.test.ts`, `run.test.ts`, `engine.test.ts` |
| M16 | Export — SVG, PNG, PDF, copy, selection scope | **Shipped** | `b8-interchange`, `b19-features` (PNG 1x/2x/3x really scale; PDF magic bytes), `b21-prototype-inspect` (Copy as SVG/CSS), `b23-round9` (Export selection as PNG/SVG, Copy as PNG) |
| — | MCP surface — bridge, panel, gating | **In progress** | Bridge: `b16-mcp-bridge`, `b17-mcp-resilience` (a stalled ACK times out without killing the relay), `b18-mcp-workflow` (local edit → remote edit → undo → remote read, by node name), `b26-round12` (masked token, harness config, copy affordances). Panel gating: `b34-mcp-gating` — hosted advertises nothing and offers no connect UI, an advertised endpoint is `self-hosted` with its endpoint and token. **In progress because the `desktop` state needs the Tauri shell's `desktop_info` and is unreachable from a browser spec**, and the published-tool count is not QA-verified here. **Guarantee: a document built through the MCP is settled exactly like an editor edit.** The session runs `settleDocument` at one choke point before the atomic disk write, so derived geometry is correct for a harness too - an auto-sized text node gets its measured box (a 20px label is 152 x 24, not the factory's hardcoded 100 x 16.8) and a boolean created by a script re-evaluates. Evidence, through the protocol only: `b54-mcp-settle` (`B54a` the editor's own properties panel reports the settled box for a text node a script created; `B54b` a boolean a script created re-evaluates when an operand moves). **Guarantee: a plugin script that fails through the MCP changes NOTHING, and a legitimate one runs exactly ONCE.** The compile gate is a **compile-only probe** (bytecode; nothing executes) rather than an error-name check, so a runtime `SyntaxError` is not misread as a compile failure and the whole script is never re-run; the run is atomic, so a failed script leaves zero nodes. **Guarantee: every registered write tool carries the revision the session was at**, so a **missing OR wrong** revision fails, and the writer set is **pinned** - a tool that starts or stops writing is a deliberate edit. A registry-level test (`tests/mcp/tool-revision-coverage.test.ts`) enforces this and found a **real gap on its first run**: `create_new_file` wrote the document with a guarded revision, then cleared the selection with an **unguarded** `setSelection([])`. Fixed. **Guarantee: the revision guard is enforced on all three write paths, not one.** `expectedRevision` was checked on the relay path (`src/mcp/browserClient.ts`, asserted by `tests/mcp/relay.test.ts`) but **both** `createSession` and `createEditorSession` silently dropped the options argument, so a server started with a loaded file, and an MCP server running in-process with the editor, **accepted a stale write** — while the interface doc comment claimed "the editor rejects a stale write". One shared `checkRevision(current, expected)` now serves all three, throwing the relay's own message; both in-process sessions expose a revision via `getSnapshot()`, check it in `setFile` **and** `setSelection`, and bump it on change. Evidence: `tests/mcp/write-revision.test.ts` (15 tests), with `relay.test.ts` still green. **Guarantee: selection coherence.** A write that **deleted a selected node** left a dead id in the selection on **both** sessions. Every session now reports only **live** ids (`liveSelection`), and the editor session prunes the store selection after a write. **Guarantee: BOTH sessions enforce the same write invariants through ONE implementation.** The validation that refuses an invalid document lived on the **in-memory** session only: `createEditorSession.setFile` called `store.apply(...)` directly and never settled or validated, so a harness driving the **LIVE EDITOR** could commit an invalid document - opacity 42, a negative width, malformed colours - every one of which the in-memory session refused. That bridge is the path a real harness takes. Both sessions now go through a single shared `prepareWrite()` (settle + validate), called **before** `store.apply`, so a refusal leaves the document and the undo history untouched. Evidence: `tests/mcp/bridge.test.ts` and `tests/browser/b55-mcp-invariants.spec.ts`, which drives the live bridge. **A deliberate difference, not a defect - history.** An in-memory write has **no undo history**; a live-editor (bridge) write is **one undo entry**, and **none** when the write changes nothing or is refused. This was documented only in a code comment (the `src/mcp/bridge.ts` header and `src/mcp/session.ts`) and is now recorded here; the **caller-facing** treatment belongs in the MCP-owned `docs/MCP.md`. Measured write cost, on documents built to size. The **steady state** - re-writing an UNCHANGED document, where settle short-circuits - is linear and cheap: median **0.821 ms at 2000 nodes**, **1.524 ms at 5000**, **3.101 ms at 10000** (about 0.3 us per node), and `setFile` returns the **same object** at every size, so nothing downstream sees a spurious change. A **real** write - one that changes nodes - settles before it is stored, and two O(changed x nodes) passes have been removed: **(a) text measurement application** (round 59): `syncTextSizes` applied each measured box with its own root-walking `updateNode` call, so first-settle was **35.7 / 206.2 / 761.0 ms -> 4.4 / 3.1 / 6.2 ms** at 2k / 5k / 10k nodes; **(b) instance component lookup** (round 60): `syncInstances` resolved each instance's component with a per-instance `findNode`, so settle was **73.9 / 174.2 / 411.6 / 1094.4 ms -> 3.4 / 2.6 / 2.4 / 4.4 ms** at 500 / 1000 / 2000 / 4000 instances - now **flat in the instance count**, not merely faster. **(c) validation cost** (round 63): `documentProblems` built its message strings EAGERLY for every node, including the ones that are fine - per-node work, not the walk (the walk alone is 0.26 ms of the 6.17). At 12003 nodes with a realistic paint stack it went **6.17 ms median / 13.7 ms p95 -> 4.60 ms median / 6.09 ms p95** (~26% off the median, p95 halved), with the output proven **byte-identical** (old and new run over the same document). Nothing was weakened: every node is still checked. **(d) the instance index is built LAZILY** (round 63), on first use, so a document with no instances pays no index walk: zero-instance settle **4.1 / 3.0 / 5.5 ms** at 2k / 5k / 10k (was 4.4 / 3.1 / 6.2), while an instance-heavy document is unchanged and still flat (2.7 / 2.1 / 2.3 / 4.3 ms at 500-4000 instances). A component on **another page** still resolves - the index stays rooted at the document. **(e) the selection prune** (round 66): `liveSelection` called `findNode` per selected id, so it ran a full tree walk for **every** selected id on **every** write and **every** `getSelection` - select-all on a large document cost **~1.2 s per call** - measured at 10,003 nodes with a 10,003-id selection: **1174.9 ms median BEFORE -> 2.29 ms AFTER** (one walk, early exit; ~513x), with the early exit verified not to drop a live id (the LAST node as the last wanted id is returned; an absent id drops only itself; a select-all returns every id). It now builds the id set in **one** walk that stops as soon as every wanted id has been seen, and **nothing is cached** (a stale cache would silently drop live ids from a selection). That is the **fourth** quadratic on this path, after the text settle, the instance index and the validation messages. A component on **another page** still resolves - the index stays rooted at the document. Two honest negatives: a **change-set scan is not possible** (a plugin script hands back a whole file, so there is no delta to validate), and **sharing the walk with `settleDocument` is not worth it** - it would save 0.26 ms of 6 and couple two independent concerns. Pinned by `tests/mcp/settle-text-sync.test.ts`, `tests/mcp/settle-instances.test.ts`, `tests/mcp/invariants.test.ts` and `tests/mcp/write-churn.test.ts`. **Stated as what was checked rather than as a proof:** these are the passes *we measured*. A sweep of the other passes - `reflowTree`, `refreshBooleans` and the boolean `findNode` calls - found **no root lookups**, but that is a survey of those call sites, not a proof that the whole write path is O(n). The no-op figure above remains the **no-op** figure: it is not the cost of a write that changes many nodes. Evidence: `tests/plugins/script-semantics.test.ts`, `tests/mcp/bridge.test.ts`, `tests/mcp/write-churn.test.ts` |

---

## Shipped — what is verified today

| Area | Verified behaviour | Evidence |
| --- | --- | --- |
| Shell & layout | rail 56px, panels 240px, white 14px floating toolbar, canvas `#e5e5e5`, 24px controls | `b9-layout`, `b10-fidelity`, parity diff 11/11 |
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
  a 64-gon. The outline is therefore an approximation of the true intersection,
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
- **There is no right-click context menu anywhere in the app**, so "Use as mask"
  is reachable only from the layer-row action and the Cmd/Ctrl+Alt+M shortcut.
- **A mask has no visual marker of its own**: there is no mask badge beside the
  layer name and no dashed mask outline on the canvas, so a mask is identified by
  its effect rather than by an indicator.
- **Hosted MCP runs through the relay.** Decision (2026-10-03, reversing the
  earlier one): getpigma.com offers a **fully working MCP endpoint** served by the
  relay, so Claude/ChatGPT can drive Pigma with no download. The server executes
  the tools over the bridge, so it necessarily **sees tool calls** — accepted,
  under a hard policy that the relay **logs nothing and stores nothing** of MCP
  traffic (aggregate counters only, never payloads). The desktop app (loopback
  `http://127.0.0.1:<port>/mcp`) and a self-hosted server remain available for
  users who want the endpoint on their own machine; `stdio` stays an optional
  extra transport in the same binary.
- **Relay-only transport; P2P deferred.** Collaboration goes through a relay
  server; there is no direct peer-to-peer path.
- **No server-side document storage.** Documents live in the browser
  (`localStorage`, IndexedDB) or in a file the user picks; the relay stores room
  snapshots only.
- **No accounts.** Nicknames are labels, not identities — the panel says so.

## Open QA items

**No failing specs.** The suite is green: `CI=true npm run test:browser` = **247
passed / 0 failed**, measured twice back-to-back, with **0 orphan processes**;
`npx vitest run` = **973 passing / 102 files**, deterministic whether or not
`dist/` has been built. Every item previously listed here
(B29c, B29d, B31b, B31c, B33a, B33b, B28b) now passes and has been removed.

One unit run recorded `1 failed | 787 passed` immediately after two heavy browser
runs; the failing test's name was not captured and it has not reproduced in 7
subsequent or prior runs of the same tree. Files that spawn processes are the
likely sensitivity - the same load effect seen in the browser intermittency.

Coverage added since: PWA offline reload (`b37-pwa-offline`), the line tool
(`b36-shapes`), polygon and star creation and editing (`b40`/`b41`), a committed
screenshot baseline diff (`b39-pixel-diff`) and the italic face round trip on
both import paths (`b42-figma-italic-roundtrip`), which now pass end to end.

What follows is *coverage* still missing, not failures:


- **Hosted infrastructure is not exercised.** Browser specs run against the dev
  server and a **local** relay started by the fixture. The hosted relay at
  getpigma.com and the desktop shell's `desktop_info` are out of reach, so the
  hosted collaboration path is unverified.
- **The MCP `desktop` state cannot be reached.** It depends on the Tauri shell's
  `desktop_info`, which no browser spec can drive, so the published tool count
  for that state is not verified here.
- **File System Access** — the menu entries are asserted (`b25-round11` `B25c`);
  the OS file-picker round trip cannot be driven headlessly.
- **Figma pixel parity** is not an image diff against Figma's screenshots (which
  cannot be committed). `scripts/parity-spec.mjs` compares measured values
  against Figma's *documented* numbers (11/11, zero deltas) and `b39-pixel-diff`
  catches regressions against the app's own committed baseline.



- **`.fig` round-trip lossiness beyond the pinned rows** — float32 geometry
  precision and path-data command survival are now test-backed (`b43`); a
  **colour** through a whole `.fig` archive is still documented-from-code, because
  serialising one needs a real `.fig` schema and compressors. Every row of
  [FIGMA_COMPAT.md](FIGMA_COMPAT.md) now carries an explicit
  `test-backed:`/`documented-from-code:` evidence entry.
