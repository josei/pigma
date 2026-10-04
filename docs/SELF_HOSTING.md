# Self-hosting Pigma

Pigma is userless: there are no accounts, no sign-in, and nothing to provision.
Self-hosting means running one process that serves the built app and relays
collaboration for open documents.

## One command

```sh
docker build -f server/Dockerfile -t pigma .
docker run --rm -p 8080:8080 -v pigma-data:/app/data pigma
```

Then open <http://localhost:8080>. To require a room token:

```sh
docker run --rm -p 8080:8080 -v pigma-data:/app/data \
  -e PIGMA_ROOM_TOKEN=choose-a-token pigma
```

Without Docker, from a checkout:

```sh
npm install
npm run build
npm run relay -- --port 8788 --host 127.0.0.1
```

### The config surface: how the app finds MCP

A self-hosted deployment advertises what it offers at **`GET /config.json`**, so
the MCP panel can enable itself instead of the operator pasting URLs:

```json
{
  "schema": "pigma/config/1",
  "name": "pigma",
  "version": "0.1.0",
  "mode": "server",
  "mcp": { "enabled": true, "url": "http://pigma.example:8080/mcp", "tokenRequired": true, "stdioAvailable": true },
  "relay": { "url": "ws://pigma.example:8080/collab", "tokenRequired": false, "e2e": true }
}
```

- **No secrets.** A token appears only as `tokenRequired: true`; the value is
  never in this payload, and neither is any document, room key or snapshot. That
  is an invariant of `server/config.ts` (`containsSecret` guards it in tests).
- **MCP off is explicit.** Without `--mcp`, `mcp` is `{ "enabled": false,
  "tokenRequired": false, "stdioAvailable": true }`, there is no `url`, and
  `/mcp` is an ordinary 404 — no half-configured endpoint.
- **The advertised URL is the endpoint.** The server mounts the same Streamable
  HTTP transport the desktop app serves on loopback (`createHttpHandler` from
  `src/mcp/transports/http`, bridged by `toNodeHandler`) on its own port, so
  loopback and server deployments run one implementation. `--mcp-token <secret>`
  makes that value the required token (revocable; never advertised), and
  `POST /mcp/token` still mints per-session tokens.
- **stdio stays optional.** The same binary still speaks stdio when started
  without `--http`/`--mcp`; `stdioAvailable` reports that.

Enable it with `--mcp` (or `PIGMA_MCP_ENABLED=1`), optionally `--mcp-path` and
`--mcp-token`:

```sh
npm run relay -- --port 8080 --mcp                       # relay + app + MCP
npm run relay -- --port 8080 --mcp --mcp-token sekret    # …with a required token
```

### Hosted mode (one address, everything)

`--hosted` (or `PIGMA_HOSTED=1`) turns the same entry into the full public
deployment: app + rooms relay + editor bridge + a token-gated MCP endpoint on one
address.

```sh
npm run relay -- --host 0.0.0.0 --port 8080 --hosted --token-ttl 1800000
```

- `/mcp` requires a **per-session token**: `POST /mcp/token` mints one (loopback
  peer or the `X-Pigma-Mint` secret), TTL from `--token-ttl`, `DELETE /mcp/token`
  revokes. `GET /mcp/status` stays open and carries the harness config.
- `/bridge/*` is the editor bridge — how MCP tool calls reach a user's live
  document. Its token comes from `--bridge-token`/`PIGMA_BRIDGE_TOKEN` and is
  printed on stdout for the operator; it is never advertised.
- `/config.json` reports `mcp.url`, `mcp.tokenRequired`, `bridge.enabled` and the
  relay URL, with no secrets (the bridge token included).
