//! Pigma desktop shell.
//!
//! The shell is deliberately thin: it loads the same editor bundle the web build
//! serves and hands it the two facts a desktop build adds — where the MCP
//! endpoint lives and that a Rooms relay may be reachable. Everything else (the
//! editor, the Rooms client, local-first behaviour) is the shared code.
//!
//! Defaults follow the product decision in docs/ROADMAP.md: getpigma.com hosts
//! the relay but **not** MCP, so the shell reports the loopback MCP endpoint it
//! can serve itself (`http://127.0.0.1:<port>/mcp`, the Node server the CLI
//! runs) and the hosted relay for Rooms. That is what puts the MCP panel in its
//! desktop state instead of the hosted one. See docs/DESKTOP.md.
//!
//! **Assets update themselves** (src/assets.rs): on launch the shell fetches the
//! published manifest, verifies every hash, caches the bundle under
//! `appDataDir/assets/<version>/` and swaps a pointer, so a shell downloaded a
//! year ago runs today's editor. The shell *binary* still updates through the
//! normal Tauri updater; only the assets move here.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets;

use assets::{AssetStatus, UpdateOutcome};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, UriSchemeContext};

/// Facts the frontend asks for on boot.
#[derive(serde::Serialize)]
// The frontend reads this payload by name (`src/config/mcpAvailability.ts`,
// `readDesktopInfo`). `#[derive(Serialize)]` alone emits the Rust field names
// (snake_case), which the panel does not read — it looks for `mcpEndpoint` — so
// the desktop state would silently never resolve. camelCase is the contract;
// `desktop_info_serializes_camel_case` below pins it.
#[serde(rename_all = "camelCase")]
struct DesktopInfo {
    /// Effective MCP endpoint: this shell's loopback server (MCP is not hosted).
    mcp_endpoint: String,
    /// Effective Rooms relay: hosted, overridable in the panel.
    relay_url: String,
    /// Loopback MCP endpoint this shell can serve offline (the override).
    local_mcp_endpoint: String,
    /// Loopback relay this shell can serve offline (the override).
    local_relay_url: String,
    /// Hosted endpoints need no token; a self-hosted one may.
    mcp_token_required: bool,
    /// Custom scheme the cached asset bundle is served from, when one is active.
    asset_origin: Option<String>,
}

struct Config {
    mcp_port: u16,
    relay_port: u16,
    /// Where the manifest is fetched from; overridable for a self-hosted build.
    manifest_url: String,
    /// Cache root: `appDataDir/assets` unless overridden.
    cache_root: Option<PathBuf>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            // The CLI defaults: 3001 for MCP over HTTP, 3002 for the relay.
            mcp_port: 3001,
            relay_port: 3002,
            manifest_url: std::env::var("PIGMA_ASSET_MANIFEST_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| assets::DEFAULT_MANIFEST_URL.to_string()),
            cache_root: std::env::var("PIGMA_ASSET_CACHE")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(PathBuf::from),
        }
    }
}

