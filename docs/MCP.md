# Pigma MCP Server

A Model Context Protocol server exposing **Figma's MCP tool catalog**
(`get_design_context`, `get_metadata`, `get_screenshot`, `use_pigma`, …)
implemented against the Pigma document model, plus a **live browser bridge** so
an external MCP client can edit the running editor.

Protocol-generic: JSON-RPC 2.0 over stdio and Streamable HTTP, usable by **any**
MCP client. No client, vendor, or harness allowlist — unknown client names are
accepted (and tested).

> **Not Figma's hosted server.** Tool names, arguments, and workflows are
> implemented locally. Where the hosted server needs Figma cloud, a codebase, or
> Code Connect, the difference is listed under [Parity gaps](#parity-gaps).

## Naming: Pigma names its own tools

**The rule:** tool and capability NAMES are Pigma's. Figma appears in two other
places only:

1. **in DESCRIPTIONS**, as the compatibility statement — the tool is
   Figma-compatible in shape and dialect so Figma-style instructions and
   Figma-configured harnesses work unchanged, and where the dialect is Figma's
   (`use_pigma` executes the **Figma Plugin API** dialect) the description says so;
2. **in identifiers that genuinely name a Figma artifact or API** — native
   `.fig`/`.deck`/`.jam` import and export, the Figma REST API, Figma-compatible
   node types such as `BOOLEAN_OPERATION`, and `get_figjam`, which names the
   artifact being requested (a FigJam board) the way `.fig` names a file format.

### Why we moved off the brand (do not move it back)

A Figma-branded **tool name tells the model it is talking to Figma**, so an agent
may go looking for the design at figma.com — a cloud fetch for a document that
lives on this machine. The name is a misleading affordance. So the names are
Pigma's, and the Figma relationship is stated in the descriptions instead, where
it is read as a compatibility fact rather than as an address.

The cost of the rename is real but bounded: a client whose **configuration**
carries a tool allow-list, or a saved skill or prompt written against the old
names, has to be updated. A **model** does not depend on names at all — it selects
tools from the `tools/list` descriptions — so a renamed tool with a self-sufficient
description works identically.

### Migration table

| Old name (pre-2026-10) | Current name | Why it moved |
| --- | --- | --- |
| `use_figma` | `use_pigma` | The tool runs a Figma **dialect** script in Pigma's own sandbox, against a **local** document; the name implied Figma was executing it. |
| `generate_figma_design` | `generate_pigma_design` | Names the implementer; the description states the Figma relationship (Figma captures live web UI; Pigma has no capture backend). |
| `get_figjam` | `get_figjam` (**unchanged**) | Names the artifact requested (a FigJam board), like `.fig` names a file format, and it is a capability-error tool that answers "Pigma has no FigJam support" — it cannot send anyone to Figma. |

Calling an old name is not a silent failure: the server answers
`Unknown tool "use_figma": it was renamed to "use_pigma" …` (see
`RENAMED_TOOLS` in `src/mcp/protocol.ts`).

### Renaming is allowed, but it must be deliberate

What is forbidden is **drift** — a name changing by accident, or a description
still referring to a name that no longer exists. A deliberate rename needs:

1. every affected description updated (they are what a model reads), including
   the **alternatives lists inside other tools' descriptions**, which name tools
   to the model;
2. a row added to the **migration table** above, so a reader with a saved config
   or skill can find the replacement;
3. the pinned name sets updated (`tests/mcp/toolCatalog.test.ts`,
   `tests/mcp/naming.test.ts`) and a `RENAMED_TOOLS` entry added so old names
   answer with the replacement.

`tests/mcp/naming.test.ts` asserts the current names and the consistency rules
above; its failure messages point at this procedure.

### Locality: the document is on this machine

The names are only half of the misleading-affordance problem. Every description
that could be read as a cloud operation says the document is **local** — a local
file, or the editor connected over the bridge — and that **nothing is fetched from
Figma**. The server's `initialize` instructions carry the same statement, because
that is the one string every harness reads before it chooses a tool.

Owner: `src/mcp/**`, `tests/mcp/**`, `bridge.html`, this file.

---

## Running

```bash
# stdio
npx vite-node src/mcp/bin.ts --file design.fig

# Streamable HTTP (loopback by default)
npx vite-node src/mcp/bin.ts --file design.fig --http --port 3001

# Live editor bridge: MCP on 3001, browser relay on 3002
npx vite-node src/mcp/bin.ts --bridge --port 3001 --relay-port 3002
```

`--file` accepts a native `.fig`/`.deck`/`.jam` archive, a Figma REST response,
or a Pigma document. Pigma JSON is validated with the project validator. Writes
persist **atomically** (temp file + rename) back to the Pigma JSON input, or to
`--out`; REST/native imports are never converted in place (they are read-only
without `--out`), and memory is only committed after a successful disk write.

npm script (requested from the app owner, not yet added):
`"mcp": "vite-node src/mcp/bin.ts"`.

---

## Live browser bridge

A browser cannot accept inbound connections, so the editor connects **out** to a
local relay; external MCP clients connect to the MCP server, which proxies the
document to the browser.

```
external MCP client ──(stdio | HTTP)──▶ MCP server ──▶ RelaySession
                                                          │  SSE /bridge/events
                                                          ▼
                                            running editor (browser)
                                                          │  POST /bridge/result
                                                          ▼
                                                        relay
```

- Relay: `src/mcp/relay.ts` (`startRelayServer`) — SSE commands, token, loopback
  and Host/Origin validation.
- Browser client: `src/mcp/browserClient.ts` (`connectBridge`).
- Connect UX: `src/mcp/BridgePanel.tsx` (mount in the editor) — explicit
  Connect/Disconnect, status, URL + token fields. No dev-only globals.
- Standalone window: `bridge.html` (`src/mcp/bridgeEntry.tsx`) renders the real
  `App` and connects via
  `?relay=http://127.0.0.1:3002&token=<token>` (`&blank=1` for an empty doc).
- Bridge session: `src/mcp/bridge.ts` `createEditorSession(useEditor)` — reads
  the live file/selection; writes go through the store's `apply`, so remote edits
  are **undoable** like any editor action.
- Multi-window safety: each browser connection sends a connection id, and the
  relay mirrors **only the active (most recent) editor's** pushes, so a second
  connected window cannot clobber the live selection. When the active window
  disconnects, the next one is promoted and the mirror is refreshed from it.
- `get_metadata` resolves a page id to that page's children outline, a document
  id to every page's nodes, and only returns the pages list for an unknown id
  (the documented recovery path) or when no `nodeId` and no selection exist.

Verified end-to-end: an external MCP client created a frame in a running browser,
the layers panel updated, and `Ctrl+Z` restored the exact baseline document
(screenshot: `/tmp/pigma-mcp-bridge-e2e.webp`).

---

## Writing: what a caller can rely on

Three behaviours a harness must know before it writes. They hold on **every** path
— an in-memory session (stdio or HTTP with a loaded file, and a self-hosted or
hosted endpoint without a bridge) and the live-editor session (the browser bridge)
— because all of them share one implementation in `src/mcp/session.ts`.

### Every write settles, validates, and refuses a stale revision

1. **Derived geometry is settled first.** Auto-sized text boxes follow their
   content, `BOOLEAN_OPERATION` nodes re-evaluate, instances sync, the tree
   reflows (`settleDocument`). A document built entirely through these tools never
   has stale derived geometry — `get_metadata`, `get_design_context` and
   `get_screenshot` all read the settled boxes.
2. **The document is validated.** A write that would produce an invalid document —
   a negative or non-finite size, an opacity outside 0..1, a malformed paint or
   effect colour — is refused with `The document this write would produce is
   invalid: …` naming the node and the problem. Nothing is stored, so the previous
   document survives intact.
3. **A stale write is refused.** See the revision contract below.

The ordering matters: the revision is checked first (fail fast on a stale write),
then the document is settled, then validated — and all of it happens **before** the
editor store sees anything, so a refused write leaves the document *and the undo
history* untouched.

Evidence: `tests/mcp/write-revision.test.ts` (the guard, and that all sessions throw
one shared message), `tests/mcp/bridge.test.ts` (the live-editor session runs the
same settle + validate), `tests/mcp/invariants.test.ts` (the hostile-script
matrix), `tests/browser/b55-mcp-invariants.spec.ts` (the same, at browser level
through the live bridge).

### The revision contract

A document has a **revision** that advances on every accepted write (and on every
accepted selection change). A write is guarded by the revision its author read:

- **How a caller obtains it.** You do not have to: every write tool reads its own
  authoritative snapshot — the file *and* the revision — and carries that revision
  into the write it performs. There is no `expectedRevision` argument to pass, and
  no tool result exposes the counter; the tool call is the unit of consistency.
  (The bridge's own `/bridge/status` reports a revision for the editor panel — it
  is how the panel shows "connected" — but it is not part of the tool surface and a
  harness never needs it.)
- **What can go wrong.** If the document changes *between* the tool's read and its
  write — the user draws, moves or undoes something in the editor while the call is
  in flight — the write is refused with
  `stale revision: editor is at <current>, caller read <expected> (local changes
  happened in between)`.
- **What to do about it.** Re-read and retry: call the read tool again
  (`get_metadata`, `get_design_context`, …) and issue the write once more against
  what you just read. Do not guess the revision and do not retry blindly — the
  error names both numbers, so a retry loop that re-reads converges.
- **In-memory sessions** count revisions per session from 0; the live editor counts
  its own. Either way a write carrying an older revision is refused rather than
  silently overwriting a newer document.

### Undo and history differ between the two paths — deliberately

| Path | Effect on undo history |
| --- | --- |
| **In-memory session** (stdio, HTTP with a loaded file, self-host, hosted without a bridge) | **No undo history at all.** The document is a value the server holds; there is nothing to undo, and a caller that wants the previous state must have kept it. |
| **Live editor** (browser bridge) | **Exactly one undo entry** per accepted write, so `Ctrl+Z` in the editor undoes the whole tool call. **No entry** when the write changes nothing, and **no entry** when the write is refused (stale revision, invalid document) — a refusal never pollutes the user's history. |

A write that changes nothing is a no-op on both paths: the same file object comes
back, so nothing downstream sees a spurious change.

### What is *not* guaranteed

The settle and validation passes are the ones named above
(`settleDocument` → `syncTextSizes`, `syncInstances`, `reflowTree`,
`refreshBooleans`; `documentProblems`). That is a survey of the write path's call
sites, **not a proof that the whole path is O(n) in the document**: the passes are
pure and idempotent, an unchanged document short-circuits to the same object, and
measured cost tracks *what changed* rather than the document size — but a tool that
rewrites a large part of the document still pays for that part, and nothing here
claims otherwise.

## Supported tools

Read: `get_design_context` (React + Tailwind code by default; `framework:
react|html`, `styling: tailwind|css`, structured context included),
`get_metadata` (XML outline; page list fallback), `get_screenshot` (**PNG** via
`@resvg/resvg-js`; `format:"svg"` optional, `scale` 0.01–4), `download_assets`
(inline data URLs), `get_variable_defs` (variable bindings resolved to name,
type, collection, and the value under the active mode; styles resolved against
the file styles table), `get_libraries` (component/component-set/style/variable
counts from the model, plus collections with their modes and active mode),
`search_design_system` (components, component sets, styles, and variables),
`get_code_connect_map`, `get_motion_context`.

`get_design_context` projects the full model: geometry and paints, plus
`componentPropertyReferences` (which component property drives which field),
resolved variable bindings (`variables`, with the active-mode value), resolved
style bindings (`styles`), `windingRule` and `rectangleCornerRadii` for
paths/corners, variant `componentPropertyDefinitions` on components and sets,
and `resolvedProperties` on instances. The projection also carries the file's
`styles` / `variableCollections` / `variables` tables so consumers can resolve
the ids they see on nodes.

Platform: `whoami` and `generate_pigma_design` return explicit capability
results (no accounts/cloud; no code-to-canvas backend). `generate_diagram`
builds a real diagram from Mermaid flowchart syntax; `get_figjam` returns an XML
outline plus PNG screenshots with an honest `capabilities` block. The generative
plugin and shader families (`list_generative_plugins`, `get_generative_plugin`,
`create_generative_plugin`, `update_generative_plugin`, `list_shaders`,
`list_file_shaders`, `get_shader`, `create_shader`, `update_shader`) are
registered and each returns an explicit capability result — they need Figma's
account library and build/shader runtime, which Pigma does not have. The Weave
family (`weave_list_tools`, `weave_get_tool_inputs`, `weave_upload_asset`,
`weave_run_tool`, `weave_get_tool_run_output`, `weave_cancel_tool_run`) is
registered with Figma's parameter shapes and likewise answers with an explicit
capability result: Weave runs published workflows on weavy.ai and needs a Weave
account, workspace, and credits.

Write: `use_pigma` (see below), `create_new_file`, `upload_assets`,
`add_code_connect_map`, `send_code_connect_mappings`,
`get_code_connect_suggestions`, `get_context_for_code_connect` (mappings persist
in `file.meta.codeConnect`; suggestions never fabricate a source path).

### `use_pigma` — real Plugin API scripts, isolated

`use_pigma` accepts **Figma Plugin API script code** and runs it in a QuickJS
(WASM) sandbox. The engine is shared with the in-app editor
(`src/plugins/engine.ts` + `src/plugins/host.ts`; the Node loader lives in
`src/mcp/plugin/`) so plugins behave identically in both — see
[`PLUGINS.md`](./PLUGINS.md) for the API, the loader contract, and the
guarantees:

- no host filesystem, network, process, `require`, or host `eval` — only the
  Plugin API bridge is exposed (tested: `require`/`process`/`fetch`/`__pigma*`
  are all `undefined` inside the sandbox);
- memory (32 MB), stack (1 MB) and wall-clock (2 s, `timeoutMs`) limits;
- synchronous scripts only.

Supported subset:

- factories: `figma.createFrame|Rectangle|Ellipse|Line|Polygon|Star|Text|Vector|Component`,
  `figma.combineAsVariants(nodes, parent)` (one VARIANT property per
  `Property=value` name axis, as Figma derives it), and the boolean operations
  `figma.union|subtract|intersect|exclude(nodes, parent)` (backed by the model's
  boolean engine; operands stay as children of the `BOOLEAN_OPERATION`);
- globals: `figma.currentPage` (`children`, `appendChild`, `selection` get/set),
  `figma.getNodeById`, `figma.root`, `figma.closePlugin`, `figma.notify`,
  `figma.loadFontAsync` (resolves immediately), `figma.on/once/off`
  (`run` is delivered — see below; other events log a note),
  `figma.parameters` (`values` plus a no-op `on('input')` that logs the missing
  parameter UI);
- node properties: `name`, `x`, `y`, `width`, `height`, `opacity`, `visible`,
  `fills`, `strokes`, `characters`, `cornerRadius`, `rotation`, `layoutAlign`,
  `layoutGrow`, `vectorPaths`, `windingRule`, `rectangleCornerRadii`,
  `effects`, `description`, `styles` (style ids by property), `boundVariables`
  (variable ids by property), `componentPropertyReferences`, and
  `componentProperties` on instances, `componentId`, and `mainComponent`
  (a node reference, as Figma exposes it); `instance.setProperties({...})`
  switches a VARIANT property to the matching variant and sets the rest; plus
  the auto-layout set (`layoutMode`,
  `itemSpacing`, `padding*`, `primaryAxisSizingMode`, `counterAxisSizingMode`,
  `primaryAxisAlignItems`, `counterAxisAlignItems`, `layoutWrap`,
  `layoutSizingHorizontal/Vertical`);
- node methods: `resize`, `appendChild`, `remove`, `createInstance`
  (materializes a component subtree as an `INSTANCE` with `componentSnapshot`);
  `figma.createInstance()` instances the single selected COMPONENT;
- **result**: `output` (the completion value or the `figma.on('run')` handler's
  value), `logs` (full transcript), `warnings` (input the engine converted or
  skipped rather than honoured, e.g. a `vectorNetwork` assignment becoming
  `pathData`), and `closed`;
- **async/await**: scripts may `await`; the interpreter drains QuickJS's job
  queue. Synchronous scripts keep eval's completion value as `output`; async
  scripts should `return` their value;
- **plugin parameters**: `use_pigma` accepts `parameters` (an object) and
  `command`. As in Figma, they are delivered to the `figma.on('run', handler)`
  event (`{ command, parameters }`); when no parameters are passed the run
  event's `parameters` is `undefined`, exactly as Figma documents. If a script
  registers a `run` handler, that handler's return value (awaited if it is a
  promise) is the tool `output`. `figma.parameters.values` additionally exposes
  the values directly (a Pigma convenience, since there is no interactive
  parameter UI to drive suggestions).

