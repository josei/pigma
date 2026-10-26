import type { PigmaFile } from './types';
import { validatePigmaFile, type ValidationResult } from './validate';

/**
 * Deterministic JSON: object keys are emitted in sorted order so exports of the
 * same document are byte-identical (diffable, testable, cache-friendly).
 */
export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(sortValue(value), null, indent);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const v = source[key];
      if (v === undefined) continue;
      out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

export function serializeFile(file: PigmaFile): string {
  return stableStringify(file, 2);
}

export function parseFile(text: string): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      file: null,
      errors: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
    };
  }
  return validatePigmaFile(raw);
}

/** A filesystem-safe file name for downloads. */
export function safeFileName(name: string, extension: string): string {
  const slug = name
    .trim()
    .replace(/[^\w\-. ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64);
  return `${slug || 'pigma'}.${extension}`;
}
