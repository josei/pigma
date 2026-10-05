#!/usr/bin/env bash
#
# Bring up (or find) a public preview of the hosted deployment and print its URL.
#
# WHY THIS EXISTS: a Cloudflare QUICK tunnel gets a NEW hostname every time it
# starts, and the deployment must advertise the address users actually reach it
# on - `--public-url` sets both the advertised MCP/relay URLs and the MCP and
# bridge host allowlists. So a restarted tunnel without a restarted deployment
# advertises a dead host AND 403s the live one. This keeps the two in step.
#
# It prints ONE line: the current public origin. Everything else goes to the log.
#
# Usage:  scripts/preview-url.sh [--restart]
#   (default) reuse a healthy tunnel if there is one, else start a new one
#   --restart force a new tunnel and re-point the deployment at it
#
# Notes:
# - A quick tunnel is account-less, EPHEMERAL, has NO UPTIME GUARANTEE, and is
#   for validation, not production (docs/SELF_HOSTING.md).
# - It terminates on 127.0.0.1, so every peer looks loopback: the mint endpoint
#   is open to anyone who knows the URL. That is a property of exposing a
#   loopback service through a tunnel, not of the allowlists.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PIGMA_PREVIEW_PORT:-8788}"
STATE="${PIGMA_PREVIEW_STATE:-/tmp/pigma-preview}"
TUNNEL_LOG="$STATE/tunnel.log"
DEPLOY_LOG="$STATE/deploy.log"
URL_FILE="$STATE/url.txt"
PID_FILE="$STATE/tunnel.pid"

mkdir -p "$STATE"
RESTART=0
[ "${1:-}" = "--restart" ] && RESTART=1

log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >>"$STATE/preview.log"; }

# The current URL, if the tunnel that produced it is still alive.
current_url() {
  [ -f "$URL_FILE" ] || return 1
  local url pid
  url="$(cat "$URL_FILE")"
  pid="$(cat "$PID_FILE" 2>/dev/null || echo)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  curl -sS -o /dev/null --max-time 20 "$url/" || return 1
  printf '%s' "$url"
}

start_tunnel() {
  log "starting a new quick tunnel -> 127.0.0.1:$PORT"
  : >"$TUNNEL_LOG"
  # setsid + all three fds redirected: a child that inherits the caller's
  # stdout keeps the caller's pipe open, so a script that "returns a URL" would
  # hang instead of returning.
  setsid cloudflared tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate \
    </dev/null >>"$TUNNEL_LOG" 2>&1 &
  echo $! >"$PID_FILE"
  # The hostname appears in the banner; poll rather than sleep a fixed time.
  local url=''
  for _ in $(seq 1 60); do
    url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)"
    [ -n "$url" ] && break
    sleep 1
  done
  [ -n "$url" ] || { log "no tunnel URL appeared"; return 1; }
  printf '%s' "$url" >"$URL_FILE"
  printf '%s' "$url"
}

# The deployment must advertise the tunnel's CURRENT origin, or it advertises a
# dead host and refuses the live one.
ensure_deployment() {
  local origin="$1" advertised
  advertised="$(curl -sS --max-time 5 "http://127.0.0.1:$PORT/config.json" 2>/dev/null \
    | sed -n 's/.*"url": *"\([^"]*\)".*/\1/p' | head -1 || true)"
  if [ "$advertised" = "$origin/mcp" ]; then
    log "deployment already advertises $origin"
    return 0
  fi
  log "re-pointing the deployment at $origin (it advertised '${advertised:-nothing}')"
  pkill -f "server/index.ts --port $PORT" 2>/dev/null || true
  sleep 1
  ( cd "$ROOT" && setsid node_modules/.bin/vite-node server/index.ts \
      --port "$PORT" --host 127.0.0.1 --hosted --no-data \
      --public-url "$origin" </dev/null >>"$DEPLOY_LOG" 2>&1 & )
  for _ in $(seq 1 40); do
    curl -sS -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/config.json" && return 0
    sleep 1
  done
  log "deployment did not come up"
  return 1
}

URL=''
if [ "$RESTART" = 0 ]; then URL="$(current_url || true)"; fi
[ -n "$URL" ] || URL="$(start_tunnel)"
ensure_deployment "$URL" >/dev/null 2>&1 || true
printf '%s\n' "$URL"
