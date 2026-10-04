# Browser QA

Browser-level QA for Pigma. This directory is owned by the QA track.

## Running

```
npm run test:browser
```

The Playwright config lives at the **repository root** (`playwright.config.ts`)
and starts the Vite dev server itself. `tests/browser/relay.ts` starts a relay
per worker (free ports, random token, killed on teardown), so the MCP bridge
tests run with no external setup.

Two environment quirks in this workspace:

- `vite.config.ts` sets `server.port` but not `server.host`, so Vite binds
  `localhost` -> `[::1]`, while the config probes `127.0.0.1`. Start the dev
  server with `--host 127.0.0.1`, or add `host: '127.0.0.1'` to `vite.config.ts`.
- `CI` is set, so `reuseExistingServer: !process.env.CI` is false and a server
  already on 5173 aborts the run. Invoke as `CI= npm run test:browser`.

Browsers live out-of-tree (the built-in tooling cannot install Chromium here):

```
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers npx playwright test
```

## What is covered

| File | Area |
| --- | --- |
| `b0-smoke.spec.ts` | App boots, `#root` renders, no page errors |
| `b1-drawing.spec.ts` | Rect / ellipse / frame / text; Escape; no drag-less node |
| `b2-selection.spec.ts` | Click, Escape, empty-click deselect, shift-click, marquee, layer row |
| `b3-manipulation.spec.ts` | Free drag (Ctrl bypasses snapping), smart snapping + guides, NW resize, min size, arrow nudge |
| `b4-history.spec.ts` | Undo/redo across draw and move, ordering, no-op at history start |
| `b5-properties.spec.ts` | W edit, fill repaint, opacity, rename, selection-scoped panel |
| `b6-pages.spec.ts` | Add / delete pages, per-page isolation |
| `b7-persistence.spec.ts` | Local persistence, reload, geometry, pages |
| `b8-interchange.spec.ts` | Export JSON round-trip, Export SVG content |
| `b9-layout.spec.ts` | Shell order, rail/panel widths, toolbar chrome, active tool |
| `b10-fidelity.spec.ts` | 24px fields, no control overlap, no panel overflow, stacked header, single Layers header, real keyboard typing |
| `b11-figma-import.spec.ts` | `.fig` / REST JSON imports, gradients, unsupported-feature report |
| `b12-components.spec.ts` | Create component, Assets list, instantiate, instance overrides |
| `b13-autolayout.spec.ts` | Row/Column reflow, layout fields |
| `b14-presentation.spec.ts` | Fallback view, start frame stage, On-click hotspot |
| `b15-canvas-coords.spec.ts` | Real pointer input at zoom/pan; offscreen geometry |
| `b16-mcp-bridge.spec.ts` | Bridge panel, connect/disconnect, error surfaces, client name |
| `b17-mcp-resilience.spec.ts` | Relay must survive commands that succeed, arrive with no editor, and race a disconnect |
| `b19-features.spec.ts` | Section tool, image placement, flip H/V, drop shadow, layer blur, constraints, PNG 1x/2x/3x scaling, PDF export |
| `b20-vector-styles-variables.spec.ts` | Pen tool, boolean Union/Subtract/Intersect/Exclude, style creation, variable collections and binding |
| `b21-prototype-inspect.spec.ts` | Copy as SVG/CSS, Inspect (Dev Mode) measurements + codegen, prototype triggers/flows, interaction hotspot, variant set, overlay action |
| `b22-round8.spec.ts` | Min/max size clamping (field + handle, anchored edge) and persistence; text family/size/letter-spacing/case/decoration/auto-resize as rendered; image scale mode, Replace, corner radius |
| `b23-round9.spec.ts` | Auto-layout Wrap (packing, line gap, per-line alignment); Export selection as SVG/PNG and Copy as PNG |
| `b24-plugins-theme.spec.ts` | Plugins panel run + history behaviour; Toggle dark theme |
| `b25-round11.spec.ts` | Constraints options icon-only with no overflow; document library + IndexedDB persistence; File System Access entries |
| `b26-round12.spec.ts` | MCP panel masked token, Copy harness config per harness, copy affordances, Rooms join control (state-aware since the three-state gating decision) |
| `b34-mcp-gating.spec.ts` | MCP panel gating: hosted offers no connect UI and points at the desktop app; a configured endpoint surfaces the endpoint and connect UI |
| `b35-share-link.spec.ts` | Share links (`#open=<url>`): served document loads, network/CORS failure errors, non-Pigma payload rejected, local document not clobbered |
| `b27-storage.spec.ts` | Storage crash marker: no spurious "Recovered" toast; legacy-key migration into the library; stale marker vs newer work |
| `b28-rooms.spec.ts` | Two-context ROOMS: join with different nicknames, remote cursor label, remote selection outline, follow mode + Esc |
| `b29-mobile.spec.ts` | Phone viewport 390x844: no horizontal scroll, canvas keeps width, panel drawer, 44px touch targets |
| `b30-comments-versions.spec.ts` | Comments (pin, reply, resolve, persist) and version history (save, restore) |
| `b31-libraries.spec.ts` | Library publish status; instance insertion; master edit + republish vs an out-of-date instance |
| `b32-conflict.spec.ts` | Relay conflict resolution: different nodes both survive; same node converges |
| `b33-animate-scroll.spec.ts` | Frame scrolling in presentation; smart-animate interpolation |

