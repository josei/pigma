//! Desktop asset auto-update.
//!
//! The shell does not ship its own copy of the editor: one asset bundle serves
//! every build (the web build detects Tauri at runtime), and the shell caches it
//! so a shell downloaded last year runs today's editor. Only the assets move
//! here — the shell **binary** still updates through the normal Tauri updater.
//!
//! `npm run build` writes `dist/desktop-assets.json` as its last step
//! (`scripts/desktop-assets.mjs`):
//!
//! ```json
//! {
//!   "schema": "pigma/assets/1",
//!   "version": "0.1.0+f35d37119e39",
//!   "entry": "index.html",
//!   "assets": { "index.html": "<sha256>", "assets/index-abc.js": "<sha256>" }
//! }
//! ```
//!
//! The update is: fetch the manifest, compare versions, download the files whose
//! hash differs into `assets/<version>.tmp/`, **verify every sha256**, rename the
//! directory into place, then swap the pointer by write-then-rename. The replaced
//! version is kept for one rollback, and a bundle that fails verification is
//! never activated — the previous one keeps serving.
//!
//! This is a port of the reference client in `src/desktop/assets.ts`, which is
//! unit tested in the JS test suite; the tests at the bottom of this file cover
//! the same decisions for the shell.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Manifest tag this shell understands.
pub const MANIFEST_SCHEMA: &str = "pigma/assets/1";
/// Pointer file inside the cache root.
pub const POINTER_FILE: &str = "current.json";
/// Where the manifest lives by default; overridable by the user.
pub const DEFAULT_MANIFEST_URL: &str = "https://getpigma.com/desktop-assets.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssetManifest {
    pub schema: String,
    pub version: String,
    pub entry: String,
    /// path -> sha256 (lowercase hex).
    pub assets: BTreeMap<String, String>,
}

/// The bundle the shell is currently pointed at.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pointer {
    pub version: String,
    pub entry: String,
    /// The version kept for rollback, when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AssetStatus {
    pub current_version: Option<String>,
    pub entry: Option<String>,
    pub cached_versions: Vec<String>,
    pub previous_version: Option<String>,
    /// Unix seconds of the last check, from the marker file; null if never.
    pub last_check: Option<u64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    /// Nothing to do: the cached bundle is the manifest's version.
    Current { version: String, entry: String },
    /// Download `files` into `version`.
    Install {
        version: String,
        entry: String,
        files: Vec<String>,
        fresh: bool,
    },
    /// Nothing usable is cached: fall back to the version kept for rollback.
    Rollback { version: String, entry: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Verification {
    pub ok: bool,
    pub mismatched: Vec<String>,
    pub missing: Vec<String>,
}

/// True for a relative, non-escaping asset path.
pub fn is_safe_asset_path(path: &str) -> bool {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') || path.contains('\0') {
        return false;
    }
    if path.len() > 1 && path.as_bytes()[1] == b':' {
        return false; // windows drive letter
    }
    if path.split('/').any(|segment| segment == ".." || segment.is_empty()) {
        return false;
    }
    // No scheme-looking names (http:, file:, data: ...).
    let mut chars = path.chars();
    if let Some(first) = chars.next() {
        if first.is_ascii_alphabetic() {
            let rest: String = chars.take_while(|c| *c != '/').collect();
            if rest.contains(':') {
                return false;
            }
        }
    }
    true
}

fn is_hex_digest(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit())
}

/// Reject anything that is not a manifest this shell understands.
pub fn parse_manifest(json: &str) -> Result<AssetManifest, String> {
    let manifest: AssetManifest =
        serde_json::from_str(json).map_err(|error| format!("manifest is not valid JSON: {error}"))?;
    if manifest.schema != MANIFEST_SCHEMA {
        return Err(format!("unsupported manifest schema {:?}", manifest.schema));
    }
    if manifest.version.trim().is_empty() {
        return Err("manifest has no version".into());
    }
    if manifest.entry.trim().is_empty() {
        return Err("manifest has no entry".into());
    }
    if manifest.assets.is_empty() {
        return Err("manifest lists no assets".into());
    }
    for (path, hash) in &manifest.assets {
        if !is_safe_asset_path(path) {
            return Err(format!("unsafe asset path {path:?}"));
        }
        if !is_hex_digest(hash) {
            return Err(format!("asset {path:?} has no sha256"));
        }
    }
    if !manifest.assets.contains_key(&manifest.entry) {
        return Err("manifest entry is not one of its assets".into());
    }
    Ok(manifest)
}

