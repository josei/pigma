/** Honest capability results for tools whose Figma backend Pigma does not have. */
import type { ToolCallResult } from './types';

/** Type alias (not interface) so it is assignable to `Record<string, unknown>`. */
export type CapabilityResult = {
  supported: false;
  capability: string;
  reason: string;
  /** What a client can use instead, when something real exists. */
  alternatives?: string[];
};

/**
 * Build the structured result for a capability Pigma genuinely cannot provide.
 * Explicitly `isError` — never a stub that reports fake success.
 */
export function capabilityError(capability: string, reason: string, alternatives?: string[]): ToolCallResult {
  const payload: CapabilityResult = { supported: false, capability, reason };
  if (alternatives && alternatives.length > 0) payload.alternatives = alternatives;
  return {
    content: [{ type: 'text', text: `${capability} is not supported by Pigma: ${reason}` }],
    structuredContent: payload,
    isError: true,
  };
}
