/**
 * Browser decompressor loader for the native `.fig` parser.
 *
 * Node callers use `nodeDecompressors` (`./node`), which wraps `node:zlib`.
 * Browsers have no built-in zstd, so the archive's message chunk (zstd) needs
 * `fzstd`; the schema chunk and any deflated ZIP entries need `fflate`.
 *
 * Those packages are optional peers: install them when you need native `.fig`
 * import in the browser. `loadDecompressors` imports them lazily (via a
 * non-literal specifier, so bundlers only include them when present) and fails
 * with a clear message when they are missing. REST import needs neither.
 */
import { FigmaImportError } from '../errors';
import type { Decompressors } from './zip';

interface FflateModule {
  inflateSync(data: Uint8Array): Uint8Array;
}

interface FzstdModule {
  decompress(data: Uint8Array): Uint8Array;
}

/**
 * Resolve `fflate` + `fzstd` at runtime. Install them with
 * `npm install fflate fzstd` before calling this in a browser build.
 */
export async function loadDecompressors(): Promise<Decompressors> {
  let fflate: FflateModule;
  let fzstd: FzstdModule;
  // A static import cannot work here: fflate/fzstd are optional peers that
  // REST-only and Node consumers never install, and eagerly importing them would
  // put ~60KB of decompressors in the initial bundle. Literal specifiers keep
  // the imports bundler-resolvable while splitting them into a lazy chunk.
  try {
    fflate = (await import('fflate')) as FflateModule;
    fzstd = (await import('fzstd')) as FzstdModule;
  } catch (cause) {
    throw new FigmaImportError(
      'UNSUPPORTED_COMPRESSION',
      'Native .fig import needs the optional `fflate` and `fzstd` packages (npm install fflate fzstd)',
      { cause },
    );
  }
  return {
    inflateRaw: (bytes) => new Uint8Array(fflate.inflateSync(bytes)),
    zstd: (bytes) => new Uint8Array(fzstd.decompress(bytes)),
  };
}