## Known defects (tracked)

Both previously reported defects are RESOLVED and re-verified: Intersect now
merges two genuinely overlapping shapes (B20e passes), and a rectangle drawn
with a drag that starts inside an existing shape now creates its own node (two
overlapping draws give two rows).

### Intermittency (resolved)

An earlier run showed `B15c` flaky and `B14c` timing out in `selectOption`. The
`B14c` race was fixed by waiting for the destination option to exist before
selecting it; the remaining intermittency was **concurrent load, not a product
defect**, and has not reproduced since.

### Resolved this round

- `b21` **B21c** now CLICKS the Inspect code controls (`Show CSS` / `Show React`)
  and asserts the CSS and React outputs, rather than only asserting rendered
  text. The controls were previously 0x0 because the hover-hidden
  `.layer-row__actions` rule was unscoped; the editor's fix scopes it to
  `.layer-row`, and the controls now measure 34x20 with a visible parent.
- `b21` **B21h** is green, with a strengthened assertion: opening an overlay
  leaves BOTH the source and destination frame names in the presentation, which
  distinguishes a genuine overlay (stacks) from an accidental navigation.
- `b21` **B21a/B21b** clipboard flakiness is fixed by polling the clipboard until
  the content matches, with the permission granted for the app origin.

Current state: **255 browser tests passing / 0 failing**, measured twice
back-to-back (exit 0 both runs) with **0 orphan processes**. `npx vitest run` =
1038 passing across 111 files.

### Round 12 - what is and is not covered

- `b27` **B27a** PASSES: a clean boot shows no "Recovered" toast.
- `b27` **B27b** is RED: seeding the legacy `pigma:document:v1` key DOES create the
  `pigma` library database with at least one record, but the OPEN document is
  "Pigma Starter", not the seeded one. Either migration imports without opening
  it, or my hand-rolled legacy document shape was rejected and the starter was
  loaded instead. Unresolved.
- `b27` **B27c** is RED on the layer-count assertion.
- ROOMS is NOT covered beyond B26d's join-control presence. Two contexts joining
  with different nicknames, the remote cursor label, the remote selection
  outline, follow mode and Esc-stop are NOT authored or verified.

### ROOMS two-context spec — AUTHORED, currently SKIPPING

`b28-rooms.spec.ts` (4 specs) is written and typechecks. It **skips** right now
because the collab relay has no CLI entry, and `tests/browser/rooms.ts` decides
that by looking for a package.json script matching `/relay|collab|rooms/`:

- found -> it starts that script on a free port and the specs run;
- not found -> every ROOMS test skips with the reason, so the suite stays green.

