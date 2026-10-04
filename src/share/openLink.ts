/**
 * Document links: `#open=<url>&name=<optional>`.
 *
 * A link points at a document the user hosts somewhere — it does **not** carry
 * the document. Embedding a document in the fragment is deliberately not
 * supported: a real design is far past every browser's URL limit, images alone
 * would blow it, and a fragment that big is unusable when pasted. So the link
 * names a URL, the browser fetches it, and the editor validates what came back.
 *
 * The payload is treated strictly as data: it is parsed as JSON and run through
 * the same schema validation as every other import. Nothing from the network is
 * ever executed, and a document that does not carry the `pigma/1` tag is
 * refused rather than half-loaded.
 */
import { parseFile } from '../model/serialize';
import type { PigmaFile } from '../model/types';

/** Fragment keys. `open` names the document; `name` is a display hint. */
export const OPEN_PARAM = 'open';
export const NAME_PARAM = 'name';

export interface DocumentLink {
  /** The document URL exactly as it appeared in the link (may be relative). */
  url: string;
  /** Display name the link suggested, when it carried one. */
  name: string | null;
}

/** Build the link for a document the user hosts. */
export function buildDocumentLink(options: { base: string; url: string; name?: string }): string {
  const origin = options.base.trim().replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set(OPEN_PARAM, options.url.trim());
  const name = options.name?.trim();
  if (name) params.set(NAME_PARAM, name);
  return `${origin}/#${params.toString()}`;
}

/** Read `#open=…&name=…` out of a fragment or a full URL. */
export function readDocumentLink(input: string): DocumentLink | null {
  const hash = input.includes('#') ? input.slice(input.indexOf('#') + 1) : input.replace(/^#/, '');
  if (hash === '') return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(hash);
  } catch {
    return null;
  }
  const url = params.get(OPEN_PARAM)?.trim() ?? '';
  if (url === '') return null;
  const name = params.get(NAME_PARAM)?.trim() ?? '';
  return { url, name: name === '' ? null : name };
}

/**
 * Resolve what the link named into something fetchable.
 *
 * An absolute `http(s)` URL is used as-is; a relative path is resolved against
 * the page's own origin, which is what lets a self-hosted instance point at a
 * document it serves itself (`#open=/documents/home.pigma`). Every other scheme
 * is refused: a document link may never be `javascript:`, `data:` or `file:`.
 */
export function resolveDocumentUrl(raw: string, base: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let resolved: URL;
  try {
    resolved = new URL(trimmed, base);
  } catch {
    return null;
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
  return resolved.toString();
}

/** True when the URL is one the app may fetch (http/https, absolute). */
export function isFetchableDocumentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** What the app tells the user when a document link cannot be loaded. */
export const LINK_READ_FAILURE =
  'Could not read that document — that host does not allow the app to read the file. Download it and open it instead.';
export const LINK_FORMAT_FAILURE = 'That link does not point at a Pigma document.';

export interface LinkedDocumentResult {
  file: PigmaFile | null;
  /** A message for the user; null when the document loaded. */
  error: string | null;
}

/**
 * Fetch a document URL and validate it. Failures are reported, never thrown:
 * a link is an enhancement, and the editor keeps working without it.
 */
export async function fetchLinkedDocument(
  url: string,
  fetchImpl?: typeof fetch,
): Promise<LinkedDocumentResult> {
  if (!isFetchableDocumentUrl(url)) {
    return { file: null, error: LINK_FORMAT_FAILURE };
  }
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { file: null, error: LINK_READ_FAILURE };

  let response: Response;
  try {
    response = await doFetch(url, {
      // Ask for the native type first; a legacy `.json` document is still fine.
      headers: { accept: 'application/vnd.pigma+json, application/json' },
      redirect: 'follow',
    });
  } catch {
    // A CORS refusal and an offline network both surface as a rejected fetch:
    // there is no way (and no need) to tell them apart from the page.
    return { file: null, error: LINK_READ_FAILURE };
  }
  if (!response.ok) {
    return { file: null, error: `Could not read that document (HTTP ${response.status}).` };
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    return { file: null, error: LINK_READ_FAILURE };
  }

  // Data, never code: JSON.parse cannot execute anything, and the schema check
  // below is the same one every other import goes through.
  const parsed = parseFile(text);
  if (!parsed.file) {
    // Say what is wrong with it, not just that something is.
    const detail = parsed.errors[0];
    return { file: null, error: detail ? `That file is not a Pigma document (${detail}).` : LINK_FORMAT_FAILURE };
  }
  return { file: parsed.file, error: null };
}