`node.vectorNetwork = {...}` is **converted to `pathData`** and logged; the
network itself is not retained (Pigma has no vertex/segment store). Reading
`node.vectorNetwork` (or `vectorNetworkAsync`) therefore throws an explicit
unsupported error naming the alternative (`node.vectorPaths`, or assigning a
network to convert its geometry) instead of returning a misleading `null`.

Anything else fails with an explicit unsupported error — `figma.ui`,
`figma.showUI`, unknown node members. Unknown members report the supported list.
These are never silently ignored.

A declarative `operations` list (Plugin-API-shaped calls) is kept as a secondary
interface.

---

## Resources and prompts

`pigma://document`, `pigma://document/metadata`, `pigma://document/selection`;
`resources/templates/list` answers with an empty template list (Pigma exposes
concrete document resources only; Figma's own source-file resources are dynamic
and require its account library, which Pigma does not have);
prompt `create_design_system_rules` (Figma's published prompt name and shape:
it asks the agent to write a rules file for design-system-aware code generation,
using the Pigma tools as sources of truth).

---

## Transports: Streamable HTTP, with stdio as an extra

**Streamable HTTP is the transport for every deployment**; `stdio` stays
available in the same binary for harnesses that require it. The only variable
between hosts is the endpoint URL:

| Deployment | Endpoint | Token |
| --- | --- | --- |
| Hosted (getpigma.com) | `https://getpigma.com/mcp` | **per session**, minted by `POST /mcp/token` |
| Desktop app / `pigma mcp --http` | `http://127.0.0.1:<port>/mcp` | none |
| Docker / self-host | `http://<server>:<port>/mcp` | none by default; `--mcp-token <secret>`, or `--hosted` to mint per-session tokens |
| Self-host at a public address | `https://<your-host>/mcp` | recommended (`--mcp-token` or `--hosted`) |

