# Pigma 🐷

Pigma is an open-source design editor for the browser, built with
React + TypeScript + Vite and rendering its canvas with SVG.

Its objective is a **full Figma clone**: 1:1 visual fidelity with Figma's
interface, and a document model that is compatible with Figma's.

Pigma is an independent project. It is **not affiliated with, endorsed by, or
sponsored by Figma**. "Figma compatibility" is a technical goal, not a claim of
association.

---

## Status: working editor, verified features

Pigma runs. The core editor is browser-verified, and the surface has grown well
past drawing:

- Canvas, tools (rect/ellipse/frame/text/line/section/pen), selection,
  move/resize/flip, smart snapping, min/max sizing, pages, undo/redo
- Properties incl. text depth and effects; auto layout with wrap, line gap and
  counter alignment; booleans; styles and variables; components and variants
- Figma import (`.fig` + REST), JSON/SVG interchange, PNG 1x/2x/3x and PDF
  export, selection-scoped export, Copy as SVG/CSS
- Dev Mode inspect with CSS/React codegen; in-app plugins; dark theme
- MCP bridge (connect, resilience, remote edit + undo round trip) and
  collaboration presence (cursors, follow)

Evidence: **954 unit tests across 100 files**, **246 browser tests passing / 0 failing**
(`CI=true npm run test:browser`), and a parity diff against Figma's documented UI
that passes 11/11 with zero deltas. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for
the milestone-by-milestone status, the specs that prove each claim, and the known
limitations.


## Objective

Full parity with Figma Design is the goal. That includes the areas that are
easiest to declare out of scope: components and instances, variants, auto
layout, constraints and layout grids, styles and variables, libraries,
prototyping, Dev Mode, comments, version history, plugins, and real-time
multiplayer collaboration. These are **required future milestones with unmet
acceptance criteria**, not excluded project scope.

The current milestone is deliberately limited. The overall objective is not.

## Feature areas

Targets rather than a shipped list — [`docs/ROADMAP.md`](docs/ROADMAP.md) records
what is verified today.

| Area | Target |
| --- | --- |
| Canvas | SVG viewport, pan, zoom, rulers, measurement |
| Tools | Shape, text, frame, section, pen/vector, image |
| Editing | Selection, move, resize, rotate, align, boolean ops |
| Inspection | Properties panel: geometry, fill, stroke, effects, text |
| Structure | Layers panel, grouping, frames, sections, z-order |
| Layout | Auto layout, constraints, layout grids |
| Components | Components, instances, variants, overrides |
| Design systems | Styles, variables, libraries |
| History | Undo / redo, version history |
| Data | Local persistence, Figma-compatible JSON import / export |
| Documents | Multiple pages |
| Input | Full keyboard shortcut set |
| Prototyping | Interactions, flows, presentation |
| Handoff | Dev Mode, inspection, code output |
| Collaboration | Real-time multiplayer, multiplayer cursors, comments |
| Extensibility | Plugin API, plugins |
| Export | SVG, PNG, PDF |

## Documentation

- [`docs/FORMAT.md`](docs/FORMAT.md) — the native Pigma format: `pigma/1` and the
  `pigma/persist/1` envelope, the document tree, deterministic serialization,
  validation semantics, where documents live, and the versioning policy.
- [`docs/FIGMA_COMPAT.md`](docs/FIGMA_COMPAT.md) — the `.fig` round-trip
  compatibility matrix, with the known losses stated explicitly.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — milestone status with the specs that
  prove each claim.
- [`docs/MCP.md`](docs/MCP.md) — the MCP surface.
- [`docs/UI_CONTRACT.md`](docs/UI_CONTRACT.md) — the UI class/token contract.

## Getting started

Not yet usable. `package.json` defines `npm run dev`, `build`, `preview`,
`test`, and `typecheck`, but the application entry point has not landed, so the
dev server will not render a working editor yet. Instructions will be completed
once `src/` exists and the first milestone in `docs/ROADMAP.md` is marked
shipped.

## License

MIT. See [`LICENSE`](LICENSE).
