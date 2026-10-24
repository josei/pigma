# Pigma desktop (Tauri)

The desktop app is built in GitHub Actions for macOS, Windows and Linux (`.github/workflows/desktop.yml`), and
the bundles are uploaded as artifacts. The builds are unsigned. The app starts its own MCP server and rooms relay on
loopback, as a sidecar (see "Local servers for the desktop app" below). The plan and acceptance criteria are milestone M17. Verified: `cargo test` and `cargo build` on Linux, and the packaged Linux app serves MCP and
rooms. CI runs the packaged app on all three platforms and checks its servers (run 39492897817).

The desktop build is the **same editor** in a thin native shell. Nothing about
the product forks: the document model, the editor, the Rooms client, the plugin
sandbox and the MCP tools are the shared code in `src/`. The shell adds exactly
two deployment facts.

## What the shell adds

| Fact | Default (every build) | Alternative |
| --- | --- | --- |
| MCP endpoint | `http://127.0.0.1:3001/mcp` — served by the bundled Node server, for working fully offline (a web page cannot bind a port; the shell can). | A self-hosted server's advertised endpoint, or one the user types. |
| Rooms relay | `ws://127.0.0.1:3002/relay` — the bundled relay, so two windows on one machine can share a room. | A self-hosted relay, typed in the Rooms panel. |

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
  Cargo.toml          tauri 2 shell, tauri-build, reqwest (rustls) + sha2
  build.rs            `tauri_build::build()` — without it `OUT_DIR` is unset and
                      `generate_context!()` cannot run
  src/main.rs         exposes `desktop_info`; starts nothing else
  src/assets.rs       the asset cache (below), with its own `cargo test` suite
  icons/              `icon.svg` (the mark) + the platform set derived from it

## The frontend bridge (`window.__TAURI__`)

The panel reaches the shell through the Tauri **global**: `readDesktopInfo`
(`src/config/mcpAvailability.ts`) reads `window.__TAURI__.core.invoke`. Tauri
injects that global only when `app.withGlobalTauri` is `true` — its default is
`false` — so `tauri.conf.json` sets it. With it false the webview has no
`window.__TAURI__` at all, `readDesktopInfo` returns null, and the panel silently
falls through to the advertised/hosted state: the desktop state is unreachable.
That was a real defect, not a hypothetical one — the real-hop script below found
it (before the flag, the webview reported `typeof window.__TAURI__ ===
"undefined"` and the panel showed `self-hosted`).

Two tests cover two different claims:

| Claim | Test |
| --- | --- |
| The panel's state handling is right, given the shell's report | `tests/browser/b34-mcp-gating.spec.ts` **B34d** — injects `window.__TAURI__` carrying the shell's payload |
| The real shell exposes the bridge, and `desktop_info` answers through it | `tests/desktop/ipc-hop.mjs` — launches the built shell under a virtual display and drives it over WebDriver |

```sh
cargo build --manifest-path src-tauri/Cargo.toml
xvfb-run -a node tests/desktop/ipc-hop.mjs
```

The script asserts that the webview's `window.__TAURI__` is an object, invokes
`desktop_info` over the real IPC (the payload arrives camelCase, per
`#[serde(rename_all = "camelCase")]`), opens the Tools rail and requires the
panel to reach `data-mcp-state="desktop"`. It needs `Xvfb`, `WebKitWebDriver`
(`webkit2gtk-driver`) and `tauri-driver` (`cargo install tauri-driver --locked`);
none of them are dependencies of this package, so install them only to run it.

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

## Building and bundling

`npm run build` produces `dist/`, which the shell embeds. Bundling is the Tauri
CLI's job (`npx @tauri-apps/cli@2 build`), and the bundle needs **real platform
icons**: `bundle.icon` must list PNG/ICO/ICNS files. An SVG-only list is accepted
and then silently produces a bundle with **no icons at all** and a `.desktop`
entry whose `Icon=` resolves to nothing — verified with
`tauri build --debug --bundles deb`: the deb installed only `usr/bin/pigma-desktop`
and `usr/share/applications/Pigma.desktop`, with no `usr/share/icons` tree.

