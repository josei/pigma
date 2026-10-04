/**
 * Tool schemas: the contract a harness builds its arguments from.
 *
 * A schema that lies is a broken tool — a client derives its arguments from
 * `inputSchema`, so every schema must be valid JSON Schema for an object, every
 * `required` entry must actually exist in `properties`, and the schema on the
 * wire must be the schema in the registry (no transformation in between).
 */
import { describe, expect, it, vi } from 'vitest';
import { allTools } from '../../src/mcp/tools/index';
import { createMcpServer } from '../../src/mcp/protocol';
import { createSession } from '../../src/mcp/session';

vi.setConfig({ testTimeout: 60_000 });

type PropertySchema = { type?: unknown; description?: unknown } & Record<string, unknown>;

const isTyped = (schema: PropertySchema): boolean =>
  typeof schema.type === 'string' ||
  Array.isArray(schema.type) ||
  'enum' in schema ||
  'items' in schema ||
  'oneOf' in schema ||
  'anyOf' in schema ||
  'const' in schema;

describe('every tool schema is valid JSON Schema a harness can build from', () => {
  it('declares an object with properties, and every required key exists', () => {
    for (const tool of allTools) {
      const { name, inputSchema } = tool.definition;
      const schema = inputSchema as {
        type?: unknown;
        properties?: Record<string, PropertySchema>;
        required?: unknown;
        additionalProperties?: unknown;
      };

      expect(schema.type, `${name}: inputSchema.type must be "object"`).toBe('object');
      expect(schema.properties, `${name}: inputSchema.properties must be present`).toBeTruthy();
      expect(typeof schema.properties, `${name}: properties must be an object`).toBe('object');
      expect(Array.isArray(schema.required) || schema.required === undefined, `${name}: required must be an array when present`).toBe(true);

      // A `required` key that is not declared is a schema that lies.
      for (const key of (schema.required as string[] | undefined) ?? []) {
        expect(typeof key, `${name}: required entries must be strings`).toBe('string');
        expect(schema.properties, `${name}: required "${key}" has no matching property`).toHaveProperty(key);
      }

      // Every property must be a schema a client can render an input from.
      for (const [key, property] of Object.entries(schema.properties ?? {})) {
        expect(property, `${name}.${key}: property must be a schema object`).toBeTruthy();
        expect(isTyped(property), `${name}.${key}: property declares no type/enum/items`).toBe(true);
      }
    }
  });

  it('serializes cleanly and carries no undefined values', () => {
    for (const tool of allTools) {
      const json = JSON.stringify(tool.definition.inputSchema);
      expect(json, `${tool.definition.name}: schema is not JSON-serializable`).toBeTruthy();
      expect(json, `${tool.definition.name}: schema contains undefined`).not.toContain('undefined');
      // Round-tripping through JSON must not change it (no functions, no symbols).
      expect(JSON.parse(json), `${tool.definition.name}: schema changed through JSON`).toEqual(tool.definition.inputSchema);
    }
  });

  it('sends the registry schema over the wire, unchanged', async () => {
    const server = createMcpServer({ session: createSession(null) });
    const response = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const listed = ((response as { result?: { tools?: Array<{ name: string; inputSchema: unknown }> } }).result?.tools ?? []);
    expect(listed).toHaveLength(allTools.length);

    const byName = new Map(listed.map((tool) => [tool.name, tool.inputSchema]));
    for (const tool of allTools) {
      // Deep equality: what a client receives is exactly what the registry holds.
      expect(byName.get(tool.definition.name), `${tool.definition.name}: wire schema differs from the registry`).toEqual(
        tool.definition.inputSchema,
      );
    }
  });
});