**The hosted endpoint works with no download** (decision 2026-10-03, docs/ROADMAP.md):
getpigma.com serves MCP through the relay, so Claude/ChatGPT can drive Pigma
straight away. The relay executes the tools over the bridge, so it necessarily
sees tool calls — accepted, under a hard policy that it **logs nothing and stores
nothing** of MCP traffic (aggregate counters only, never payloads). The desktop
app and self-hosting remain available for users who want the endpoint on their own
machine. A controllable deployment advertises its endpoint at `GET /config.json`
— see
[`SELF_HOSTING.md`](./SELF_HOSTING.md#the-config-surface-how-the-app-finds-mcp) —
and the desktop app reports the same facts over `desktop_info`.

#### Deploying the hosted endpoint

The relay entry serves everything on one address — the app, the rooms relay, the
editor bridge and `/mcp`:

```sh
npm run relay -- --host 0.0.0.0 --port 8080 --hosted --token-ttl 1800000 \
  --data-dir /var/lib/pigma/rooms
# or: PIGMA_HOSTED=1 HOST=0.0.0.0 PORT=8080 PIGMA_MCP_TOKEN_TTL_MS=1800000 \
#     PIGMA_BRIDGE_TOKEN=<operator-secret> npm run relay
```

| Surface | Path | Notes |
| --- | --- | --- |
| The app | `/` | built static assets |
| Rooms relay | `/collab` | WebSocket; document payloads are end-to-end encrypted client-side |
| Editor bridge | `/bridge/*` | how tool calls reach a user's **live** document; token from `--bridge-token`/`PIGMA_BRIDGE_TOKEN`, printed on stdout for the operator, never advertised |
| MCP endpoint | `/mcp` | Streamable HTTP; per-session tokens required |
| Config surface | `/config.json` | `mcp.url`, `mcp.tokenRequired`, `bridge.enabled`, relay URL — no secrets |
| Health / metrics | `/health`, `/metrics` | aggregate counters and gauges only |

`--mcp-token <secret>` remains available for a self-host that wants one fixed
token instead of per-session minting; `--mcp` alone serves `/mcp` with no token.

#### No log, no store

Nothing about MCP traffic is logged — no payload, no tool arguments, no results,
no document — on the success path or the error path — and nothing is written to
disk or any database. The only file the server writes is a **room snapshot**: a
separate path, TTL-cached, which never receives MCP traffic. `/health` and
`/metrics` are aggregate-only (`pigma_*` counters and gauges).

`tests/collab/hosted.test.ts` asserts exactly that, end to end: a real
`tools/call` carrying a distinctive marker, driven through a live bridge editor
(so the call really executes), whose marker appears in **no** log line on either
stream, in **no** file under the data directory, and in no health/metrics body —
including a failing call whose error carries the marker back to the caller.

```sh
npx vite-node src/mcp/bin.ts --http --port 3001            # loopback / self-host
npx vite-node src/mcp/bin.ts --http --port 3001 --hosted   # require a session token
npx vite-node src/mcp/bin.ts                               # stdio, unchanged
```

### Token lifecycle (hosted mode)

A token is a **capability, not an identity**: it names a session, never a person.
There is no user record, no account, and nothing to sign in to.

- **Off unless enabled.** Without `--hosted` (or `PIGMA_MCP_HOSTED=1`) no token
  is required, and `POST /mcp/token` does not exist (404). Loopback and
  self-host deployments need nothing.
- **Minted per session.** `POST /mcp/token` returns a fresh
  `pigma_<64 hex>` token — the only response that ever contains the raw value.
  Minting is allowed from a loopback peer, or from anywhere with the operator's
  `X-Pigma-Mint` secret (`--mint-token`, `PIGMA_MCP_MINT_TOKEN`).
- **Short-lived.** TTL defaults to 30 minutes (`--token-ttl <ms>`,
  `PIGMA_MCP_TOKEN_TTL_MS`). An expired token is refused with `expired`.
- **Revocable.** `DELETE /mcp/token` with the token revokes it immediately;
  shutdown revokes every live session.
- **Presented as** `Authorization: Bearer <token>` or `X-Pigma-Token: <token>`.
  A refused request gets `401` with `WWW-Authenticate: Bearer` and a JSON-RPC
  error naming the reason (`unknown`, `expired`, `revoked`).

Every session list the server exposes is masked: the status surface never
contains a raw token.

### `/mcp` status surface

`GET /mcp/status` (reachable without a token) returns:

```json
{
  "ok": true,
  "transport": "streamable-http",
  "endpoint": "http://127.0.0.1:3001/mcp",
  "mode": "loopback",
  "tokenRequired": false,
  "tokenTtlMs": null,
  "sessions": [],
  "harnessConfig": [ { "id": "claude", "label": "Claude Code", "path": ".mcp.json", "format": "json", "content": "…" } ]
}
```

`mode` is `loopback` for a loopback endpoint, `server` for a non-loopback
endpoint without tokens, and `hosted` for a non-loopback endpoint that requires
them.

### Harness config

The status payload (and the mint response, with the token filled in) carries the
exact snippet each harness expects, which is what the MCP panel's **Copy harness
config** button shows:

- **Claude Code** — `.mcp.json`: `{"mcpServers":{"pigma":{"type":"http","url":…,"headers":{"Authorization":"Bearer …"}}}}`
  (`type: "http"` is required; a `url` without a type is read as a stdio server).
- **Cursor** — `.cursor/mcp.json`: `{"mcpServers":{"pigma":{"url":…,"headers":{…}}}}`.
- **Codex** — `~/.codex/config.toml`, emitted as TOML (not JSON):
  `[mcp_servers.pigma]` with `url`, plus `[mcp_servers.pigma.http_headers]`.

Auth is omitted entirely when the endpoint needs no token.

---

## Security

Host/origin based — plus, in hosted mode, a capability token — never
client-identity based:

- HTTP and relay bind `127.0.0.1` by default; disallowed `Host` → 403
  (DNS rebinding), disallowed `Origin` → 403.
- With `--hosted`, every JSON-RPC request needs a live session token
  (`/mcp/status` stays open: it is the health surface and leaks nothing).
- CORS is origin-scoped (echo of an allowed origin only); never `*`.
- The relay requires a per-run token on the SSE stream and on result posts.
- No authentication or client allowlist: run only where the editor is trusted.

---

## Differences from Figma's hosted server

| Area | Figma | Pigma |
| --- | --- | --- |
| `get_design_context` | React/Tailwind + Code Connect substitution | React + Tailwind / HTML + CSS codegen from the model; no substitution |
| `get_screenshot` | PNG | **PNG** (SVG renderer + rasterizer) |
| `download_assets` | Temporary URLs | Inline data URLs |
| `create_new_file` | Cloud drafts | Local Pigma file |
| `upload_assets` | Cloud upload | `data:` URL in the document |
| `use_pigma` | Plugin JS in Figma's sandbox | Plugin JS in a QuickJS sandbox (subset) |
| Code Connect | Cloud project | `file.meta.codeConnect` |
| `get_motion_context` | Keyframes, CSS snippets | Prototype interactions only |

## Parity gaps

Registered with honest results: `whoami`, `generate_pigma_design` (capability
errors), `get_libraries` remote entries, `get_code_connect_suggestions` (no
source guessing). Generative plugins, shaders, and the Weave family are
registered but always answer with an explicit capability result (see above).
Every tool name in Figma's published MCP tool list is registered (asserted in
`tests/mcp/protocol.test.ts`).

