/**
 * The native document format: one extension and one media type, everywhere.
 *
 * A Pigma document used to leave the app as a bare `.json` with
 * `application/json`, indistinguishable from any other JSON on disk or in a
 * download folder. It is now `.pigma` / `application/vnd.pigma+json` (a vendor
 * JSON type, RFC 6839) for the File menu, the File System Access pickers and the
 * document library metadata.
 *
 * Compatibility is deliberate and one-directional: the **schema tag**
 * (`pigma/1`, see src/model/serialize.ts) is the authority, never the extension,
 * so every `.json` Pigma file ever exported still imports. Only new files are
 * written with the new name and type.
 */
import { safeFileName } from './serialize';

/** File extension for a native Pigma document, including the dot. */
export const PIGMA_EXTENSION = '.pigma';

/**
 * The format tag a stored document records. It is the same discriminator the
 * serialized file carries (`PigmaFile.schema`), so the library metadata and the
 * file agree on what a document *is* regardless of its name.
 */
export const PIGMA_FORMAT = 'pigma/1';

/** Media type for a native Pigma document. */
export const PIGMA_MIME = 'application/vnd.pigma+json';

/** Media type every browser still accepts for a JSON upload. */
export const JSON_MIME = 'application/json';

/** What the file pickers offer, and what an `<input accept>` advertises. */
export const PIGMA_FILE_TYPES = [
  { description: 'Pigma document', accept: { [PIGMA_MIME]: [PIGMA_EXTENSION] } },
  { description: 'Pigma document (legacy JSON)', accept: { [JSON_MIME]: ['.json'] } },
] as const;

/** `accept` attribute value for the import input (native first, legacy second). */
export const PIGMA_ACCEPT = `${PIGMA_EXTENSION},${JSON_MIME},.json`;

/**
 * The file name a document should be written under: slugged like every other
 * export (see `safeFileName`), with the native extension — unless the user
 * already gave it an extension, which is kept.
 */
export function pigmaFileName(name: string): string {
  const trimmed = name.trim() || 'pigma';
  const match = /^(.*)\.(pigma|json)$/i.exec(trimmed);
  return match ? safeFileName(match[1]!, match[2]!.toLowerCase()) : safeFileName(trimmed, PIGMA_EXTENSION.slice(1));
}

/**
 * True when a file name *could* be a Pigma document. Both extensions are
 * accepted, because a `.json` file is still valid — the schema decides, not this.
 */
export function isPigmaFileName(fileName: string): boolean {
  return /\.(pigma|json)$/i.test(fileName.trim());
}

/** True when the name uses the native extension (what new saves produce). */
export function isNativePigmaFileName(fileName: string): boolean {
  return /\.pigma$/i.test(fileName.trim());
}
