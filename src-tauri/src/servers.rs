//! The local MCP server and collaboration relay, started with the app.
//!
//! They run from the sidecar that Tauri ships as a resource: `sidecar/node` runs
//! `relay.mjs` and `mcp.mjs`, which `scripts/prepare-sidecar.mjs` puts there. Both listen on
//! loopback only, and the app stops them when it exits. A development run has no sidecar;
//! the window still opens, and the servers are logged as not started.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

/// The MCP endpoint's port: the same default the desktop info advertises.
pub const MCP_PORT: u16 = 3001;
/// The collaboration relay's port: the same default the desktop info advertises.
pub const RELAY_PORT: u16 = 3002;

/// The servers the app started, so the exit path can stop them.
#[derive(Default)]
pub struct Servers(Mutex<Vec<Child>>);

fn runtime_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

/// The sidecar folder, if the app was packaged with one.
fn sidecar_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().resource_dir().ok()?.join("sidecar");
    dir.join(runtime_name()).exists().then_some(dir)
}

/// Start the supervisor, which runs the relay and the MCP server. Its standard input is a pipe
/// this process keeps open: when the app exits, however it exits, the pipe closes and the
/// supervisor stops both servers.
pub fn start(app: &AppHandle, servers: &Servers) {
    let Some(dir) = sidecar_dir(app) else {
        eprintln!("pigma: no sidecar in this build; MCP and rooms are not served");
        return;
    };
    let relay_port = RELAY_PORT.to_string();
    let mcp_port = MCP_PORT.to_string();
    let spawned = Command::new(dir.join(runtime_name()))
        .arg("supervisor.mjs")
        .args(["--relay-port", &relay_port, "--mcp-port", &mcp_port])
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    match spawned {
        Ok(child) => servers.0.lock().expect("servers lock").push(child),
        Err(error) => eprintln!("pigma: could not start the servers: {error}"),
    }
}

/// Stop the servers: close the supervisor's pipe so it stops them, and give it a moment to exit
/// before the process is killed.
pub fn stop(servers: &Servers) {
    if let Ok(mut children) = servers.0.lock() {
        for child in children.iter_mut() {
            drop(child.stdin.take());
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            while std::time::Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
        children.clear();
    }
}
