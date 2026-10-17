# Pigma UX review

Goal: **a simple, open-source Figma.** This review judges the product as a tool a
designer would pick up, from a hands-on pass through the running app on
2026-10-06 (empty file, drawing, text, selection, every rail tab, the main menu,
the context menu, the MCP and Rooms panels). It is a worklist, not a verdict:
each item is either **Fixed** (with the commit), or **Open** (with why).

What was **not** exercised in this pass: real-world `.fig` import fidelity,
large-document performance, text editing edge cases, touch, and any browser
other than Chromium. Nothing below should be read as a claim about those.

## What already works as a Figma alternative

- The core loop is familiar and fast: tools in a bottom toolbar, a layers
  tree, a right-hand Design / Prototype / Inspect panel, rulers, zoom, context
  menu, undo, components, auto layout, variables, export. A Figma user finds
  every landmark where they expect it.
- The properties panel is dense in the right way for a selected frame:
  position, appearance, constraints, auto layout, alignment.
- Empty states tell you what to do ("Nothing on this page yet - draw a frame
  with F").
- Everything is local-first and file-based, which is the real argument for an
  open-source alternative.

## Where it fell short of "simple"

| # | Finding | Status |
| --- | --- | --- |
| 1 | The zoom/rulers readout sat on top of the top ruler | **Fixed** (`.canvas__hud--rulers`, spec B60a) |
| 2 | The vertical ruler's labels were clipped ("00") | **Fixed** (labels rotated like Figma's) |
| 3 | The main menu was 30 unstyled default buttons in one column | **Fixed**: grouped (File / Import / Open & save / Share / Export / View / Tools), styled, scrollable, anchored to the button (spec B60b) |
| 4 | MCP: endpoint, token, harness, relay URL and relay token all visible, and tokens expired after 30 minutes | **Fixed**: one flow (pick tool -> Copy setup -> Connect, a token is fetched automatically), everything else under a collapsed **Advanced**; tokens now never expire and stay revocable (`DELETE /mcp/token`) |
| 5 | Rooms: key, token, "join in plaintext", relay URL all visible | **Fixed**: nickname + room + Join/Share; the rest under **Advanced** |
| 6 | The "Tools" rail tab repeated the bottom toolbar, and the File tab repeated the main menu | **Fixed**: the rail tab is now **AI agent**; the duplicates are gone |
| 7 | "Opacity var / Fill var / Stroke var -> No variables" rows on every selection | **Fixed**: shown only when a variable exists or is bound |
| 8 | Header read "1 nodes" and counted pages as nodes | **Fixed**: "N layers", pages excluded |
| 9 | The Pages list was repeated at the top of every rail tab | **Fixed**: only on File and Layers |
| 10 | The context menu stretched to a tall empty box (a regression from #3, caught by the tour, now pinned by B60c) | **Fixed** |
| 11 | Comments used the same hamburger glyph as the main menu | **Fixed** (speech bubble) |
| 12 | Auto layout "Column" clipped in its segmented control | **Fixed** |
| 13 | Assets led with Libraries ("not published / Publish") rather than components | **Fixed**: components first, libraries last |

## Open

- **Shell parity is unmeasured against Figma (done by proxy).** The parity diff compares our own
  constants, so pixel parity is not claimed. See `docs/DECISIONS.md`.
- **No outside user yet.** The biggest product risk is untested assumptions. The next
  useful artifact is one designer finishing a real task and a written list of where
  they stalled.
- **Other engines.** Firefox passes the suite (343, 5 clipboard specs skipped), run
  with `PIGMA_FIREFOX=1`. WebKit passes 342 with 6 skipped (5 clipboard specs and the
  offline reload, which Playwright's WebKit build cannot run), run with `PIGMA_WEBKIT=1`.
- **Hosted deployment (owner decision).** The domain is `pigma.design` and resolves, but nothing is
  deployed behind it. Publishing is outward-facing, so it waits for the owner's go-ahead; the
  hosted mode is built and tested. See `docs/DECISIONS.md`.

## Resolved

- A vector with several contours (a glyph's counters, a compound shape, a boolean result with a
  hole) was read as one contour, so holes filled in and separate pieces joined. Each subpath is a
  contour now, and contours combine even-odd, so a counter is a hole (boolean-geometry.test.ts).
  This made flattened text garbled before the fix.
- Text outlines: bold text is outlined in Inter Bold, and underline and strikethrough are drawn
  (textOutline.test.ts). Flatten refuses text outside Inter, or with characters Inter lacks, and
  names the cause instead of drawing a different face (B81a, textOutline.test.ts).
- Flatten a frame with text: text is outlined (Inter Regular or Bold, `textOutline.ts`) and joins the
  union like any shape, so a frame of text and shapes becomes one path (flatten.test.ts,
  textOutline.test.ts, B80a). Groups and lines inside a frame are still refused.
- Layer order with several layers selected: bringing them to the front or forward reversed or
  reshuffled them. A selection now keeps its own order, and steps past unselected layers only
  (ops.test.ts, B79a). The bracket shortcuts also match by key position, so Shift does not break them (B79c).
- A flattened layer stayed a live boolean, so it re-evaluated from its operands. Flatten now makes
  it a static vector: its outline stays put (flatten.test.ts, B74a–d).
- Flatten a frame: Ctrl/Cmd+E turns a frame of shapes into one path, clipped to the frame and
  given its paint and name (B74d; unit tests in flatten.test.ts).
- A boolean inside an offset frame or group landed twice as far from its parent: the result's
  position was in world space inside a local parent. It is localised now (boolean.test.ts).
- A draft comment stayed on screen after switching pages, and would have been posted to the
  new page. Changing page drops the draft (B78d).
- Placing a comment created a thread at once, with the placeholder "New comment" as its text.
  Placing one now opens a composer with a draft pin; the thread exists only once it has text
  and is posted. Cancel leaves nothing (B78a–c).
- Plugin names were cut mid-word, which hid the "built-in" tag on two of the three built-ins.
  They wrap now (B77a).
- Left-panel tooltips were centred on their row, so a long one ran over the rail and was clipped.
  They start at the panel's edge and wrap (B76a).
- Flatten a group of shapes: Ctrl/Cmd+E unions its children, and one undo brings the group back (B74c).
- Radial gradients had no canvas handles. Centre, right and bottom handles now move the
  centre and set the radii (B75b).
- Gradient ends could only be set from the panel. A linear gradient's two ends are handles on
  the canvas now, and dragging one moves it (B75a).
- Flaky Firefox spec (B30f): it waited on fixed delays. It now waits on the conditions it
  checks. The earlier unidentified Firefox flake was not reproduced in two clean runs.
- Flatten (Ctrl/Cmd+E) for two or more shapes: they merge into one path (B74a–b).
- A radial gradient's centre and size could not be set. Centre X/Y and Width/Height are
  fields now (B73d).
- Gradient angle and stop positions could not be set (the previous round's gap). The Angle
  field turns a linear gradient about the box's centre; each stop has a position (B73c).
- A gradient row overflowed the panel: its summary text pushed the opacity field out. The
  Fill type select names the gradient, so the summary is gone.
- Gradient fills could not be made or edited: only imported ones showed, as a summary. A fill or
  stroke can be Solid, Linear or Radial now, with a colour per stop (B73a–b).
- Inspect: the "Ready for development" button and the copy buttons were clipped in the
  two-column grid, and the "Code" header was truncated. They stack now, and the header keeps
  its width (B72a, which fails on the old layout).
- Tooltips in the right panel were centred above their button: at the window edge they ran
  out of the window, and near the top of the scrolling panel the header clipped them. They
  open below the button, from its right edge (B71a).
- Renaming a page: the name was not selected on rename, so typing appended to it. It is
  selected now, as for layers (B70a).
- No plaintext rooms: the "Join in plaintext" option is gone. The relay refuses any
  join that is not end-to-end encrypted (`plaintext-refused`), and the client refuses a
  join without a key. Decided by the owner.
- Export PNG 1x/2x/3x duplicated the main-menu entry: the scale now lives in the
  Export PNG dialog only.
- Disabled controls with nothing to act on: alignment, boolean, size limits, effects
  and layout-grid add rows now appear only when usable, or fold away until used.
- Layout grid rows had no heading: the add row is labelled "Add a layout grid".
- MCP was hard to find: the main menu has "Connect AI agent…".
- Segmented controls in a labelled row started at different x positions: rows that
  hold a segmented control now share one label column (B63a).
