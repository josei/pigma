# The online copy (GitHub Pages)

The static online copy is built from this repository and published to GitHub Pages.
It has two pages:

| Page | Path | What it is |
| --- | --- | --- |
| Landing | `/pigma/` | A static page with the call to action and the honest limits. |
| Editor | `/pigma/app/` | The full editor, running entirely in the browser. |

Your work is saved in the browser (IndexedDB and localStorage). Export a file to keep a
copy or to move it.

## What works, and what degrades

The online copy runs no server, so two features need one. They degrade to a note
instead of failing:

- **Shared rooms** (live collaboration) need a relay. The rooms panel says so and
  disables joining. Joining still works when you type the address of a relay you run.
- **The AI agent** (MCP) needs a Pigma server: the desktop app, or a server you run.
  The panel says so and offers no connection.

Both states are tested: the MCP panel's unavailable state (`b34-mcp-gating`), and the
landing page's explanation (`b98-landing`).

## Publishing

`.github/workflows/pages.yml` publishes on every push to `main`:

1. `npm run build:pages` builds the landing page and the editor with the static flag
   (`VITE_PIGMA_STATIC=1`) and the project base path (`/pigma/`), and writes the
   desktop update manifest.
2. The workflow uploads `dist/` as a Pages artifact and deploys it with
   `actions/deploy-pages`. No branch is written.

One-time setup in the repository settings: **Settings → Pages → Build and deployment →
Source: GitHub Actions**. After that, every push to `main` goes live. The default token
cannot make this choice, so it is the one manual step.

To build it locally and preview it at the same base path:

```sh
npm run build:pages
npx vite preview --base /pigma/
```

Then open `http://127.0.0.1:4173/pigma/`.

## Other paths

A fork that is published at another path builds with `PIGMA_BASE=/<path>/`. The base is
read by Vite, and the service worker and manifest follow it.