Override with `PIGMA_ROOMS_RELAY_SCRIPT=<script>`. Current behaviour on the
frozen tree: `4 skipped`.

The relay CLI now exists (`npm run relay`), so the fixture self-activated. Real
markup inspected with a two-context script, and B28b tightened to it.

REMOTE CURSOR (inside `.canvas__overlay`):

    <g transform="translate(447 450)" style="pointer-events: all; cursor: pointer;">
      <path d="M 0 0 L 0 14 L 4.48 10.36 L 7.28 7.28 Z" fill="hsl(64, 65%, 55%)" stroke="#ffffff" stroke-width="1"/>
      <text ... fill="#ffffff" stroke="hsl(64, 65%, 55%)">bob</text>
    </g>

B28b now asserts `.canvas__overlay text` with the nickname, its exact text, that
the enclosing `g` holds a cursor `path`, and that the `g` carries a `translate()`
transform - not a text-presence guess.

STATUS: B28a PASSES (two contexts join, each sees `[aria-label="Peer <nickname>"]`,
no "Rooms error"). B28b PASSES but is FLAKY (timed out once at 30s, passed on
retry). B28d PASSES (Follow changes the viewBox, promotes to `Stop following`, and
Esc reverts).

B28c PASSES (re-verified by the coordinator after the editor's join-time document
adoption fix; b28 is 4/4). My earlier "RED" entry was a STALE result recorded
from a run I had not repeated that round - corrected here.

### ROOMS discovery (ran the script first, as agreed)

Control surface, printed from the live app (`/tmp/rooms-discovery.mjs`):

    Nickname    input[aria-label="Room nickname"]
    Room        input[aria-label="Room id"]      placeholder "studio"
    Token       input[aria-label="Room token"]   placeholder "optional"
    Key         (share-link key; encrypted rooms only)
    Relay base  input[aria-label="Relay base"]   default wss://getpigma.com/relay
    Join        button[aria-label="Join room"]
    Join in plaintext  checkbox - required to enter a room without a share key

Joining with an unreachable relay puts the panel in `Rooms error / Mode: Not
connected`, so the flow is drivable and observable. URL/hash are untouched by a
join attempt (no `location.hash` change).

BLOCKER, unchanged: `src/collab/server.ts` exposes `createCollabServer(...)`
with `.listen(port, host)` but has **no CLI entry** (no npm script), so a local
relay needs a purpose-built runner, plus a two-context fixture. That is the piece
still missing - the discovery above is the groundwork, the spec is not written.

## Resolved (round-11 build)

- `b23` **B23d** PASSES. Two causes, both spec-side: the children were all the
  same height, and they wrapped ONE PER LINE, so per-line counter alignment had
  nothing to move. They are now 40/80/40 tall and the frame is wide enough for
  two per line.
- `b24` **B24a** is RED and UNRESOLVED. The coordinator root-caused one real bug
  in my spec - the Plugins panel REUSES `.layer-row__name` for its own rows, so a
  broad read while that tab is active returns PLUGIN names. The spec now switches
  to the Layers tab and reads `.app__left .layer-row__name`, uses the
  plugin-scoped `.app__left [aria-label^="Run "]`, and asserts before /
  afterRun / afterUndo so it cannot pass vacuously. It still fails: after one
  Ctrl+Z the layer name is not restored in this harness, while the coordinator
  measured the same plugin restoring it. Remaining difference to check: the spec
  switches rail tabs programmatically before every read, which the manual
  measurement did not do - that tab switch is the only uneliminated variable.

- `b23` is 8/8 and `b24` is 1/2 on the round-11 build (B24a red, above).

### Open question

`b25` **B25b** finds the File panel offering `new document | open file | save to
file | add page | delete page | save version` - NO rename or duplicate. Either
they live per-row once a document exists, or the library lacks them. Not
asserted, recorded here.

### Not yet authored

