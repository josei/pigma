/**
 * Runtime guards for MCP tool arguments (external, untrusted JSON).
 * `isRecord` is shared with the model layer; the throwing helpers below are
 * MCP-specific.
 */
import { McpToolError } from '../errors';

import { isRecord } from '../../model/guards';
export { isRecord };

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new McpToolError(`\`${key}\` must be a string`);
  return value;
}

export function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new McpToolError(`\`${key}\` must be a finite number`);
  return value;
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new McpToolError(`\`${key}\` must be a boolean`);
  return value;
}

export function stringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new McpToolError(`\`${key}\` must be an array of strings`);
  }
  return value as string[];
}

export function objectArray(args: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = args[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => !isRecord(entry))) {
    throw new McpToolError(`\`${key}\` must be an array of objects`);
  }
  return value as Array<Record<string, unknown>>;
}
