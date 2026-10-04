/**
 * Runtime guards for untrusted Figma JSON.
 *
 * Figma REST responses are external input, so every value is validated at the
 * boundary before use. `isRecord` is shared with the model layer; the throwing
 * helpers below are Figma-specific.
 */
import { FigmaImportError } from '../errors';

import { isRecord } from '../../model/guards';
export { isRecord };

export function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new FigmaImportError('INVALID_INPUT', `Expected an object at ${path}`, { path });
  }
  return value;
}

export function requireString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new FigmaImportError('MISSING_FIELD', `Expected a non-empty string \`${key}\` at ${path}`, { path });
  }
  return value;
}

export function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