PWA offline reload. At boot `navigator.serviceWorker.getRegistrations()` is
empty against the dev server, so an offline-reload assertion needs the built
app served via preview, not `vite dev`.

## Observations while authoring b22

- The `Letter` field is a PERCENTAGE of the font size (6 at 14px renders
  `letter-spacing="0.84"`), not an absolute px value.
- `Case`, `Decorate`, `Auto size` and `Style` are segmented button groups
  labelled with glyphs (`Aa`/`AA`, `U̲`, `Auto`/`Height`, `Reg`/`Italic`), not
  `<select>` elements. `Font family` and `Image scale mode` are selects.
- Switching Auto size between its modes did not change the box for a text node
  whose box already fitted, so b22i verifies auto-resize the way it actually
  manifests: with the box in hug mode, changing the font size grows the box.

## Mobile layout (b29)

At 390x844 (`hasTouch`, `isMobile`):

- **B29a PASSES** no horizontal scroll (`scrollWidth === innerWidth === 390`).
- **B29b PASSES** the canvas keeps real width (334px).
- **B29c is RED**: the drawer close/reopen assertion times out (30s). The panel is
  open by default at 300px with a `Close panel` control present, so this needs a
  look at how closing is signalled.
- **B29d FAILS with real evidence**: **20 controls are below the 44px touch
  target**, minimum **32x24** - e.g. `Close panel`, `Add page`, `Delete page`,
  `Toggle rulers`, `Toggle pixel grid`, `Zoom out`, `Zoom in` all 32x32. This is a
  genuine mobile finding, not a spec bug: the requirement is 44px.

### Round 12 remainder (b31-b33)

- `b30` **B30b/B30c now PASS** after the editor gave Resolve/Reply visible words,
  and **B30f PASSES** with the strong assertion after scoping the control to
  `button[aria-label="Restore v1"]` - the timeline gives every snapshot its own
  labelled controls, so `.first()` had been targeting v2.
- `b31` **B31a PASSES** publishing changes the Assets panel status away from
  "not published".
- `b32` **B32a PASSES** two contexts editing DIFFERENT nodes both survive (each
  side converges to the same shape count); **B32b PASSES** edits to the SAME node
  converge to one value on both sides.
- `b31` **B31b/B31c RED**: the instance is not inserted from the published
  library row (`.layer-row` count unchanged) and no update affordance appears for
  an out-of-date instance. Likely my flow - the asset row moves under the
  published library - not established as a product defect.
- `b33` **B33a RED**: measured in presentation, `.present__frame` has
  `scrollHeight === clientHeight` (200/200) and `overflowY: hidden`, so the frame
  is not scrollable even with `Frame scrolling = Vertical`. Either the child was
  not parented into the frame or the scrolling setting is not applied.
- `b33` **B33b RED**: no interpolated sample was observed between the start and
  end positions.

### Triage of the five reds