pub fn parse_pointer(json: &str) -> Option<Pointer> {
    let pointer: Pointer = serde_json::from_str(json).ok()?;
    if pointer.version.trim().is_empty() || pointer.entry.trim().is_empty() {
        return None;
    }
    Some(pointer)
}

/// Files whose hash differs between the manifest and what is cached.
pub fn changed_files(manifest: &AssetManifest, installed: &BTreeMap<String, String>) -> Vec<String> {
    manifest
        .assets
        .iter()
        .filter(|(path, hash)| installed.get(*path) != Some(*hash))
        .map(|(path, _)| path.clone())
        .collect()
}

/// Check a downloaded bundle against the manifest before it is activated.
pub fn verify_bundle(manifest: &AssetManifest, hashes: &BTreeMap<String, String>) -> Verification {
    let mut mismatched = Vec::new();
    let mut missing = Vec::new();
    for (path, expected) in &manifest.assets {
        match hashes.get(path) {
            None => missing.push(path.clone()),
            Some(actual) if !actual.eq_ignore_ascii_case(expected) => mismatched.push(path.clone()),
            Some(_) => {}
        }
    }
    mismatched.sort();
    missing.sort();
    Verification {
        ok: mismatched.is_empty() && missing.is_empty(),
        mismatched,
        missing,
    }
}

/// Decide what to do with a manifest. Precedence matches the JS client.
pub fn decide(
    manifest: Option<&AssetManifest>,
    pointer: Option<&Pointer>,
    installed: Option<&BTreeMap<String, String>>,
) -> Decision {
    let usable = match (pointer, installed) {
        (Some(pointer), Some(installed)) if !installed.is_empty() => Some(pointer),
        _ => None,
    };
    // NOTE: inside this `else` block the `pointer` below is still the **function
    // parameter** (`Option<&Pointer>`), not the `let ... else` binding — that
    // binding only exists after the block. The parameter is what carries the
    // `previous` version used for the rollback decision.
    let Some(pointer) = usable else {
        let Some(manifest) = manifest else {
            // Nothing usable cached and nothing reachable: fall back to the
            // version kept for rollback, if any.
            return Decision::Rollback {
                version: pointer.and_then(|p| p.previous.clone()).unwrap_or_default(),
                entry: pointer.map(|p| p.entry.clone()).unwrap_or_default(),
            };
        };
        return Decision::Install {
            version: manifest.version.clone(),
            entry: manifest.entry.clone(),
            files: manifest.assets.keys().cloned().collect(),
            fresh: true,
        };
    };
    let Some(manifest) = manifest else {
        // Offline: keep what is cached.
        return Decision::Current {
            version: pointer.version.clone(),
            entry: pointer.entry.clone(),
        };
    };
    if manifest.version == pointer.version {
        return Decision::Current {
            version: pointer.version.clone(),
            entry: pointer.entry.clone(),
        };
    }
    let files = changed_files(manifest, installed.unwrap());
    if files.is_empty() {
        return Decision::Current {
            version: pointer.version.clone(),
            entry: pointer.entry.clone(),
        };
    }
    Decision::Install {
        version: manifest.version.clone(),
        entry: manifest.entry.clone(),
        files,
        fresh: false,
    }
}

/// Cache directory for a version, relative to the cache root.
pub fn asset_dir(version: &str) -> String {
    let safe: String = version
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-') { c } else { '_' })
        .collect();
    format!("assets/{safe}")
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// sha256 of every file under `dir`, keyed by its path relative to `dir`.
pub fn hash_tree(dir: &Path) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    collect_hashes(dir, dir, &mut out);
    out
}