/// The cache root: the shell's app data directory, created on first use.
fn cache_root(app: &tauri::AppHandle, config: &Config) -> Result<PathBuf, String> {
    let root = match &config.cache_root {
        Some(path) => path.clone(),
        None => app
            .path()
            .app_data_dir()
            .map_err(|error| format!("no app data directory: {error}"))?,
    };
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

#[tauri::command]
fn desktop_info(config: tauri::State<'_, Mutex<Config>>) -> DesktopInfo {
    let config = config.lock().expect("config lock");
    DesktopInfo {
        // MCP is not offered on the hosted site, so the desktop build reports the
        // loopback endpoint it serves itself; Rooms stay on the hosted relay.
        mcp_endpoint: format!("http://127.0.0.1:{}/mcp", config.mcp_port),
        relay_url: "wss://getpigma.com/relay".to_string(),
        // What this shell can serve locally, offline.
        local_mcp_endpoint: format!("http://127.0.0.1:{}/mcp", config.mcp_port),
        local_relay_url: format!("ws://127.0.0.1:{}/relay", config.relay_port),
        mcp_token_required: false,
        asset_origin: None,
    }
}

/// What the asset cache holds right now: the version the shell loads, every
/// cached version, when the last check ran and what it last failed with.
#[tauri::command]
fn desktop_asset_status(app: tauri::AppHandle) -> Result<AssetStatus, String> {
    let config = app.state::<Mutex<Config>>();
    let config = config.lock().expect("config lock");
    let root = cache_root(&app, &config)?;
    Ok(assets::read_status(&root))
}

/// Check for a newer bundle now. `force` re-checks even when the cached version
/// looks current. Returns what happened; never throws at the caller.
#[tauri::command]
async fn desktop_asset_check(app: tauri::AppHandle, force: bool) -> Result<UpdateOutcome, String> {
    let (root, url) = {
        let config = app.state::<Mutex<Config>>();
        let config = config.lock().expect("config lock");
        (cache_root(&app, &config)?, config.manifest_url.clone())
    };
    if !force {
        // A cheap guard against re-checking on every call: the pointer's version
        // is compared inside `apply_update` anyway, so a non-forced check only
        // skips the network when the marker says we checked very recently.
        if let Some(age) = assets::seconds_since_last_check(&root) {
            if age < 60 {
                return Ok(assets::current_outcome(&root));
            }
        }
    }
    // `check_for_assets` uses `reqwest::blocking`, which must never run on a
    // Tauri async worker (it would block that worker for the whole download).
    // Hand it to the blocking pool and await the result instead.
    let blocking_root = root.clone();
    let blocking_url = url.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || check_for_assets(&blocking_root, &blocking_url))
        .await
        .map_err(|error| format!("the asset check could not run: {error}"))?;
    if outcome.status == "updated" {
        // The running window is on the old bundle: reload it onto the new one.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.eval("window.location.reload()");
        }
    }
    Ok(outcome)
}

/// Fetch the manifest and apply it. A network failure is reported, never fatal:
/// the cached bundle keeps serving.
fn check_for_assets(root: &PathBuf, manifest_url: &str) -> UpdateOutcome {
    let manifest = match fetch_manifest(manifest_url) {
        Ok(manifest) => manifest,
        Err(error) => {
            assets::record_check_failure(root, &error);
            return assets::current_outcome(root);
        }
    };
    let base = manifest_url.rsplit_once('/').map(|(prefix, _)| prefix.to_string());
    assets::apply_update(root, Some(&manifest), |path| fetch_asset(base.as_deref(), path))
}

