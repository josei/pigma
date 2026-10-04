/** Error codes raised by the Figma importers. */
export type FigmaImportErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_DOCUMENT'
  | 'CYCLE'
  | 'DUPLICATE_ID'
  | 'MISSING_FIELD'
  | 'INVALID_BINARY'
  | 'TRUNCATED'
  | 'UNSUPPORTED_COMPRESSION'
  | 'UNSUPPORTED_ARCHIVE';

/** Raised for malformed, cyclic, or otherwise unimportable Figma sources. */
export class FigmaImportError extends Error {
  readonly code: FigmaImportErrorCode;
  /** Dotted path to the offending value, when known (e.g. `nodes.0.children`). */
  readonly path: string | undefined;

  constructor(code: FigmaImportErrorCode, message: string, options?: { path?: string; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'FigmaImportError';
    this.code = code;
    this.path = options?.path;
  }
}
