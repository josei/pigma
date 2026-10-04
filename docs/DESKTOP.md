# Pigma desktop (macOS / Tauri)

The desktop build is the **same editor** in a thin native shell. Nothing about
the product forks: the document model, the editor, the Rooms client, the plugin
sandbox and the MCP tools are the shared code in `src/`. The shell adds exactly
two deployment facts.

## What the shell adds

| Fact | Default (every build) | Alternative |
| --- | --- | --- |
| MCP endpoint | `http://127.0.0.1:3001/mcp` — served by the bundled Node server, for working fully offline (a web page cannot bind a port; the shell can). | The hosted endpoint (`https://getpigma.com/mcp`, per-session token) or a self-hosted server's advertised endpoint (`GET /config.json`). |
| Rooms relay | `wss://getpigma.com/relay` | `ws://127.0.0.1:3002/relay` — the bundled relay, so two windows on one machine can share a room; or a self-hosted relay. |

The MCP field is pre-filled from `desktop_info` (loopback) or from the
deployment's `GET /config.json` (self-host) and stays editable, remembered per
browser. Nothing connects until a room is joined or MCP is enabled.

The frontend asks for both with the `desktop_info` command; the MCP panel then
shows the endpoint, the (optional) token and the harness config exactly as it
does in every other build.

## Layout

```
src-tauri/
  tauri.conf.json     window, bundle, CSP (allows loopback HTTP + the relay)
  Cargo.toml          tauri 2 shell, no other dependencies
  src/main.rs         exposes `desktop_info`; starts nothing else
  icons/icon.svg      the same mark the web build ships
```

## Running it

```sh
npm install                     # JS side (the editor, the MCP server, the relay)
npm run build                   # produces dist/, which the shell loads
npx @tauri-apps/cli@2 dev       # or: npx @tauri-apps/cli@2 build
```

The Tauri CLI is not a dependency of this package: it is only needed to build
the desktop shell, so it is fetched on demand rather than forced on every
install (the browser build and the MCP server do not need it).

The MCP endpoint is the Node server the CLI already runs, started as a sidecar
on launch:

```sh
node --experimental-strip-types src/mcp/bin.ts --http --port 3001
```

It serves the same tool set as every other transport (see `docs/MCP.md`), writes
to the same documents, and needs no token on loopback. Hosted deployments add a
minted, short-lived, revocable token — that is a deployment choice, not a
different product.

## Asset auto-update (the shell stays on par with the web)

The shell does not ship its own copy of the editor. **One asset bundle** serves
every build — the web build already detects Tauri at runtime — and the shell
caches it, so a shell downloaded last year runs today's editor. Only the assets
move here; the shell **binary** still updates through the normal Tauri updater.

`npm run build` writes `dist/desktop-assets.json` as its last step
(`scripts/desktop-assets.mjs`), describing exactly the bytes that were built:

```json
{
  "schema": "pigma/assets/1",
  "version": "0.1.0+f35d37119e39",
  "entry": "index.html",
  "assets": { "index.html": "<sha256>", "assets/index-abc.js": "<sha256>" }
}
```

The version is the package version plus a digest of the asset set, so an
asset-only release still produces a new version and a shell never has to guess
whether it is behind. Every hash is the sha256 of the file's bytes.

**What the shell does** (`src/desktop/assets.ts` is the reference client; the
algorithm and its tests live there):

1. `GET <assets-url>/desktop-assets.json` — a failure is the offline case, not an
   error: the cached bundle stays active.
2. Compare with the pointer at `appDataDir/assets/current.json`
   (`{ version, entry, previous? }`) and fetch only the files whose hash differs.
   Unchanged assets are copied inside the cache, never re-downloaded.
3. Download into `appDataDir/assets/<version>.tmp/`, **verify every hash**, then
   `rename` the directory into `appDataDir/assets/<version>/`.
4. Swap the pointer by writing `current.json.tmp` and renaming it: the pointer is
   never half-written, so a crash mid-update leaves the previous bundle active.
5. Keep the replaced version on disk and record it as `previous`, so one
   `rollback` (and an incomplete active bundle) can fall back to it. The shell
   loads `<root>/<pointer.entry>` from the active bundle, offline included.

### The shell side (`src-tauri/src/assets.rs`)

The shell implements the same algorithm in Rust, with no dependency on the page:

- **On launch**, and on demand, it fetches the manifest. The URL defaults to
  `https://getpigma.com/desktop-assets.json` and is overridable with
  `PIGMA_ASSET_MANIFEST_URL`; the cache root is `appDataDir` and is overridable
  with `PIGMA_ASSET_CACHE`.
- **Compare, then download only what changed** into `assets/<version>.tmp/`.
  Unchanged assets are copied from the previous bundle, never re-fetched.
- **Verify every sha256** before anything is activated. A bundle that fails
  verification is deleted, the pointer does not move, and the failure is
  recorded — a tampered or truncated download never becomes the running app.
- **Atomic swap**: the staged directory is renamed into `assets/<version>/`, then
  `current.json` is written through a temporary file and renamed. A crash at any
  point leaves the previous bundle serving.
- **Rollback**: the replaced version stays on disk and is recorded as
  `previous`; `desktop_asset_check` reports it, and an incomplete active bundle
  falls back to it automatically.
- **Offline**: a failed manifest fetch is not an error — the newest cached bundle
  keeps serving, and `resolve_active_bundle` never returns a bundle whose entry
  file is missing.
- **Serving**: the window loads the active bundle through the `pigma://localhost`
  scheme, which resolves every request through the pointer and refuses any path
  that escapes the bundle. The shipped `dist/` remains the fallback when no
  bundle is cached. `tauri.conf.json`'s CSP allows that scheme.

Two commands expose it to the page and to support:

| Command | Returns |
| --- | --- |
| `desktop_asset_status` | `{ current_version, entry, cached_versions, previous_version, last_check, last_error }` |
| `desktop_asset_check(force)` | the outcome (`current` / `updated` / `rollback` / `failed`, the version, the files downloaded, any error). `force: true` ignores the 60-second re-check guard. An update reloads the window onto the new bundle. |

The Rust module carries its own unit tests (`cargo test`, in `src/assets.rs`)
covering manifest validation, path safety, hash verification, the
fresh/current/offline/rollback decisions, the atomic swap, refusal of a tampered
bundle, copy-instead-of-refetch, and the fallback when the active bundle is
incomplete. The JavaScript reference client in `src/desktop/assets.ts` is tested
by the normal test suite, and `src/desktop/manifest.contract.test.ts` checks that
the manifest `npm run build` writes is one the shell accepts.

## Local-first guarantees

- The editor never requires the shell: open `dist/index.html` (or the dev server)
  in a browser and everything except the native window chrome works.
- With no room joined, nothing connects anywhere. Rooms are opt-in and the relay
  carries presence only (nickname, cursor, selection) — never documents.
- The MCP endpoint is bound to `127.0.0.1` only. Exposing it on a network
  interface is a deliberate act (`--host`), and hosted mode requires a token.

## Not in this repository

Compiled binaries are not committed: `src-tauri/target/`, `.app` and `.dmg`
artifacts are build output. The shell builds from the config and source above.

The Rust toolchain is not part of this package either: building the shell (and
running its `cargo test` suite) needs `rustup` with the Tauri prerequisites,
while the editor, the relay and the MCP server run on Node alone. The asset
update logic therefore exists twice on purpose — the JavaScript reference client
(`src/desktop/assets.ts`, tested by `npm test`) and the shell's Rust port
(`src-tauri/src/assets.rs`, tested by `cargo test`).