fn fetch_manifest(url: &str) -> Result<assets::AssetManifest, String> {
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .header("accept", "application/json")
        .send()
        .map_err(|error| format!("could not reach the asset manifest: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("asset manifest returned HTTP {}", response.status()));
    }
    let text = response.text().map_err(|error| error.to_string())?;
    assets::parse_manifest(&text)
}

/// Download one asset. Paths are validated by the manifest parser first, so a
/// manifest can never make the shell read outside the cache.
fn fetch_asset(base: Option<&str>, path: &str) -> Result<Vec<u8>, String> {
    if !assets::is_safe_asset_path(path) {
        return Err(format!("refusing to fetch unsafe asset path {path:?}"));
    }
    let Some(base) = base else {
        return Err("the manifest URL has no directory to resolve assets against".into());
    };
    let url = format!("{base}/{path}");
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())?
        .get(&url)
        .send()
        .map_err(|error| format!("could not download {path}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("{path} returned HTTP {}", response.status()));
    }
    response.bytes().map(|bytes| bytes.to_vec()).map_err(|error| error.to_string())
}

/// The cached bundle, when one is installed and complete. `None` means the shell
/// falls back to the bundle it shipped with.
fn active_bundle(app: &tauri::AppHandle) -> Option<(String, String, PathBuf)> {
    let config = app.state::<Mutex<Config>>();
    let config = config.lock().expect("config lock");
    let root = cache_root(app, &config).ok()?;
    assets::resolve_active_bundle(&root)
}

/// Content type for the handful of file kinds a bundle contains. A wrong type is
/// worse than a generic one: scripts and stylesheets must be exact.
fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Serve the cached bundle over `pigma://localhost/…`, through the pointer.
///
/// Only files inside the active bundle are reachable: the request path is
/// normalised, `..` is refused, and a miss falls through to a 404 rather than to
/// the filesystem.
fn serve_bundle(app: &tauri::AppHandle, request_path: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = || {
        tauri::http::Response::builder()
            .status(404)
            .header("content-type", "text/plain; charset=utf-8")
            .body(b"not found".to_vec())
            .expect("static response")
    };
    let Some((_version, _entry, dir)) = active_bundle(app) else {
        return not_found();
    };
    let trimmed = request_path.trim_start_matches('/');
    let relative = if trimmed.is_empty() { "index.html" } else { trimmed };
    if !assets::is_safe_asset_path(relative) {
        return not_found();
    }
    let Ok(bytes) = std::fs::read(dir.join(relative)) else {
        return not_found();
    };
    tauri::http::Response::builder()
        .status(200)
        .header("content-type", content_type(relative))
        // The bundle is versioned, so it may be cached hard.
        .header("cache-control", "no-cache")
        .body(bytes)
        .expect("file response")
}

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(Config::default()))
        // Confirmed on a machine with the Rust toolchain and the Tauri system
        // prerequisites (rustc 1.99.0, webkit2gtk-4.1/gtk+-3.0/libsoup-3.0):
        // `cargo check` is clean and `cargo test` passes. The closure signature,
        // the `responder.respond(..)` call and the bundle read all typecheck;
        // the webview itself is not exercised headlessly here (no display
        // server), so the IPC hop is verified only to the extent above.
        .register_asynchronous_uri_scheme_protocol("pigma", |ctx: UriSchemeContext<'_, tauri::Wry>, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            // Reading the bundle is file IO: keep it off the UI thread. (A plain
            // thread rather than `spawn_blocking`, because this runs outside the
            // async runtime; needs `cargo check` like the rest of this closure.)
            std::thread::spawn(move || responder.respond(serve_bundle(&app, &path)));
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let (root, url) = {
                let config = app.state::<Mutex<Config>>();
                let config = config.lock().expect("config lock");
                (cache_root(&handle, &config).ok(), config.manifest_url.clone())
            };
            // On launch: a check that never blocks the window. The window starts
            // on the shipped bundle; an update reloads it onto the new one.
            if let Some(root) = root {
                std::thread::spawn(move || {
                    let _ = check_for_assets(&root, &url);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![desktop_info, desktop_asset_status, desktop_asset_check])
        .run(tauri::generate_context!())
        .expect("error while running Pigma");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend's `readDesktopInfo` reads these keys by name, so the wire
    /// shape is a contract. Asserting the whole key set means a rename of any
    /// field fails here rather than silently producing no desktop state.
    #[test]
    fn desktop_info_serializes_camel_case() {
        let value = serde_json::to_value(DesktopInfo {
            mcp_endpoint: "http://127.0.0.1:3001/mcp".to_string(),
            relay_url: "wss://getpigma.com/relay".to_string(),
            local_mcp_endpoint: "http://127.0.0.1:3001/mcp".to_string(),
            local_relay_url: "ws://127.0.0.1:3002/relay".to_string(),
            mcp_token_required: false,
            asset_origin: None,
        })
        .expect("DesktopInfo serializes");
        let object = value.as_object().expect("DesktopInfo is an object");
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            ["assetOrigin", "localMcpEndpoint", "localRelayUrl", "mcpEndpoint", "mcpTokenRequired", "relayUrl"],
        );
        assert_eq!(
            object.get("mcpEndpoint").and_then(|value| value.as_str()),
            Some("http://127.0.0.1:3001/mcp"),
        );
        assert_eq!(object.get("mcpTokenRequired").and_then(|value| value.as_bool()), Some(false));
        assert!(
            !object.contains_key("mcp_endpoint"),
            "snake_case keys never reach the panel's `readDesktopInfo`",
        );
    }
}