| Test | Verdict | Evidence |
| --- | --- | --- |
| **B34a** | **MY PREMISE WAS WRONG** | Asserted the dev build offers no connect UI, but the dev server advertises a loopback MCP endpoint on purpose - which is what keeps b16/b17/b18/b26 green. Rewritten to control the advertisement explicitly via `page.route('**/config.json')`: 404 => `data-mcp-state="hosted"`. PASSES. |
| **B34b** | **SPEC (passing for the wrong reason)** | The always-on panel satisfied "endpoint + connect UI", proving nothing. Now stubs a real self-hosted advertisement (`{mode:'server', mcp:{enabled,url,tokenRequired}}`) and asserts `data-mcp-state="self-hosted"`, the endpoint text and the token field. PASSES genuinely. |
| **B31b** | **SPEC** | The instance WAS created - verified in the store: `INSTANCE:Rectangle 1`. `.layer-row` count is an unstable proxy (auto-expand, nested instance). Rewritten to assert an `INSTANCE` node in the document. PASSES. |
| **B31c** | **SPEC, then a REAL GAP** | Spec bug: after the first publish the control is relabelled `Republish library`, so the second `Publish library` click never resolved (30s timeout). With that fixed the spec runs to completion and finds **no update/out-of-date affordance anywhere in the app** - the full control dump contains `Republish library` and `Remove library` but nothing to update an out-of-date instance. |
| **B33a** | **REAL GAP (candidate)** | Verified in the store that the rectangle IS a child of the frame, and `Frame scrolling = Vertical` is set, yet measured in presentation `.present__frame` has `scrollHeight === clientHeight` (200/200) and `overflowY: hidden` - no scrollable surface. |
| **B33b** | **FIXED** | The missing piece was the READER: an animating layer carries a CSS transform (`style="transform: matrix(1,0,0,1,x,y)"`) and its SVG `transform` ATTRIBUTE is null, so a `g[transform]` selector dropped exactly the moving node. Now reads `getComputedStyle(g).transform` with NO attribute filter. Measured start [0,20] -> end [0,140] with 35 intermediate samples; the original assertion passes unchanged. (Also: an earlier full-suite failure was my own dropped null guard, not the product.) |
| ~~B33b~~ old entry | **SUPERSEDED** | Both spec bugs the coordinator identified are fixed: the reader now parses `matrix(1, 0, 0, 1, tx, ty)` (it was matching only `translate(...)`, so every sample was `[]`), and both rectangles are renamed to the same name `Mover` because smart animate pairs by exact name. Layer ORDER was a third bug: rows are top-most first (`["Frame 2","Mover","Frame 1","Mover"]`), so `.first()` selected the DESTINATION's rectangle; the spec now takes the Mover row following the source frame. With those fixed the reader returns real values and navigation is observable - `start=[330,20] end=[330,150]` - but NO intermediate sample is seen (`samples=[[330],[330],[330],...]`). Switching the reader to `getBoundingClientRect` showed `[350]` unchanged end to end. So the animated position is carried somewhere this spec does not read. NOT tuned toward green; left red. |

Also corrected: **B34c** asserted an advertised loopback should be `data-mcp-state="desktop"`. That is wrong - `desktop` is reserved for the Tauri shell reporting `desktop_info`; the advertised branch always yields `self-hosted` (resolveMcpAvailability). B34c now asserts the real semantics, including the "(this machine)" label.

#### Comments and version history (b30)

- **B30a PASSES** the Comment tool places a pin and the panel counts it (0 -> 1 open).
- **B30b PASSES** (re-checked after the editor gave Resolve/Reply/Restore visible
  words): the reply composer resolves - `.app__left textarea` - and the reply is
  posted without bubbling to the thread row.
- **B30c PASSES** (re-checked): the Resolve control now carries its word, so
  `.app__left button:has-text(resolve)` resolves and the open count drops to 0.
- **B30d PASSES** comments persist across a reload (reload without `?blank=1`).
- **B30e PASSES** saving a named version adds it to the snapshot timeline.
- **B30f is RED, and the tightening is what exposed it.** The old spec branched on
  whether restoring changed anything, so its pass was ambiguous. It now guarantees
  a visible change: draw a shape, save `v1`, delete the shape, save `v2`, restore
  `v1`, then require one `Ctrl+Z` to empty the canvas again. It fails at
  "restoring did not bring the shape back" (0 shapes after restore).
  Most likely MY bug: the spec creates two versions and `.app__left button
  :has-text(restore)`.first() may target the wrong snapshot's control. Needs the
  timeline's per-row markup to scope the restore to `v1` specifically. Not claimed
  as a product defect.

Remaining uncovered: SMART ANIMATE + SCROLLING, LIBRARIES, CONFLICT RESOLUTION.

## Share links (b35) — RED: the feature is not wired

`#open=<url>` is specified in `src/share/openLink.ts` (fragment parsed with
`URLSearchParams`; absolute http(s) only; `#design=` deliberately removed because
a real design exceeds URL limits and images alone would blow it) and the store
exposes `loadLinkedDocument`. **But nothing calls them:** `readDocumentLink` and
`resolveDocumentUrl` have no callers outside their own module, `loadLinkedDocument`
has none at all, and `main.tsx` reads no hash. So a `#open=` link does nothing.

