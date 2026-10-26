# Pigma 🐷

### The design tool your AI agent can actually edit.

Pigma is an open-source design editor that runs in your browser and speaks MCP. Point an agent at the document you have open and it reads the
real layer tree, makes real edits, and you watch them land — then Cmd+Z anything
you disagree with. The file stays on your machine. There is no account.

**[Open the editor →](https://josei.github.io/pigma/app/)** — nothing to install.

## Why Pigma

- **An agent writes to your live document.** Pigma serves an MCP tool catalog
  (`get_design_context`, `get_metadata`, `get_screenshot`, `use_pigma`, …) over a
  browser bridge, so any MCP client drives the editor open in front of you: create,
  move, restyle, undo.
- **No account, no cloud, no seat.** Open the link and draw. Documents are local
  files; `.fig` import and export are there for when you need to move.
- **Open source.** MIT licensed; the editor runs offline.

**The agent needs a Pigma server.** The hosted link above is a static build, so
sharing rooms and the agent bridge show a note there instead. Run `npm run relay`
or use the desktop app to get them.
Locally, `npm run dev` serves the landing page at `/` and the editor at `/app/`.

Pigma is an independent project. It is **not affiliated with, endorsed by, or
sponsored by Figma**.

---

## Status: working editor, verified features

Pigma runs. The core editor is browser-verified, and the surface has grown well
past drawing:

- Canvas, tools (rect/ellipse/frame/text/line/section/pen), selection,
  move/resize/flip, smart snapping, min/max sizing, pages, undo/redo
- Ruler guides on the page and on frames (drag from the rulers, snap to them, Delete or right-click to remove), select all
  matching (Cmd/Ctrl+Alt+A), Shift-range selection in the layers panel, corner smoothing
- Links on part of a text layer (Cmd/Ctrl+Shift+U in the editor), drawn and exported
  to SVG, PNG and PDF, and written to `.fig` as hyperlink boxes (read back to the same words)
- Properties incl. text depth and effects; auto layout with wrap, line gap and
  counter alignment; booleans; styles and variables; components and variants
- Figma import (`.fig` + REST), JSON/SVG interchange, PNG 1x/2x/3x and PDF
  export, selection-scoped export, per-layer PNG/SVG exports with suffixes (Figma's
  Export section), Copy as SVG/PNG/CSS (selection-scoped)
- Dev Mode inspect with CSS/React codegen; in-app plugins; dark theme
- MCP bridge (connect, resilience, remote edit + undo round trip) and
  collaboration presence (cursors, follow)

Evidence: the unit, browser and Rust suites (see below).


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
| `npm run test:browser` | the browser suite (Playwright, Chromium); `PIGMA_FIREFOX=1 npx playwright test --project=firefox` runs it on Firefox |
| `npm run test:browser:install` | install Chromium once, before the first browser run |
| `npm run mcp` | the MCP server over stdio |
| `npm run relay` | the collaboration / MCP relay server |

Current evidence comes from the suites: `npx vitest run` (unit), `npm run test:browser`
(Chromium), and `cargo test` in `src-tauri` (Rust).

## Desktop app

The desktop app is a Tauri shell in `src-tauri/`. The packaged app runs the editor with its MCP and relay servers on loopback, so it works offline.

GitHub Actions builds it for Linux, macOS and Windows (`.github/workflows/desktop.yml`). The workflow runs when the shell or its scripts change on `main`, and on demand from the Actions tab. Each platform uploads its bundles as an artifact. Builds are unsigned for now.

To build locally, run `npm ci`, then `npx @tauri-apps/cli@2 build`. You need Rust and the system libraries that Tauri lists for your platform.

## License

MIT. See [`LICENSE`](LICENSE).
