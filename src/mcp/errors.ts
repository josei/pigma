/** Error type for tool failures that should surface as MCP tool errors. */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolError';
  }
}
