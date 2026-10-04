/**
 * Figma import for Pigma.
 *
 * Two sources are supported:
 *
 *  1. **Figma REST API JSON** — `parseFigmaRestFile` (full file) or
 *     `parseFigmaRestNodes` (nodes endpoint). Zero dependencies.
 *  2. **Native `.fig` / `.deck` / `.jam` binaries** — `parseFigFile`. Requires
 *     decompressors: `nodeDecompressors` from `src/figma/native/node` in Node,
 *     or `fflate` + `fzstd` in the browser (see `docs/FIGMA_IMPORT.md`).
 *
 * Both feed `toPigmaFile`, which produces a `PigmaFile` (`src/model/types.ts`)
 * plus an {@link ImportReport} of anything that could not be represented.
 */
export * from './errors';
export * from './rest/types';
export * from './rest/parse';
export * from './native/kiwi';
export * from './native/zip';
export * from './native/parse';
export * from './native/vector';
export * from './convert/report';
export * from './convert/adapters';
export * from './convert/convert';
export * from './native/browser';
