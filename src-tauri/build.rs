//! Tauri build script.
//!
//! `Cargo.toml` declares `tauri-build` as a build dependency, but without this
//! file Cargo never invokes it — so `OUT_DIR` is never set and
//! `tauri::generate_context!()` in `src/main.rs` fails with
//! "OUT_DIR env var is not set, do you have a build script?".
//!
//! `tauri_build::build()` reads `tauri.conf.json` (and the icons it references)
//! and generates the context the binary embeds: the window config, the asset
//! resolver and the `pigma://` scheme registration.
fn main() {
    tauri_build::build()
}