fn collect_hashes(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_hashes(root, &path, out);
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        let Ok(relative) = path.strip_prefix(root) else { continue };
        let key = relative.to_string_lossy().replace('\\', "/");
        out.insert(key, sha256_hex(&bytes));
    }
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Record the outcome of a check, so `desktop_asset_status` can report it.
fn write_check_marker(root: &Path, error: Option<&str>) {
    let path = root.join("last-check.json");
    let body = serde_json::json!({ "at": now_seconds(), "error": error });
    let _ = write_atomically(&path, body.to_string().as_bytes());
}

fn read_check_marker(root: &Path) -> (Option<u64>, Option<String>) {
    let Ok(text) = fs::read_to_string(root.join("last-check.json")) else {
        return (None, None);
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return (None, None);
    };
    let at = value.get("at").and_then(|v| v.as_u64());
    let error = value
        .get("error")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    (at, error)
}

/// Replace `to` with `from`, on every platform.
///
/// `std::fs::rename` is atomic and replacing on Unix, but on Windows it **fails**
/// when the destination exists — which would mean the pointer and the check
/// marker could never be updated after their first write. There, remove the
/// destination first. The window between the two calls is why the pointer is
/// written from a temporary file in the first place: a crash leaves either the
/// old file or the new one, never a half-written one.
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        if to.exists() {
            fs::remove_file(to)?;
        }
    }
    fs::rename(from, to)
}

/// Write a file through a temporary sibling and a rename, so readers never see a
/// half-written file (the pointer swap and the check marker both rely on this).
fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("tmp");
    {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    replace_file(&temporary, path)
}

fn write_pointer(root: &Path, pointer: &Pointer) -> Result<(), String> {
    let body = serde_json::to_string_pretty(pointer).map_err(|error| error.to_string())?;
    write_atomically(&root.join(POINTER_FILE), body.as_bytes()).map_err(|error| error.to_string())
}

fn read_pointer(root: &Path) -> Option<Pointer> {
    let text = fs::read_to_string(root.join(POINTER_FILE)).ok()?;
    parse_pointer(&text)
}

/// Seconds since the last recorded check, or `None` when there is no marker.
pub fn seconds_since_last_check(root: &Path) -> Option<u64> {
    let (at, _) = read_check_marker(root);
    at.map(|at| now_seconds().saturating_sub(at))
}

/// Record a failed check (a manifest fetch, typically) so the status reports it.
pub fn record_check_failure(root: &Path, error: &str) {
    write_check_marker(root, Some(error));
}

/// What the cache holds right now, as an outcome — used when a check cannot run.
pub fn current_outcome(root: &Path) -> UpdateOutcome {
    let status = read_status(root);
    UpdateOutcome {
        status: "current".into(),
        version: status.current_version.unwrap_or_default(),
        entry: status.entry.unwrap_or_default(),
        downloaded: Vec::new(),
        error: status.last_error,
    }
}

/// Cached versions, newest first is not knowable from disk, so sorted.
pub fn cached_versions(root: &Path) -> Vec<String> {
    let dir = root.join("assets");
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut versions: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            // A staging directory is not a cached bundle.
            if name.ends_with(".tmp") {
                None
            } else {
                Some(name)
            }
        })
        .collect();
    versions.sort();
    versions
}

pub fn read_status(root: &Path) -> AssetStatus {
    let pointer = read_pointer(root);
    let (last_check, last_error) = read_check_marker(root);
    AssetStatus {
        current_version: pointer.as_ref().map(|p| p.version.clone()),
        entry: pointer.as_ref().map(|p| p.entry.clone()),
        cached_versions: cached_versions(root),
        previous_version: pointer.as_ref().and_then(|p| p.previous.clone()),
        last_check,
        last_error,
    }
}