`use_pigma` covers a documented Plugin API subset (see above): no `figma.ui`,
no editable vector networks (networks convert to paths; reading one is an
explicit error), and no interactive parameter UI (`parameters` are passed to the
run event directly).

Model gaps the MCP surface cannot paper over: `BOOLEAN_OPERATION` nodes carry
their result path and keep their operands as children, but the model does not
store the operation kind itself (Figma's `booleanOperation`) — the node name is
the only record — so `get_design_context` reports the geometry, fill rule, and
operands, not a `booleanOperation` field. Variables and variable collections are
first-class in the model and fully served by the MCP tools, but no importer
populates them yet: Figma's file JSON has no variables table (they come from the
separate `/variables/local` endpoint) and the native `.fig` reader does not
extract the document's variable tables.
Native `.fig` **export** is implemented for both native round-trips and the
editor model — see [`docs/FIGMA_IMPORT.md`](./FIGMA_IMPORT.md) for the mapping
and its documented limitations (component sets, numeric font weight).

---

## Testing

```bash
npx vitest run tests/mcp     # 58 tests
```

Covers: protocol + version negotiation with unknown client names; every tool;
QuickJS sandbox (supported API, no host capabilities, timeouts, syntax and host
errors); CLI validation, atomic persistence, and failure-commits-nothing; HTTP
hardening (Host/Origin 403, origin-scoped CORS, JSON/SSE); the browser relay with
a real HTTP/SSE client; Code Connect writes; and **official
`@modelcontextprotocol/sdk` interoperability** (in-process, real HTTP socket, and
real stdio spawn of the CLI against a `.fig`, asserting a PNG).

## Dependencies

Optional peers (installed locally with `--no-save` for verification; **not** in
`package.json` yet — requested from the app owner):

- `@resvg/resvg-js` — PNG screenshots (`src/mcp/raster.node.ts`).
- `quickjs-emscripten` — `use_pigma` code execution (`src/mcp/plugin/interpreter.node.ts`).
- `@modelcontextprotocol/sdk`, `ajv`, `@types/node` — dev-only (tests/typecheck).
- `fflate` + `fzstd` — browser `.fig` import ([`docs/FIGMA_IMPORT.md`](./FIGMA_IMPORT.md)).

Requested: add those to `dependencies`/`devDependencies`, mount `<BridgePanel />`
in the editor, and add the `"mcp"` npm script.
