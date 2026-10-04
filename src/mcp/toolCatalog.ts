/**
 * What a state advertises.
 *
 * MCP is offered in three states (see `src/config/mcpAvailability.ts`), and they
 * differ in more than the endpoint: a tool that needs the desktop shell must not
 * be advertised where the shell is absent, or the user is shown a capability the
 * endpoint will fail to honour.
 *
 * The mapping is a **pure function of the registry and the state**, so it can be
 * tested without a shell, a browser, or a server: `advertisedTools(allTools, state)`.
 * The registry stays the single source of truth for names and count — nothing
 * else may hard-code a number.
 */
import type { RegisteredTool } from './registry';

/** The three states, by the same names the panel uses. */
export type McpStateKind = 'hosted' | 'desktop' | 'self-hosted';

export interface McpState {
  kind: McpStateKind;
  /**
   * Whether the desktop shell is present (its `desktop_info` answered). Only a
   * shell can serve a tool that requires it.
   */
  shellPresent: boolean;
}

/** The state a server advertises when it does not know better. */
export const SELF_HOSTED_STATE: McpState = { kind: 'self-hosted', shellPresent: false };
export const HOSTED_STATE: McpState = { kind: 'hosted', shellPresent: false };
export const DESKTOP_STATE: McpState = { kind: 'desktop', shellPresent: true };

/**
 * The tools a state advertises, in catalog order.
 *
 * Today no registered tool requires the shell — every one of them runs against
 * whichever session the endpoint has — so every state advertises the whole
 * registry. The filter is here (and tested) so that a future tool which *does*
 * need the shell is gated out instead of being advertised and failing.
 */
export function advertisedTools(tools: readonly RegisteredTool[], state: McpState): RegisteredTool[] {
  return tools.filter((tool) => isServiceable(tool, state));
}

/** Tool names, sorted — the set a client actually sees. */
export function toolNames(tools: readonly RegisteredTool[]): string[] {
  return tools.map((tool) => tool.definition.name).sort();
}

/** The number a panel or status surface may show. Always derived, never stored. */
export function toolCount(tools: readonly RegisteredTool[]): number {
  return tools.length;
}

/**
 * Whether a tool can work in a state. Used by tests to assert that nothing is
 * advertised that would fail on arrival.
 */
export function isServiceable(tool: RegisteredTool, state: McpState): boolean {
  if (tool.definition.requiresShell && !state.shellPresent) return false;
  return true;
}