Probed directly against a local static server, in three forms (percent-encoded,
raw, encoded + `&name=`): the document stayed "Pigma Starter", with **no toast and
no console error** in every case.

All four specs are therefore RED, and they are honest about why:
`B35a` the served document does not load; `B35b` no error toast for an
unreachable link; `B35c` no rejection toast for a non-Pigma payload; `B35d` the
local document is untouched - vacuously, since nothing happens at all.

An earlier version of B35b/B35c PASSED **vacuously**: the check matched any
error-ish word anywhere in `document.body.textContent`, which a normal page
satisfies. Both now require a **toast** - the app's own error surface.

## Parity evidence

`scripts/parity-spec.mjs` measures the running app at a known scale (viewport 1440x900,
`deviceScaleFactor` 1, plus a 2x pass) and diffs the measurements against Figma's
documented UI3 values, with tolerances. Latest result: **11/11 pass, every
geometry delta 0**.

| Property | Measured | Documented | Delta | Tol |
| --- | --- | --- | --- | --- |
| nav rail width | 56px | 56px | 0 | 1px |
| left / right panel width | 240px / 240px | 240px | 0 | 1px |
| control height | 24px | 24px | 0 | 1px |
| toolbar radius | 14px | 14px | 0 | 1px |
| canvas background | `[229,229,229]` | `#e5e5e5` | 0 | 4 rgb |
| toolbar background | `[255,255,255]` | white | 0 | 4 rgb |
| rail/panel/control @2x device scale | same px | same px | 0 | 0.5px |

Geometry comes from DOM rects, colours from screenshot PIXELS (not computed
style), and the 2x pass proves the values are scale independent.

## Notes

- Tests drive the real app with real gestures; numeric fields are exercised with
  real keyboard input (B10f).
- The document opens zoom-to-fit, so scale-sensitive assertions derive the scale
  from the canvas SVG screen CTM or use ratios that cancel it out.
- MCP writes are rejected as stale unless a read happens after connecting: the
  session caches revision 0 while the editor is at revision 1. `connectEditor`
  waits for the relay to register the client, and the resilience tests read
  before they write.

## Verification baseline

`/home/jose/Code/pigma` is a git repository with a committed verified-green state
(`697d88b`). QA changes are reported against it with `git status --porcelain` and
`git diff --stat` - a real diff against a real baseline - instead of the
content/mtime comparisons used before the repo had one. Nothing QA-side commits
on its own; the coordinator decides.

## Round 25 additions

`b40-polygon-star` covers the polygon and star tools end to end: each tool
creates its own node type with the drawn geometry (`POLYGON` 3 points, `STAR` 5),
the three layer glyphs are distinct, and Escape cancels without creating a node.
`B38b` was updated to assert the FIXED export behaviour (a bold weight exports a
bold face; a between-step weight snaps to the nearest declared step) after the
defect it originally pinned was resolved.

`b41-polygon-star-editing` covers post-creation editing: the polygon Sides
control, the star Points and Inner radius controls (including clamping), the
star-only visibility of Inner radius, and the corner Radius control. The radius
originally pinning a defect (stored for polygons and stars but not rendered) now
asserts the FIX: radius 0 and radius 12 must differ for both shapes and the
rendered path must contain corner arcs, with a rectangle as the positive control.

`b42-figma-italic-roundtrip` covers the italic face round trip on both import
paths, chaining the real mapper into the real exporter. Both paths now pass:
`"Book Italic"` round-trips at 400 and `"Semi Bold Oblique"` keeps 600, natively
and through REST (including via a PostScript name). The REST half originally
pinned a defect - the face survived but the weight was never derived - which has
since been fixed, so those tests now assert the fix. A slant whose weight is
known is written as "Italic", the wire format's other name for "Oblique".

