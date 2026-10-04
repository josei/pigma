/**
 * Harness configuration snippets emitted by the server.
 *
 * The MCP panel shows these behind a "Copy harness config" button: exactly what
 * a given harness needs to reach this endpoint, with the token filled in when
 * one is held. Shapes are per-harness and are not interchangeable:
 *
 * - **Claude Code** (`claude mcp add-json`, `.mcp.json`): `type: "http"` is
 *   required — a `url` without a `type` is read as a stdio server.
 * - **Cursor** (`.cursor/mcp.json` or `~/.cursor/mcp.json`): `url` + `headers`.
 * - **Codex** (`~/.codex/config.toml`): TOML, not JSON — `[mcp_servers.<name>]`
 *   with `url` and an `http_headers` table (or `bearer_token_env_var`).
 *
 * No token is baked in unless the caller passes one, and the snippets never
 * invent a different endpoint: they describe the server that produced them.
 */

export type HarnessId = 'claude' | 'cursor' | 'codex';

export interface HarnessConfigEntry {
  id: HarnessId;
  label: string;
  /** Where the snippet belongs. */
  path: string;
  format: 'json' | 'toml';
  /** Ready to paste, exactly as the harness expects it. */
  content: string;
}

export interface HarnessConfigOptions {
  /** The MCP endpoint, e.g. `http://127.0.0.1:3001/mcp`. */
  endpoint: string;
  /** Session token to embed; omitted when the endpoint needs none. */
  token?: string | null;
  /** Server name used as the config key. Default `pigma`. */
  name?: string;
}

function bearer(token: string | null | undefined): Record<string, string> | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

/** Claude Code: `.mcp.json` (or `claude mcp add-json <name> '<json>'`). */
export function claudeConfig(options: HarnessConfigOptions): HarnessConfigEntry {
  const name = options.name ?? 'pigma';
  const headers = bearer(options.token);
  return {
    id: 'claude',
    label: 'Claude Code',
    path: '.mcp.json',
    format: 'json',
    content: JSON.stringify(
      { mcpServers: { [name]: { type: 'http', url: options.endpoint, ...(headers ? { headers } : {}) } } },
      null,
      2,
    ),
  };
}

/** Cursor: `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (user). */
export function cursorConfig(options: HarnessConfigOptions): HarnessConfigEntry {
  const name = options.name ?? 'pigma';
  const headers = bearer(options.token);
  return {
    id: 'cursor',
    label: 'Cursor',
    path: '.cursor/mcp.json',
    format: 'json',
    content: JSON.stringify(
      { mcpServers: { [name]: { url: options.endpoint, ...(headers ? { headers } : {}) } } },
      null,
      2,
    ),
  };
}

/** Codex: `~/.codex/config.toml`. TOML, so it is emitted as TOML. */
export function codexConfig(options: HarnessConfigOptions): HarnessConfigEntry {
  const name = options.name ?? 'pigma';
  const lines = [`[mcp_servers.${name}]`, `url = ${JSON.stringify(options.endpoint)}`];
  if (options.token) {
    lines.push('', `[mcp_servers.${name}.http_headers]`, `Authorization = ${JSON.stringify(`Bearer ${options.token}`)}`);
  }
  return {
    id: 'codex',
    label: 'Codex',
    path: '~/.codex/config.toml',
    format: 'toml',
    content: `${lines.join('\n')}\n`,
  };
}

/** Every harness the panel offers, in display order. */
export function harnessConfigs(options: HarnessConfigOptions): HarnessConfigEntry[] {
  return [claudeConfig(options), cursorConfig(options), codexConfig(options)];
}
