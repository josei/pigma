/**
 * stdio transport: newline-delimited JSON-RPC on stdin/stdout.
 * Usable by any MCP client that spawns the server as a subprocess.
 */
import type { JsonRpcMessage, JsonRpcResponse } from '../types';
import { ErrorCode } from '../types';
import type { McpServer } from '../protocol';

export interface StdioStreams {
  input: AsyncIterable<Uint8Array | string>;
  output: { write(chunk: string): unknown };
}

function parseError(id: null, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code: ErrorCode.PARSE_ERROR, message } };
}

async function dispatchLine(server: McpServer, line: string): Promise<JsonRpcResponse[]> {
  const trimmed = line.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [parseError(null, 'Parse error')];
  }
  const messages: JsonRpcMessage[] = Array.isArray(parsed) ? (parsed as JsonRpcMessage[]) : [parsed as JsonRpcMessage];
  const responses: JsonRpcResponse[] = [];
  for (const message of messages) {
    const response = await server.handle(message);
    if (response) responses.push(response);
  }
  return responses;
}

/** Run the server until the input stream ends. */
export async function serveStdio(server: McpServer, streams: StdioStreams): Promise<void> {
  let buffer = '';
  for await (const chunk of streams.input) {
    buffer += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      for (const response of await dispatchLine(server, line)) {
        streams.output.write(`${JSON.stringify(response)}\n`);
      }
      index = buffer.indexOf('\n');
    }
  }
  if (buffer.trim().length > 0) {
    for (const response of await dispatchLine(server, buffer)) {
      streams.output.write(`${JSON.stringify(response)}\n`);
    }
  }
}