`b43-figma-float32-pathdata` tests the two rows FIGMA_COMPAT.md previously marked
documented-from-code: a high-precision coordinate through the real commands-blob
codec comes back at exactly `Math.fround` precision, `M`/`L`/`C`/`Z` survive while
`H`/`V` normalise to `lineTo`, and `S`/`Q`/`T`/`A` discard the WHOLE path's
geometry rather than one segment.

`b44-code-targets` covers the Dev Mode code targets: all four tabs are exposed,
each shows real code carrying the selection name and its measured geometry, the
copy button follows the active tab (copying Compose puts the Compose source on
the clipboard, not the CSS), and a polygon yields a "no primitive" note instead
of a fabricated shape. It also found two defects, both since fixed, so
`B44e`/`B44f` now assert the fix rather than pinning it: the tabs used to overflow
their container (190px in a 183px box, clipping Compose and refusing a normal
click) and a polygon **with a shadow** used to get a fabricated
`RectangleShape()` in Compose. `clickTab` uses a plain click again - forcing it
would hide a regression.

`b45-css-text-styling` and `b46-codegen-text-props` cover the text properties
the generators emit: the font family (SwiftUI `.custom`, CSS/React
`font-family`), letter spacing, line height and alignment in each target's own
vocabulary (`.tracking`/`letterSpacing`), with `B46c` pinning the Compose family
gap. `b47-dev-mode` covers the Dev Mode workspace (right panel switches to
Inspect, design tabs are removed, the toggle is reversible) and
`b48-dev-status-badge` covers the ready-for-development status on a frame,
including its survival across a reload.

### Flakiness under parallel workers (resolved)

Three parallel runs reported **20 / 8 / 15 flaky** tests. The failing tests varied
run to run and spanned unrelated specs, which pointed at something shared rather
than at any test's own waits. Every failure was the same:

```
Error: browserContext.close: ENOENT: no such file or directory, open
  '.../test-results/.playwright-artifacts-N/traces/....trace'
```

The test had PASSED; the context *close* failed, so Playwright retried it and
reported it as flaky. The cause was `trace: 'retain-on-failure'`, which records a
trace for every test, so many parallel workers raced on the shared artifacts
directory at teardown.

Evidence (counts below are the suite size AT THE TIME of this work; the suite has
grown since): with `--trace=off` the same parallel suite ran **217 passed / 0 flaky**
twice, and with `trace: 'on-first-retry'` **five consecutive CI runs** and **four
consecutive local runs** were 217/0 with zero `browserContext.close` errors. No
test's waits were changed and no timeout was widened.