The set in `icons/` is derived from the project's own mark, never drawn by hand:

```sh
npx @tauri-apps/cli@2 icon src-tauri/icons/icon.svg --output src-tauri/icons
```

That writes `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns` (macOS),
`icon.ico` (Windows) and `icon.png` (the window icon `generate_context!`
embeds), plus mobile and Windows Store assets that this desktop build does not
list. With the list in `tauri.conf.json`, `--bundles deb` installs
`usr/share/icons/hicolor/{32x32,128x128,256x256@2}/apps/pigma-desktop.png`, so
the desktop entry's `Icon=` resolves.

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
  `https://josei.github.io/pigma/desktop-assets.json` and is overridable with
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

## Packaging per platform

`src-tauri/tauri.conf.json` keeps the macOS targets (`app`, `dmg`). Tauri merges a
platform file over it: `src-tauri/tauri.linux.conf.json` sets `deb` for Linux. The Linux
build was checked locally: `cargo tauri build --debug` produced one bundle,
`Pigma_0.1.0_amd64.deb`, which contains `usr/bin/pigma-desktop` and a desktop entry.
Windows (`msi`, `nsis`) is set in `src-tauri/tauri.windows.conf.json`. The CI workflow builds
the bundles on Windows, macOS and Linux and uploads them as artifacts. The app is unsigned by
decision, so Windows and macOS show a warning on first launch.

If a macOS job is cancelled with no steps, check its annotations. Run 39480031196 (commit 316bce2)
was cancelled with "The job was not acquired by Runner of type hosted even after multiple
attempts": GitHub had no hosted macOS runner free, so no step ran. The same commit's rerun passed
(run 39484112294). Rerun the workflow; it is not a build failure. AppImage is left out of Linux: it needs an extra tool download at
build time, and `deb` is enough for the first release.

## Local servers for the desktop app

The app starts its own MCP server and rooms relay, on loopback only, and stops them when it
exits. Three parts make that work:

- `scripts/build-servers.mjs` bundles the relay and the MCP server into `dist-servers/`. The
  native rasterizer `@resvg/resvg-js` stays external: it ships a binary per platform.
- `scripts/sidecar-supervisor.mjs` runs both servers as children. It stops them when its
  standard input closes, and the shell holds the other end of that pipe. So the servers stop
  however the app exits: a normal quit, a SIGTERM, or a crash. Without it the children were left
  running as orphans (measured on Linux).
- `scripts/prepare-sidecar.mjs` puts the bundles, the supervisor and a Node runtime into
  `src-tauri/sidecar/`, which `tauri.conf.json` ships as a resource. The runtime is a copy of
  the Node that runs the build, so no download is needed on any runner. The folder is built,
  not committed.

The shell (`src-tauri/src/servers.rs`) starts the supervisor in `setup` and stops it on exit. A
development run has no sidecar; the window opens and the servers are logged as not started.

Advertised addresses: the shell advertises the relay as `ws://127.0.0.1:3002/relay`. The rooms
client sets the path to `/collab` before it connects (`src/collab/client.ts`), so the connection
works; the `/relay` in the advertised base is a label, not the path used.

Tests: `src/desktop/servers.bundle.test.ts` builds the bundles, starts the relay from the bundle
directory, checks the MCP bundle's usage, and checks that the supervisor runs both servers and
stops them when its pipe closes.

## Packaged-app check in CI

`scripts/check-desktop-servers.mjs <binary>` starts the app, waits for MCP to answer `initialize`,
calls `tools/list`, opens a rooms socket on `/collab`, then stops the app and checks that both ports
close. The desktop workflow runs it on each platform after the build: Linux runs the extracted `.deb`
under `xvfb-run`, macOS runs the `.app`'s binary, and Windows installs the NSIS setup silently and runs
the installed `pigma-desktop.exe`. Run locally on Linux, it passes; on a binary that starts no servers it
fails after 90 seconds. Run 39492897817 (commit 26bcb35) passed the check on Linux, macOS and Windows.