- **No log, no store**: MCP traffic is never logged (payloads, arguments,
  results, documents — success or error path) and never written to disk; the only
  file writes are room snapshots, a separate TTL-cached path. `/health` and
  `/metrics` are aggregate-only. See
  [`MCP.md`](./MCP.md#hosted-deployment-getpigmacom) for the full policy and the
  tests that assert it.

### Running a local relay (editor, QA, browser tests)

One entry, `server/index.ts`, serves the built app and the relay. Flags win over
the environment, `--help` prints them all:

```sh
npm run relay -- --port 8788 --host 127.0.0.1            # serve dist/ + relay
npm run relay -- --port 8788 --no-data                   # snapshots in memory
npm run relay -- --port 8788 --no-data --no-static       # relay only
npm run relay -- --port 0 --no-data                      # any free port
```

On startup it prints the listening URL and one machine-readable line, so a test
can wait for readiness instead of scraping the banner:

```
pigma collab relay listening on http://127.0.0.1:8788
  room endpoint: ws://127.0.0.1:8788/collab?room=default
  ...
relay ready {"url":"http://127.0.0.1:8788","port":8788}
```

**Spawn it from the `vite-node` binary directly, not through `npm`/`npx`:**

```ts
// Playwright / vitest: one relay per run, stopped cleanly afterwards.
const relay = spawn('node_modules/.bin/vite-node', ['server/index.ts', '--port', '0', '--host', '127.0.0.1', '--no-data'], { cwd: repoRoot });
const port = await waitForLine(relay, /relay ready \{"url":"[^"]+","port":(\d+)\}/);
// … run the two contexts …
relay.kill('SIGTERM');   // exits 0, releases the port
```

`npm run relay` is for interactive use (Ctrl-C works). A supervisor or test that
signals the **npm** process must not expect that to reach the relay: npm does not
forward `SIGTERM` to the script it spawned (measured with npm 11.17: the relay kept
listening and the `npm exec`/`sh`/`vite-node` chain stayed behind). Signalling the
`vite-node` binary directly exits `0`, releases the port, and leaves nothing
behind — that is what `tests/collab/relay-cli.test.ts` asserts.

**Orphan guard.** If the process that started the relay dies *after* it is up
without signalling it — a crashed supervisor, a `SIGKILL`ed wrapper — nothing will
ever signal the relay again, so it must not linger. The guard notices the
reparenting within ~2 s and shuts down cleanly; `--no-orphan-guard` disables it.

Two limits, stated rather than implied:

- It cannot see a parent that was already gone before the relay's module started
  (the OS does not keep the original parent id around), so it is a safety net for
  a supervisor that dies later, not a substitute for signalling the process.
- It cannot help when an *intermediate* wrapper survives. `npm run relay` is the
  example: killing npm leaves `sh` alive, so the relay's parent never goes away.
  That is why tests and supervisors spawn the `vite-node` binary directly.

Both behaviours are covered by `tests/collab/relay-cli.test.ts`.

## Configuration

Flags win over these; every one also has a flag (`--port`, `--host`, `--token`,
`--data-dir`, `--no-data`, `--static-dir`, `--no-static`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Listen port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `STATIC_DIR` | `dist` | Built assets to serve (skipped if missing). |
| `DATA_DIR` | `data` | One snapshot file per room. |
| `PIGMA_ROOM_TOKEN` | unset | Optional room token required on the WebSocket URL. |

Nothing else is configurable: there is no database, no migration step, and no
admin surface.

## What the server is

A **room relay plus a last-snapshot per room**:

- `GET /collab?room=<document-id>&token=<token>` — WebSocket. Participants join
  with a `hello` carrying their locally generated `clientId` and a nickname.
- `GET /health` — liveness and room count. No user data.
- `GET /<asset>` — the built app. Pigma has no client-side URL routing, so
  there is no SPA fallback: anything that is not a real file is a 404.
- Anything else — 404. With the app served, `/login`, `/users`, `/api/*` and
  friends are still 404: there is no auth route to reach.

Snapshots are written atomically to `DATA_DIR/<room>.json`, one JSON blob per
room, containing the document a client sent and the sequence it covers. The
server never interprets the document format; ops and snapshots are opaque.

## No accounts — and nothing that resembles them

- A participant is `{ clientId, nickname, color }`. `clientId` is random and
  generated by the client; it is only used to route messages.
- The nickname is a presentation string for cursor labels. It is echoed to other
  participants, is never unique, never validated as identity, never stored
  server-side, and is gone when the socket closes.
- The colour is derived from `clientId` (deterministic hash), so nothing about
  it needs storing or agreeing.
- There is no user table, no session store, no roles, no permissions, no invite
  flow, no audit log, and no auth endpoint. `/login`, `/signup`, `/auth/*`,
  `/users`, `/api/*`, `/me`, `/session` are all 404 — this is asserted in
  `tests/collab/relay.test.ts`.
- The only access control is the optional room token in the URL, the same idea
  as the MCP relay token. Leave it unset on a trusted network; set it when the
  port is reachable by others.

## Local-first

Clients keep working offline. The relay forwards ops and stores the last
snapshot a client sent; a late joiner receives that snapshot (plus the room
sequence number) so it converges. Because ops are relayed verbatim and the
snapshot is client-produced, the server has no document model and no conflict
resolution of its own — last-writer-wins, which is what a small self-hosted
relay can honestly promise.

## Encryption: what the relay can and cannot see

Room document payloads are **end-to-end encrypted**. The room key is generated in
the browser, shared in the URL **fragment** (`https://host/#room=…&key=…`), and
never sent to the server — a fragment is not part of an HTTP request, and the
WebSocket URL is built from the room id alone.

| The operator **can** see | The operator **cannot** see |
| --- | --- |
| Room id | Document content (nodes, geometry, text, paints) |
| Participant count, join/leave timing | Ops (edits) |
| Nicknames, colours | Snapshots |
| Cursor positions, selection node ids | The room key |
| Message sizes, sequence numbers, timings | Anything derived from the document |
| IP addresses (for the abuse bounds above) | — |

**Presence is plaintext by design.** A nickname is a presentation label the user
chose to show the other participants; a colour is derived from the client id; a
cursor is a position and a selection is a list of opaque node ids. None of them is
document content, and encrypting them would not hide the room's activity pattern
(sizes and timings are visible regardless) while making the relay's echo and
label logic pointless. If you need presence hidden too, run the relay yourself —
it is one process.

### Crypto design

- **Key**: 32 random bytes (`crypto.getRandomValues`), generated on Share,
  carried only in the fragment.
- **Derivation**: HKDF-SHA256 from that key, with the room id as salt and the
  payload purpose as `info` (`doc`). Purposes are separated, and the same raw key
  in another room derives a different key.
- **Cipher**: AES-256-GCM, a fresh random 96-bit IV per message, IV and
  ciphertext carried as base64url in an envelope `{ "v": 1, "iv": …, "ct": … }`.
- **Binding**: the room id and payload kind are additional authenticated data, so
  a ciphertext cannot be replayed into another room or as another kind.
- **Failure**: a wrong key, a tampered ciphertext, or a cross-room/cross-kind
  substitution fails authentication; the client reports it and applies nothing.

### Refusal semantics (no silent plaintext)

- A client **refuses to join without a key** unless the caller explicitly opts
  into plaintext mode, in which case the room is labelled `plaintext` in the UI.
- The relay fixes a room's mode at the first join. A client that disagrees is
  refused (`mode-mismatch`, close `1008`), so a plaintext client cannot sit in an
  encrypted room — or the reverse.
- In an encrypted room the relay **refuses plaintext document payloads**
  (`plaintext-rejected`, close `1008`) and stores nothing. That is what turns
  "zero-knowledge" from a promise into something the server enforces; the counter
  `pigma_plaintext_rejected_total` records it.

### What E2E does not cover

- **Traffic analysis**: the relay still sees room ids, participant counts,
  message sizes, sequence numbers and timings.
- **Availability**: the relay is the transport, so it can drop, delay, duplicate
  or reorder messages. Clients detect tampering (GCM), not omission.
- **Compromised clients**: a participant with the key can read the room, and a
  key that leaks is as good as the document. Share links are capabilities.

## Capacity

The relay is a room relay plus a snapshot cache, so capacity is bounded by
design: nothing grows with the number of documents ever opened. Every bound has a
generous default and an environment override.

| Bound | Default | Env |
| --- | --- | --- |
| Participants per room | 32 | `PIGMA_MAX_ROOM_PEERS` |
| Concurrent sockets per IP | 16 | `PIGMA_MAX_CONNECTIONS_PER_IP` |
| Upgrade attempts per IP per minute | 30 | `PIGMA_CONNECTION_ATTEMPTS_PER_MINUTE` |
| Relay messages per IP per window | 1800 | `PIGMA_MESSAGES_PER_WINDOW` |
| Message window | 10 s | `PIGMA_MESSAGE_WINDOW_MS` |
| Idle empty room TTL | 10 min | `PIGMA_ROOM_TTL_MS` |
| Snapshot TTL | 24 h | `PIGMA_SNAPSHOT_TTL_MS` |
| Sweep interval | 60 s | `PIGMA_GC_INTERVAL_MS` |

What happens at a bound:

- **Connections per IP** — the upgrade is refused with `429` and `Retry-After`
  before the WebSocket handshake, so no resources are spent on it.
- **Upgrade attempts per IP** — same `429`; this is what stops a connect/close
  loop from being cheaper than holding a socket.
- **Participants per room** — the join is answered with a
  `{ "t": "error", "code": "room-full" }` message and the socket closes with
  `1013`. A reconnect for a participant already in the room is not a new peer.
- **Messages per IP** — the socket is closed with `1008` (policy violation). The
  default is ~180 messages/second, well above a drag emitting a cursor per frame,
  so this only ever catches a runaway client.
- **Room TTL** — a room with no participants and no activity for the TTL is
  dropped, and its snapshot with it (file removed).
- **Snapshot TTL** — snapshots are a **cache, not storage**: after the TTL the
  entry is dropped even if the room is still open, and a late joiner simply
  starts from nothing rather than from a stale document. Point `DATA_DIR` at
  something you are willing to lose; the authoritative copy of a document lives
  with its clients.

Upgraded sockets enable TCP keepalive (30 s), so a peer that vanishes without a
close handshake — a crash or a dropped network — is reclaimed in bounded time
rather than holding an address slot until the OS gives up. There is no
application-level heartbeat: a live client never has to answer anything.

Memory per room is one snapshot blob plus one small presence record per
participant. A room with 32 participants costs kilobytes, so the practical
ceiling is the number of *concurrently open* documents, not the number ever
opened — that is what the room TTL and snapshot TTL enforce.

### Health and metrics

- `GET /health` — JSON: `{ ok, uptimeMs, rooms, participants, connections,
  snapshots, limits, metrics }`. No user data, no nicknames.
- `GET /metrics` — the same numbers in Prometheus text format
  (`pigma_rooms`, `pigma_participants`, `pigma_connections`,
  `pigma_connections_rejected_total`, `pigma_peers_rejected_total`,
  `pigma_messages_in_total`, `pigma_messages_out_total`,
  `pigma_rate_limited_total`, `pigma_snapshots_stored_total`,
  `pigma_snapshots_expired_total`, `pigma_rooms_swept_total`).

Both are safe to expose to a scraper: they describe capacity, never people.

## Wire protocol (version 1)

JSON text frames over one WebSocket per participant.

Client → server:

| Message | Fields |
| --- | --- |
| `hello` | `clientId`, `nickname` |
| `cursor` | `x`, `y` |
| `selection` | `ids[]` |
| `ops` | `ops[]` (opaque) |
| `snapshot` | `file` (opaque), `seq` |
| `ping` | — |

Server → client:

| Message | Fields |
| --- | --- |
| `welcome` | `protocol`, `room`, `self`, `peers[]`, `seq`, `snapshot` |
| `peer-join` / `peer-leave` | `peer` / `clientId` |
| `cursor` / `selection` | `clientId`, `nickname`, `color`, plus `x`/`y` or `ids` |
| `ops` | `clientId`, `ops[]`, `seq` |
| `snapshot` | `clientId`, `file`, `seq` |
| `error` | `code`, `message` |
| `pong` | — |

The server assigns `seq` to each relayed op; a `snapshot` carries the `seq` it
covers, so a joiner can ignore anything at or below it. Presence messages are
never echoed to their sender.

## Transport note

The WebSocket server is implemented on Node's `http` upgrade in
`src/collab/websocket.ts` — text frames (fragmented or not), ping/pong, and the
close handshake, with masking enforced and every message bounded by a payload
cap. Text messages are UTF-8 validated when complete (close 1007 on invalid
data, which is why a multibyte character may be split across fragments); control
frames must use the 7-bit length form and must not be fragmented (1002); a close
payload of exactly one byte is invalid (1002); and binary messages are accepted
at the framing level and discarded, with fragmented binary tracked so its
continuations are consumed rather than misread. This keeps the relay free of
runtime dependencies, so the image needs no extra install and the build cannot
drift. The tradeoff is deliberate: no extensions, no subprotocol negotiation,
and no binary payload reaches the application. If you would rather run `ws`, the
transport is isolated behind `acceptWebSocket`/`WebSocketConnection` in that one
file.

## MCP from the same server

The self-host image serves the MCP endpoint too, over Streamable HTTP:

```sh
docker run --rm -p 8080:8080 -v pigma-data:/app/data pigma   npx vite-node src/mcp/bin.ts --http --host 0.0.0.0 --port 8080
```

No session token is required by default, which is the right default when the
port is only reachable by you. Add `--hosted` to require a per-session,
short-lived, revocable token, and read the harness config from
`GET /mcp/status`. See [`MCP.md`](./MCP.md#token-lifecycle-hosted-mode) for the
token lifecycle and the per-harness snippets.

## Tests

```sh
npx vitest run tests/collab
```

Two real WebSocket clients with different nicknames exchange cursors, selections,
and document ops; a late joiner converges on the stored snapshot; the framing
edge cases (masking, fragmentation, 16/64-bit lengths, ping/pong, close codes)
are driven through a raw socket; and the no-account guarantee is asserted
against the HTTP surface, the server's public API, and the persisted snapshot.