The final setting is `trace: 'on-first-retry'` **with `retries: 1` unconditionally**
(not `CI ? 1 : 0`). A trace is only produced *by a retry*, so a local run with
`retries: 0` would write no trace for a first-attempt failure - the debuggability
this fix was meant to preserve. The alternative, `retain-on-failure` locally,
was rejected: that mode records for **every** test, which is precisely the
parallel-teardown race being fixed. Verified both ways: with CI unset a
deliberately failing spec wrote `trace.zip` under `…-retry1/`, and four
consecutive local runs stayed 217 passed / 0 flaky (that day's suite size).

`b49-image-tile` covers image scale modes on the live canvas: TILE emits a
`userSpaceOnUse` pattern sized to the bitmap, and real pixel sampling shows a
sample one and two tile periods away MATCHES while half a period away DIFFERS -
so the image genuinely repeats rather than stretching once. That closes the last
"TILE renders as cover" limitation.

`b50-live-boolean` covers the LIVE boolean: after a union, moving an operand
changes both the stored and the RENDERED outline, and the stored outline equals a
fresh `evaluateBooleanNode` recomputation of the current operands (forced by
clearing `pathData` so the function cannot echo the value already on the node);
undo restores it.

`b51-version-compare` covers the pure diff over a real version snapshot: an
unchanged document reports `No changes` (with the node count tied to the
document's own shapes so "no changes" is not "no content"), a moved layer is
CHANGED with the `position` property, an added layer is ADDED, a deleted layer is
REMOVED, and a rename is one change rather than an add/remove pair.
`b52-version-compare-ui` covers the compare state: the canvas highlights the
difference with its own kind (added/removed/changed) and the panel reports it,
while entering AND leaving compare push **no** history entry - a single undo
afterwards still reverts the move, not the comparison.

### A single-click menu open was unreliable (resolved)

The full serial suite reported `B23g` FLAKY once: `page.waitForSelector('.menu__item')`
timed out because the Main menu never opened, while the same spec passed 3/3 in
isolation. The cause was the spec's assumption that ONE click opens the menu -
the shared `openMenu` helper made the same assumption. Both now retry the
trigger until the menu items are actually visible (bounded, then a clear error),
so a swallowed click costs a retry instead of a 30s timeout. All specs that open
the menu go through `openMenu`. Result: **0 flaky** in two consecutive full runs.

`b53-mask` covers layer masks by rasterising the live canvas and sampling real
pixels: the shortcut and layer action, clipping only the siblings above, a mask
inside a FRAME (with a page-level sibling left untouched), a mask nested into a
GROUP, and the flag plus its clip surviving a reload.

`b53-mask` now covers the ALPHA mechanism directly: an opaque mask emits the
cheaper equivalent `clipPath` while a non-opaque one emits an SVG
`<mask mask-type="alpha">` declared as BOTH an attribute and an inline style
(SVG's default is luminance, which would invert dark fills), and the region
covers the mask's transformed box so an offset mask does not blank its run.

`b53-mask` also covers the two masks that are not plain shapes: a CONTAINER mask
(a frame marked as a mask must mask by its rendered content, not blank its run)
and a gradient mask carrying a paint-level `opacity` (which must take the alpha
path, not be mis-judged opaque and clipped to its outline).

### Reading the properties panel assumed it had settled (resolved)

`B20d` flaked once in a full serial run: `locator.inputValue: waiting for
locator('input[aria-label="X"]')` timed out. The `nodeGeometry` helper read the
geometry fields straight after a drag, relying on a fixed 120ms pause for the
panel to render — under load that lags. It now waits for the field to be
VISIBLE (the actual condition) before reading, which removes the assumption for
every caller. Confirmed stable 3/3 on the affected spec.

`b54-mcp-settle` proves the browser-observable side of the MCP settle fix: a text
node created through the bridge reaches the editor with its SETTLED box (the
properties panel reports 24px high for a 20px face, not the factory's 16.8), and
a boolean created by a script re-evaluates when an operand moves - both driven
over the protocol from a browser spec, no MCP client needed.

`b57-grid-autolayout` covers grid auto layout on the live canvas: switching a
frame to Grid places three children at x 16 / 156 / 16 with the third wrapping to
row 2, a column switched to FIXED 1px reflows the widths to 1 / 255 / 1, resizing
the frame resizes the fractional track, and the grid TRACK editor is asserted to
be a separate control from the layout GUIDES (adding a guide moves neither the
children nor the layout mode, and leaving the grid direction removes the track
editor while the guides stay).

`b58-component-slots` covers instance property controls from the panel: an
instance of a STANDALONE component used to lose every property control (while one
inside a component set worked) because the panel resolved definitions from
`componentSetOf(instance.componentId)` and fell back to the instance, which owns
none. `propertyOwnerOf` fixed that, so the spec now asserts the swap control is
PRESENT and that choosing a component reaches the canvas - with a negative case
(a component with no properties offers no such control) so it cannot pass
vacuously.

New specs: `b36-shapes` (line tool geometry and rendering), `b37-pwa-offline`
(service-worker registration and an offline reload against the built app served
by `vite preview`), `b38-figma-lossiness` (exercises the real export path and
pins two documented losses), `b39-pixel-diff` (screenshot-vs-committed-baseline
with a stated tolerance, plus a self-check that the diff is not blind).

The pixel diff is a REGRESSION harness; Figma parity is still
`scripts/parity-spec.mjs` against Figma's documented numbers.
