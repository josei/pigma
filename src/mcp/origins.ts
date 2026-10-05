/**
 * The host and origin allowlists, in ONE place.
 *
 * Three separate copies of these defaults is what let `--public-url` reach one
 * allowlist and not another three times over: the MCP handler had a pair, the
 * bridge had its own, and the collab relay had NONE AT ALL. Every surface that
 * accepts a request from a browser validates the same two headers with the same
 * rules, so they live here and nowhere else.
 */

/** Origins a loopback deployment is reached from. */
export const DEFAULT_ORIGINS = ['http://localhost', 'http://127.0.0.1', 'http://[::1]'];

/** Hosts a loopback deployment answers for. */
export const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** Is this Host header one we answer for? A missing Host is accepted. */
export function hostAllowed(host: string | null, allowed: string[]): boolean {
  if (!host) return true;
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0] ?? host;
  return allowed.includes(hostname);
}

/**
 * Is this Origin one we accept? A MISSING origin is accepted: non-browser clients
 * (the CLI, a test harness, the desktop shell) send none, and the gate exists to
 * stop a PAGE the user did not choose from reaching the endpoint — which is a
 * browser-only threat.
 */
export function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return true;
  const match = /^(https?:\/\/[^/]+)/.exec(origin);
  const base = match?.[1] ?? origin;
  return allowed.some((entry) => base === entry || base.startsWith(`${entry}:`));
}
