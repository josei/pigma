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

Evidence: **1069 unit tests across 117 files**, **267 browser tests passing / 0 failing**
(`CI=true npm run test:browser`), and a parity script that separates its INTERNAL
contract rows (**11/11** - Pigma's own values, not evidence about Figma) from its
EXTERNAL references (one cited structural fact, **0 pixel references**), so it
reports the 1:1 visual-parity claim as **UNSUPPORTED**. See
[`docs/ROADMAP.md`](docs/ROADMAP.md), "How the Figma matching was actually
done". See [`docs/ROADMAP.md`](docs/ROADMAP.md) for
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

Pigma runs. Everything below is a real script in `package.json`:

```bash
npm install
npm run dev          # Vite dev server; open the URL it prints
```

The editor opens on a starter document. Draw from the toolbar or with a
shortcut - `r` rectangle, `o` ellipse, `f` frame, `t` text, `l` line,
`g` polygon, `s` star, `p` pen, `v` move, `h` hand - then move, resize and edit
the selection in the right-hand panel.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b`, `vite build`, then the desktop asset manifest |
| `npm run preview` | serve the built output |
| `npm run typecheck` | `tsc -b` |
| `npm test` | the unit suite (vitest) |
| `npm run test:watch` | the unit suite in watch mode |
| `npm run test:browser` | the browser suite (Playwright, Chromium) |
| `npm run test:browser:install` | install Chromium once, before the first browser run |
| `npm run mcp` | the MCP server over stdio |
| `npm run relay` | the collaboration / MCP relay server |

Current evidence: **1069 unit tests across 117 files** and **267 browser tests
passing** - see [`docs/ROADMAP.md`](docs/ROADMAP.md) for what each milestone
proves and for the known limitations.

## License

MIT. See [`LICENSE`](LICENSE).
