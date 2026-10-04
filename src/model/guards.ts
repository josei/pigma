/**
 * Canonical runtime guards shared by the document model.
 *
 * Imported JSON is untrusted, so the boundary parsers in `validate.ts` use
 * `isRecord` to narrow `unknown` before reading fields.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