/// The bundle the shell should load: the pointer's version, falling back to the
/// version kept for rollback when the active one is incomplete. Offline: no
/// network involved, and a bundle that is not there is never returned.
pub fn resolve_active_bundle(root: &Path) -> Option<(String, String, PathBuf)> {
    let pointer = read_pointer(root)?;
    let candidates = std::iter::once(pointer.version.clone()).chain(pointer.previous.clone());
    for version in candidates {
        let dir = root.join(asset_dir(&version));
        let hashes = hash_tree(&dir);
        if !hashes.contains_key(&pointer.entry) {
            continue;
        }
        // VERIFY AT THE SERVING PATH, not only at install. A bundle whose manifest
        // is present and whose tree does not match it is NOT served; the next
        // candidate (the previous version) is tried instead, and if none passes the
        // window falls back to the bundle baked into the binary.
        if let Ok(json) = fs::read_to_string(root.join(manifest_file(&version))) {
            if let Ok(manifest) = parse_manifest(&json) {
                if !verify_bundle(&manifest, &hashes).ok {
                    continue;
                }
            }
        }
        return Some((version, pointer.entry.clone(), dir));
    }
    None
}

/// Where a version's manifest is kept, beside its bundle.
pub fn manifest_file(version: &str) -> String {
    format!("manifest-{}.json", version.replace(['/', '\\', ':'], "_"))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UpdateOutcome {
    /// "current" | "updated" | "rollback" | "failed"
    pub status: String,
    pub version: String,
    pub entry: String,
    pub downloaded: Vec<String>,
    pub error: Option<String>,
}

/// Bring the cache up to date. `fetch` is the network, injected so the decision
/// logic stays testable: `Ok(bytes)` for an asset, `Err` for a failure.
pub fn apply_update<F>(root: &Path, manifest: Option<&AssetManifest>, fetch: F) -> UpdateOutcome
where
    F: Fn(&str) -> Result<Vec<u8>, String>,
{
    let pointer = read_pointer(root);
    let installed = pointer
        .as_ref()
        .map(|p| hash_tree(&root.join(asset_dir(&p.version))))
        .filter(|hashes| !hashes.is_empty());

    let decision = decide(manifest, pointer.as_ref(), installed.as_ref());
    match decision {
        Decision::Current { version, entry } => UpdateOutcome {
            status: "current".into(),
            version,
            entry,
            downloaded: Vec::new(),
            error: None,
        },
        Decision::Rollback { version, entry } => {
            if version.is_empty() {
                let outcome = UpdateOutcome {
                    status: "failed".into(),
                    version: String::new(),
                    entry: String::new(),
                    downloaded: Vec::new(),
                    error: Some("no cached bundle to fall back to".into()),
                };
                write_check_marker(root, outcome.error.as_deref());
                return outcome;
            }
            let entry = if entry.is_empty() { "index.html".to_string() } else { entry };
            let result = write_pointer(root, &Pointer { version: version.clone(), entry: entry.clone(), previous: None });
            let error = result.err();
            write_check_marker(root, error.as_deref());
            UpdateOutcome {
                status: if error.is_some() { "failed".into() } else { "rollback".into() },
                version,
                entry,
                downloaded: Vec::new(),
                error,
            }
        }
        Decision::Install { version, entry, files, fresh: _ } => {
            let manifest = manifest.expect("an install decision has a manifest");
            let target = root.join(asset_dir(&version));
            let staging = root.join(format!("{}.tmp", asset_dir(&version)));
            let _ = fs::remove_dir_all(&staging);
            let mut hashes: BTreeMap<String, String> = BTreeMap::new();
            let mut downloaded: Vec<String> = Vec::new();

            let fail = |error: String, root: &Path| -> UpdateOutcome {
                let _ = fs::remove_dir_all(&staging);
                write_check_marker(root, Some(&error));
                UpdateOutcome {
                    status: "failed".into(),
                    version: pointer.as_ref().map(|p| p.version.clone()).unwrap_or_default(),
                    entry: pointer.as_ref().map(|p| p.entry.clone()).unwrap_or_default(),
                    downloaded: Vec::new(),
                    error: Some(error),
                }
            };

            for path in &files {
                match fetch(path) {
                    Ok(bytes) => {
                        let digest = sha256_hex(&bytes);
                        let destination = staging.join(path);
                        if let Some(parent) = destination.parent() {
                            if let Err(error) = fs::create_dir_all(parent) {
                                return fail(error.to_string(), root);
                            }
                        }
                        if let Err(error) = fs::write(&destination, &bytes) {
                            return fail(error.to_string(), root);
                        }
                        hashes.insert(path.clone(), digest);
                        downloaded.push(path.clone());
                    }
                    Err(error) => return fail(error, root),
                }
            }

            // Assets this version already had are copied from the previous
            // bundle, never re-downloaded.
            if let Some(previous) = pointer.as_ref() {
                let previous_dir = root.join(asset_dir(&previous.version));
                for path in manifest.assets.keys() {
                    if hashes.contains_key(path) {
                        continue;
                    }
                    let source = previous_dir.join(path);
                    let Ok(bytes) = fs::read(&source) else { continue };
                    let destination = staging.join(path);
                    if let Some(parent) = destination.parent() {
                        if let Err(error) = fs::create_dir_all(parent) {
                            return fail(error.to_string(), root);
                        }
                    }
                    if let Err(error) = fs::write(&destination, &bytes) {
                        return fail(error.to_string(), root);
                    }
                    hashes.insert(path.clone(), sha256_hex(&bytes));
                }
            }

            let verification = verify_bundle(manifest, &hashes);
            if !verification.ok {
                let error = format!(
                    "bundle failed verification ({} mismatched, {} missing)",
                    verification.mismatched.len(),
                    verification.missing.len()
                );
                return fail(error, root);
            }

            let _ = fs::remove_dir_all(&target);
            if let Err(error) = fs::rename(&staging, &target) {
                return fail(error.to_string(), root);
            }
            // THE MANIFEST IS KEPT WITH THE BUNDLE, so the SERVING path can verify
            // too. It used to be dropped after activation, which meant the scheme
            // handler could only check that the entry FILE EXISTED — a corrupted
            // bundle with the right file names would have been served.
            if let Ok(json) = serde_json::to_string(manifest) {
                let _ = write_atomically(&root.join(manifest_file(&version)), json.as_bytes());
            }

            let next = Pointer {
                version: version.clone(),
                entry: entry.clone(),
                previous: pointer.as_ref().map(|p| p.version.clone()),
            };
            if let Err(error) = write_pointer(root, &next) {
                return fail(error, root);
            }
            write_check_marker(root, None);
            UpdateOutcome {
                status: "updated".into(),
                version,
                entry,
                downloaded,
                error: None,
            }
        }
    }
}

/// Move the pointer back to the version kept for rollback.
pub fn rollback(root: &Path) -> UpdateOutcome {
    let Some(pointer) = read_pointer(root) else {
        return UpdateOutcome {
            status: "failed".into(),
            version: String::new(),
            entry: String::new(),
            downloaded: Vec::new(),
            error: Some("nothing to roll back to".into()),
        };
    };
    let Some(previous) = pointer.previous.clone() else {
        return UpdateOutcome {
            status: "failed".into(),
            version: pointer.version,
            entry: pointer.entry,
            downloaded: Vec::new(),
            error: Some("nothing to roll back to".into()),
        };
    };
    let next = Pointer {
        version: previous.clone(),
        entry: pointer.entry.clone(),
        previous: Some(pointer.version.clone()),
    };
    match write_pointer(root, &next) {
        Ok(()) => UpdateOutcome {
            status: "rollback".into(),
            version: previous,
            entry: pointer.entry,
            downloaded: Vec::new(),
            error: None,
        },
        Err(error) => UpdateOutcome {
            status: "failed".into(),
            version: pointer.version,
            entry: pointer.entry,
            downloaded: Vec::new(),
            error: Some(error),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(version: &str, assets: &[(&str, &str)]) -> AssetManifest {
        AssetManifest {
            schema: MANIFEST_SCHEMA.into(),
            version: version.into(),
            entry: "index.html".into(),
            assets: assets.iter().map(|(p, h)| (p.to_string(), h.to_string())).collect(),
        }
    }

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pigma-assets-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sha256_matches_a_known_vector() {
        // `echo -n "abc" | sha256sum`
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn manifests_are_validated_not_trusted() {
        let good = format!(
            r#"{{"schema":"{MANIFEST_SCHEMA}","version":"1.0.0+a","entry":"index.html","assets":{{"index.html":"{}"}}}}"#,
            sha256_hex(b"a")
        );
        let parsed = parse_manifest(&good).expect("valid manifest");
        assert_eq!(parsed.version, "1.0.0+a");
        assert_eq!(parsed.entry, "index.html");

        assert!(parse_manifest("{}").is_err());
        assert!(parse_manifest(&good.replace(MANIFEST_SCHEMA, "pigma/assets/2")).is_err());
        assert!(parse_manifest(&good.replace("index.html", "../escape")).is_err());
        assert!(parse_manifest(&good.replace(&sha256_hex(b"a"), "abc")).is_err());
        assert!(parse_manifest(&good.replace("\"entry\":\"index.html\"", "\"entry\":\"missing.html\"")).is_err());
    }

    #[test]
    fn unsafe_asset_paths_are_refused() {
        assert!(is_safe_asset_path("index.html"));
        assert!(is_safe_asset_path("assets/index-abc.js"));
        assert!(!is_safe_asset_path("../secret"));
        assert!(!is_safe_asset_path("/etc/passwd"));
        assert!(!is_safe_asset_path("assets//x"));
        assert!(!is_safe_asset_path("https://evil.test/x"));
        assert!(!is_safe_asset_path("assets\\x"));
    }

    #[test]
    fn changed_and_verification_follow_the_hashes() {
        let current = manifest("1.0.0+b", &[("index.html", &sha256_hex(b"v2")), ("app.js", &sha256_hex(b"one"))]);
        let installed: BTreeMap<String, String> = [("index.html".to_string(), sha256_hex(b"v1")), ("app.js".to_string(), sha256_hex(b"one"))]
            .into_iter()
            .collect();
        assert_eq!(changed_files(&current, &installed), vec!["index.html".to_string()]);

        let ok: BTreeMap<String, String> = current.assets.clone();
        assert!(verify_bundle(&current, &ok).ok);

        let tampered: BTreeMap<String, String> =
            [("index.html".to_string(), sha256_hex(b"tampered")), ("app.js".to_string(), sha256_hex(b"one"))]
                .into_iter()
                .collect();
        let result = verify_bundle(&current, &tampered);
        assert!(!result.ok);
        assert_eq!(result.mismatched, vec!["index.html".to_string()]);

        let incomplete: BTreeMap<String, String> = [("index.html".to_string(), sha256_hex(b"v2"))].into_iter().collect();
        assert_eq!(verify_bundle(&current, &incomplete).missing, vec!["app.js".to_string()]);
    }

    #[test]
    fn decisions_cover_fresh_current_offline_and_rollback() {
        let next = manifest("1.0.0+b", &[("index.html", &sha256_hex(b"v2"))]);
        assert!(matches!(
            decide(Some(&next), None, None),
            Decision::Install { fresh: true, .. }
        ));

        let pointer = Pointer { version: "1.0.0+a".into(), entry: "index.html".into(), previous: None };
        let installed: BTreeMap<String, String> = [("index.html".to_string(), sha256_hex(b"v1"))].into_iter().collect();
        assert!(matches!(decide(Some(&next), Some(&pointer), Some(&installed)), Decision::Install { fresh: false, .. }));
        // Offline: the cached bundle stays.
        assert!(matches!(
            decide(None, Some(&pointer), Some(&installed)),
            Decision::Current { .. }
        ));
        // Same version: nothing to do.
        let same = manifest("1.0.0+a", &[("index.html", &sha256_hex(b"v1"))]);
        assert!(matches!(decide(Some(&same), Some(&pointer), Some(&installed)), Decision::Current { .. }));
        // Nothing usable cached, nothing reachable: the kept version wins.
        let with_previous = Pointer {
            version: "1.0.0+b".into(),
            entry: "index.html".into(),
            previous: Some("1.0.0+a".into()),
        };
        assert_eq!(
            decide(None, Some(&with_previous), None),
            Decision::Rollback { version: "1.0.0+a".into(), entry: "index.html".into() }
        );
    }

    #[test]
    fn install_verifies_then_swaps_the_pointer() {
        let root = temp_root("install");
        let served: BTreeMap<&str, &[u8]> =
            [("index.html", b"v1".as_slice()), ("assets/app.js", b"one".as_slice())].into_iter().collect();
        let manifest = manifest(
            "1.0.0+a",
            &[
                ("index.html", &sha256_hex(b"v1")),
                ("assets/app.js", &sha256_hex(b"one")),
            ],
        );
        let fetch = |path: &str| served.get(path).map(|bytes| bytes.to_vec()).ok_or_else(|| "404".to_string());
        let outcome = apply_update(&root, Some(&manifest), fetch);
        assert_eq!(outcome.status, "updated");
        assert_eq!(outcome.downloaded.len(), 2);
        // The bundle is on disk under its versioned directory, and the pointer
        // names it. Nothing is left staged.
        assert!(root.join(asset_dir("1.0.0+a")).join("index.html").exists());
        assert!(!root.join(format!("{}.tmp", asset_dir("1.0.0+a"))).exists());
        let pointer = read_pointer(&root).expect("pointer written");
        assert_eq!(pointer.version, "1.0.0+a");
        assert!(pointer.previous.is_none());

        // A second run with the same manifest changes nothing.
        let again = apply_update(&root, Some(&manifest), |path: &str| {
            served.get(path).map(|bytes| bytes.to_vec()).ok_or_else(|| "404".to_string())
        });
        assert_eq!(again.status, "current");
    }

    #[test]
    fn a_tampered_bundle_is_refused_and_the_previous_one_keeps_serving() {
        let root = temp_root("tamper");
        let v1 = manifest("1.0.0+a", &[("index.html", &sha256_hex(b"v1"))]);
        apply_update(&root, Some(&v1), |_| Ok(b"v1".to_vec()));

        let v2 = manifest("1.0.0+b", &[("index.html", &sha256_hex(b"v2"))]);
        let outcome = apply_update(&root, Some(&v2), |_| Ok(b"tampered".to_vec()));
        assert_eq!(outcome.status, "failed");
        assert!(outcome.error.unwrap_or_default().contains("verification"));
        // The pointer still names v1, the tampered version is not on disk, and
        // nothing is staged.
        assert_eq!(read_pointer(&root).unwrap().version, "1.0.0+a");
        assert!(!root.join(asset_dir("1.0.0+b")).exists());
        assert!(!root.join(format!("{}.tmp", asset_dir("1.0.0+b"))).exists());
        assert_eq!(resolve_active_bundle(&root).unwrap().0, "1.0.0+a");
        // The failure is reported, not swallowed.
        assert!(read_status(&root).last_error.unwrap_or_default().contains("verification"));
    }

    #[test]
    fn unchanged_assets_are_copied_not_refetched_and_rollback_works() {
        let root = temp_root("update");
        let v1 = manifest(
            "1.0.0+a",
            &[("index.html", &sha256_hex(b"v1")), ("assets/app.js", &sha256_hex(b"one"))],
        );
        let first: BTreeMap<&str, &[u8]> =
            [("index.html", b"v1".as_slice()), ("assets/app.js", b"one".as_slice())].into_iter().collect();
        apply_update(&root, Some(&v1), |path: &str| {
            first.get(path).map(|b| b.to_vec()).ok_or_else(|| "404".into())
        });

        let v2 = manifest(
            "1.0.0+b",
            &[("index.html", &sha256_hex(b"v2")), ("assets/app.js", &sha256_hex(b"one"))],
        );
        let second: BTreeMap<&str, &[u8]> = [("index.html", b"v2".as_slice())].into_iter().collect();
        let outcome = apply_update(&root, Some(&v2), |path: &str| {
            second.get(path).map(|b| b.to_vec()).ok_or_else(|| format!("unexpected fetch {path}"))
        });
        assert_eq!(outcome.status, "updated");
        // Only the changed file was fetched; the other was copied.
        assert_eq!(outcome.downloaded, vec!["index.html".to_string()]);
        assert!(root.join(asset_dir("1.0.0+b")).join("assets/app.js").exists());
        assert_eq!(read_pointer(&root).unwrap().previous.as_deref(), Some("1.0.0+a"));
        assert_eq!(read_status(&root).cached_versions.len(), 2);

        // Offline keeps the current bundle.
        let offline = apply_update(&root, None, |_| Err("offline".into()));
        assert_eq!(offline.status, "current");
        assert_eq!(offline.version, "1.0.0+b");

        // Rollback returns to the kept version, which is still on disk.
        let back = rollback(&root);
        assert_eq!(back.status, "rollback");
        assert_eq!(back.version, "1.0.0+a");
        assert_eq!(resolve_active_bundle(&root).unwrap().0, "1.0.0+a");
    }

    #[test]
    fn the_active_bundle_falls_back_when_the_current_one_is_incomplete() {
        let root = temp_root("fallback");
        fs::create_dir_all(root.join(asset_dir("1.0.0+a"))).unwrap();
        fs::write(root.join(asset_dir("1.0.0+a")).join("index.html"), b"v1").unwrap();
        write_pointer(
            &root,
            &Pointer {
                version: "1.0.0+b".into(),
                entry: "index.html".into(),
                previous: Some("1.0.0+a".into()),
            },
        )
        .unwrap();
        let active = resolve_active_bundle(&root).expect("falls back to the kept version");
        assert_eq!(active.0, "1.0.0+a");

        let empty = temp_root("empty");
        assert!(resolve_active_bundle(&empty).is_none());
        assert_eq!(read_status(&empty).current_version, None);
    }
}

#[cfg(test)]
mod serving_tests {
    use super::*;

    fn root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pigma-serving-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Lay down a bundle exactly as `apply_update` does: the tree, the pointer and
    /// the manifest that was kept beside it.
    fn install(root: &Path, version: &str, body: &[u8], previous: Option<&str>) {
        let dir = root.join(asset_dir(version));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("index.html"), body).unwrap();
        let mut assets: BTreeMap<String, String> = BTreeMap::new();
        assets.insert("index.html".into(), sha256_hex(body));
        let manifest = AssetManifest {
            schema: MANIFEST_SCHEMA.into(),
            version: version.into(),
            entry: "index.html".into(),
            assets,
        };
        fs::write(
            root.join(manifest_file(version)),
            serde_json::to_string(&manifest).unwrap(),
        )
        .unwrap();
        write_pointer(
            root,
            &Pointer {
                version: version.into(),
                entry: "index.html".into(),
                previous: previous.map(str::to_string),
            },
        )
        .unwrap();
    }

    #[test]
    fn serves_the_active_bundle() {
        let root = root("active");
        install(&root, "2.0.0", b"<html>cached</html>", None);
        let resolved = resolve_active_bundle(&root);
        assert_eq!(resolved.map(|(v, _, _)| v), Some("2.0.0".to_string()));
    }

    #[test]
    fn falls_back_when_there_is_no_bundle() {
        // The negative that matters most: no cache must NOT brick the window — the
        // caller keeps the bundle baked into the binary.
        let root = root("empty");
        assert_eq!(resolve_active_bundle(&root), None);
    }

    #[test]
    fn refuses_a_bundle_whose_tree_does_not_match_its_manifest() {
        // VERIFICATION AT THE SERVING PATH. A corrupted file with the right name used
        // to pass, because only the entry's EXISTENCE was checked.
        let root = root("corrupt");
        install(&root, "2.0.0", b"<html>cached</html>", None);
        fs::write(root.join(asset_dir("2.0.0")).join("index.html"), b"<html>TAMPERED</html>").unwrap();
        assert_eq!(
            resolve_active_bundle(&root),
            None,
            "a tampered bundle was served",
        );
    }

    #[test]
    fn falls_back_to_the_previous_version_when_the_active_one_is_corrupt() {
        let root = root("rollback");
        install(&root, "1.0.0", b"<html>good</html>", None);
        install(&root, "2.0.0", b"<html>cached</html>", Some("1.0.0"));
        fs::write(root.join(asset_dir("2.0.0")).join("index.html"), b"<html>TAMPERED</html>").unwrap();
        let resolved = resolve_active_bundle(&root);
        assert_eq!(resolved.map(|(v, _, _)| v), Some("1.0.0".to_string()));
    }
}
