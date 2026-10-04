/** Tool registry types shared by the MCP tools. */
import type { DocumentSession } from './session';
import type { Rasterizer } from './raster';
import type { ToolCallResult, ToolDefinition } from './types';
import type { PluginInterpreter } from '../plugins/engine';

export interface ToolContext {
  session: DocumentSession;
  /** Present when the host can run `use_pigma` plugin scripts. */
  interpreter?: PluginInterpreter;
  rasterizer?: Rasterizer;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => ToolCallResult | Promise<ToolCallResult>;
}

export function textResult(text: string, structuredContent?: Record<string, unknown>): ToolCallResult {
  const result: ToolCallResult = { content: [{ type: 'text', text }] };
  if (structuredContent) result.structuredContent = structuredContent;
  return result;
}

export function jsonResult(structuredContent: Record<string, unknown>): ToolCallResult {
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
}

