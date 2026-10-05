/**
 * MCP parity proof: every advertised tool, exercised end-to-end.
 *
 * The claim is "Figma MCP parity usable by ANY MCP-compatible harness", so this
 * suite drives the real client path — an MCP SDK client over the Streamable HTTP
 * transport, against a relay + bridge + a live editor — and requires every tool
 * in `allTools` to end in exactly one of two states:
 *
 *   (a) a well-formed result: content present, structuredContent present where
 *       the tool returns one, `isError` unset; or
 *   (b) an explicit capability error: `isError` true, `supported: false`, and a
 *       reason naming what Pigma cannot do — never a fake success.
 *
 * A throw, an undefined result, or an error with no reason fails this suite.
 * The argument-validation path is covered too: a call with missing or invalid
 * required arguments must come back as a clear error, not a throw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allTools } from '../../src/mcp/tools/index';
import { createMcpServer } from '../../src/mcp/protocol';
import { createSession } from '../../src/mcp/session';
import { startParityHarness, type ParityHarness } from './parity-harness';

// Real sockets, real HTTP, a spawned-shaped editor: protocol behaviour, not
// latency. A busy box must not turn a correct round trip into a failure.
vi.setConfig({ testTimeout: 60_000 });

/** A 1×1 PNG, for the tools that take an image. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * How every tool is expected to end, and the arguments that get it there.
 *
 * `a` = a real result. `b` = an explicit capability error (Pigma genuinely has
 * no backend for it). Every tool in the registry must appear here — the suite
 * fails if the registry grows and this table does not.
 */
interface Expectation {
  outcome: 'a' | 'b';
  /** Arguments for the happy path (a real document is loaded and an editor is connected). */
  args: Record<string, unknown>;
  /** Where the tool returns structuredContent, assert it is a non-empty object. */
  structured?: boolean;
}

const EXPECTATIONS: Record<string, Expectation> = {
  // Design to code — all work against the loaded document.
  get_metadata: { outcome: 'a', args: { nodeId: '1:2' }, structured: true },
  get_design_context: { outcome: 'a', args: { nodeId: '1:2' }, structured: true },
  get_screenshot: { outcome: 'a', args: { nodeId: '1:2', format: 'svg' }, structured: true },
  download_assets: { outcome: 'a', args: { nodeIds: ['1:2'] }, structured: true },
  get_variable_defs: { outcome: 'a', args: { nodeId: '1:4' }, structured: true },
  get_libraries: { outcome: 'a', args: {}, structured: true },
  search_design_system: { outcome: 'a', args: { queries: ['button'] }, structured: true },
  get_code_connect_map: { outcome: 'a', args: { nodeId: '1:9' }, structured: true },
  get_motion_context: { outcome: 'a', args: { nodeId: '1:2', recursive: true }, structured: true },
  get_figjam: { outcome: 'a', args: { nodeId: '1:2', screenshotLimit: 0 }, structured: true },

  // Code to design.
  use_pigma: { outcome: 'a', args: { code: "figma.createRectangle({ name: 'Parity', width: 8, height: 8 }).id;" }, structured: true },
  create_new_file: { outcome: 'a', args: { name: 'Parity', editorType: 'design' }, structured: true },
  upload_assets: { outcome: 'a', args: { nodeId: '1:2', images: [{ dataUrl: TINY_PNG, name: 'parity.png' }] }, structured: true },
  generate_diagram: { outcome: 'a', args: { mermaid: 'flowchart TD\n  A[Start] --> B[End]' }, structured: true },
  generate_pigma_design: { outcome: 'b', args: { url: 'https://example.com' } },

  // Design systems and Code Connect.
  add_code_connect_map: {
    outcome: 'a',
    args: { nodeId: '1:2', componentName: 'Button', source: 'src/Button.tsx' },
    structured: true,
  },
  send_code_connect_mappings: {
    outcome: 'a',
    args: { mappings: [{ nodeId: '1:2', componentName: 'Button', source: 'src/Button.tsx' }] },
    structured: true,
  },
  get_context_for_code_connect: { outcome: 'a', args: { nodeId: '1:9' }, structured: true },
  get_code_connect_suggestions: { outcome: 'a', args: { nodeId: '1:9' }, structured: true },

  // Account: no accounts in Pigma.
  whoami: { outcome: 'b', args: {} },

  // Generative plugins and shaders: no account library, no build runtime.
  list_generative_plugins: { outcome: 'b', args: {} },
  get_generative_plugin: { outcome: 'b', args: { id: 'plugin-1' } },
  create_generative_plugin: { outcome: 'b', args: { name: 'P', description: 'd', planKey: 'team::1' } },
  update_generative_plugin: { outcome: 'b', args: { id: 'plugin-1', commitMessage: 'm' } },
  list_shaders: { outcome: 'b', args: {} },
  list_file_shaders: { outcome: 'b', args: { fileKey: 'key' } },
  get_shader: { outcome: 'b', args: { id: 'shader-1' } },
  create_shader: { outcome: 'b', args: { name: 'S', description: 'd', planKey: 'team::1', kind: 'fill' } },
  update_shader: { outcome: 'b', args: { id: 'shader-1', kind: 'fill', commitMessage: 'm' } },

  // Weave: needs the weavy.ai service.
  weave_list_tools: { outcome: 'b', args: {} },
  weave_get_tool_inputs: { outcome: 'b', args: { recipeId: 'r1' } },
  weave_upload_asset: { outcome: 'b', args: { recipeId: 'r1' } },
  weave_run_tool: { outcome: 'b', args: { recipeId: 'r1' } },
  weave_get_tool_run_output: { outcome: 'b', args: { recipeId: 'r1' } },
  weave_cancel_tool_run: { outcome: 'b', args: { recipeId: 'r1' } },
};

type ToolResult = {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
};

const harnesses: ParityHarness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

const call = (harness: ParityHarness, name: string, args: Record<string, unknown>): Promise<ToolResult> =>
  harness.client.callTool({ name, arguments: args }) as Promise<ToolResult>;

/** Assert the (a) outcome: a real, well-formed result. */
function expectWellFormed(name: string, result: ToolResult, structured: boolean): void {
  expect(result.isError, `${name} should not report an error`).toBeFalsy();
  expect(Array.isArray(result.content), `${name} must return content`).toBe(true);
  expect(result.content?.length ?? 0, `${name} must return at least one content item`).toBeGreaterThan(0);
  for (const item of result.content ?? []) {
    expect(['text', 'image', 'resource'].includes(item.type ?? ''), `${name} content item has no type`).toBe(true);
  }
  if (structured) {
    expect(result.structuredContent, `${name} should return structuredContent`).toBeTruthy();
    expect(Object.keys(result.structuredContent ?? {}).length, `${name} structuredContent is empty`).toBeGreaterThan(0);
  }
}

/** Assert the (b) outcome: an explicit capability error, with a reason. */
function expectCapabilityError(name: string, result: ToolResult): void {
  expect(result.isError, `${name} should be an explicit error, not a fake success`).toBe(true);
  const structured = result.structuredContent ?? {};
  expect(structured.supported, `${name} must say supported:false`).toBe(false);
  expect(typeof structured.reason === 'string' && (structured.reason as string).length > 0, `${name} must give a reason`).toBe(true);
  const text = (result.content ?? []).map((item) => item.text ?? '').join('\n');
  expect(text.length, `${name} must explain itself in text too`).toBeGreaterThan(0);
  expect(text).not.toMatch(/Tool failed|undefined is not|Cannot read propert/i);
}

describe('every tool works through the real call path', () => {
  it('exercises every registered tool exactly once', async () => {
    const names = allTools.map((tool) => tool.definition.name).sort();
    expect(names).toEqual(Object.keys(EXPECTATIONS).sort());
    expect(names).toHaveLength(allTools.length);

    const harness = await startParityHarness();
    harnesses.push(harness);
    const outcomes: Record<string, string> = {};

    for (const tool of allTools) {
      const name = tool.definition.name;
      const expectation = EXPECTATIONS[name] as Expectation;
      // Pristine document per tool: several of them write to the file.
      await harness.reset();
      const result = await call(harness, name, expectation.args);

      if (expectation.outcome === 'a') expectWellFormed(name, result, expectation.structured === true);
      else expectCapabilityError(name, result);

      outcomes[name] = expectation.outcome;
    }

    // The table the report is built from: every tool exercised, and the split
    // derived from the table itself so it cannot drift from the expectations.
    expect(Object.keys(outcomes)).toHaveLength(allTools.length);
    const expected = Object.values(EXPECTATIONS);
    expect(Object.values(outcomes).filter((value) => value === 'a')).toHaveLength(
      expected.filter((entry) => entry.outcome === 'a').length,
    );
    expect(Object.values(outcomes).filter((value) => value === 'b')).toHaveLength(
      expected.filter((entry) => entry.outcome === 'b').length,
    );
    // A tool cannot be in both halves, and nothing is unclassified.
    expect(Object.values(outcomes).every((value) => value === 'a' || value === 'b')).toBe(true);
  });

  it('rejects missing and invalid arguments with a clear error, never a throw', async () => {
    const harness = await startParityHarness();
    harnesses.push(harness);

    for (const tool of allTools) {
      const name = tool.definition.name;
      // No arguments at all: whatever the tool does, it must answer.
      await harness.reset();
      const empty = await call(harness, name, {});
      expect(empty, `${name} returned no result`).toBeTruthy();
      expect(Array.isArray(empty.content), `${name} returned no content`).toBe(true);
      const text = (empty.content ?? []).map((item) => item.text ?? '').join('\n');
      if (empty.isError) {
        expect(text.length, `${name} errored without saying why`).toBeGreaterThan(0);
        // A capability error must be explicit; anything else must be a real
        // explanation (validation), not an internal crash.
        const capability = empty.structuredContent?.supported === false;
        if (!capability) expect(text, `${name} leaked an internal failure`).not.toMatch(/Tool failed|Cannot read propert|is not a function/i);
      }
    }

    // Explicitly invalid arguments for tools with required inputs.
    const invalid: Array<[string, Record<string, unknown>, RegExp]> = [
      ['use_pigma', { code: 'this is not javascript((' }, /plugin script failed|error/i],
      ['use_pigma', {}, /provide `code`|`code`/i],
      ['get_screenshot', { nodeId: 'no-such-node' }, /unknown|not found|no such/i],
      ['get_design_context', { nodeId: 'no-such-node' }, /unknown|not found|no such/i],
      ['download_assets', { nodeIds: [] }, /at least one|nodeIds/i],
      ['upload_assets', { images: [] }, /images|at least one/i],
      ['add_code_connect_map', { nodeId: '1:2' }, /required|componentName|source/i],
      ['get_context_for_code_connect', {}, /nodeId/i],
      ['send_code_connect_mappings', { mappings: [] }, /mapping/i],
      ['search_design_system', {}, /queries|query/i],
      ['get_variable_defs', { nodeId: 'nope' }, /unknown|not found|no such|document/i],
    ];
    for (const [name, args, pattern] of invalid) {
      await harness.reset();
      const result = await call(harness, name, args);
      expect(result.isError, `${name} should reject ${JSON.stringify(args)}`).toBe(true);
      const text = (result.content ?? []).map((item) => item.text ?? '').join('\n');
      expect(text, `${name} rejection must explain itself: ${text}`).toMatch(pattern);
      expect(text, `${name} rejection leaked an internal failure`).not.toMatch(/Cannot read propert|is not a function/i);
    }
  });
});

describe('a harness that calls before loading a document', () => {
  it('gets a clear, recoverable error from every tool — never a throw', async () => {
    // The state a client can genuinely hit: connected, no document open yet.
    // `create_new_file` is the one tool that must *succeed* here: it is what
    // creates the document, so demanding one would make the "no document is
    // loaded" message point at the tool that fixes it. (That was a real defect;
    // this matrix and tests/mcp/stdioTransport.test.ts are its regression test.)
    const server = createMcpServer({ session: createSession(null) });
    for (const tool of allTools) {
      const name = tool.definition.name;
      const response = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } });
      const result = (response as { result?: ToolResult }).result;
      expect(result, `${name} returned no result`).toBeTruthy();
      if (name === 'create_new_file') {
        expect(result?.isError, 'create_new_file must create the first document').toBeFalsy();
        expect(result?.structuredContent?.documentId, 'create_new_file should report the document').toBeTruthy();
        continue;
      }
      expect(result?.isError, `${name} must not claim success without a document`).toBe(true);
      const text = (result?.content ?? []).map((item) => item.text ?? '').join('\n');
      expect(text.length, `${name} errored without a reason`).toBeGreaterThan(0);
      // Either an explicit capability error, or a precondition error that says
      // what to do (load a document) — never an internal crash.
      const capability = result?.structuredContent?.supported === false;
      if (!capability) {
        expect(text, `${name} precondition error should say how to recover: ${text}`).toMatch(
          /document|nodeId|node|required|provide|code|mapping|queries|images/i,
        );
        expect(text, `${name} leaked an internal failure`).not.toMatch(/Tool failed|Cannot read propert|is not a function/i);
      }
    }
  });
});

describe('the first document on a fresh server', () => {
  it('is created by create_new_file, and everything reads it afterwards', async () => {
    const server = createMcpServer({ session: createSession(null) });
    const call = (name: string, args: Record<string, unknown>) =>
      server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

    // Before: the tool that creates a document must not demand one.
    const created = (await call('create_new_file', { name: 'First', editorType: 'design' })) as { result?: ToolResult };
    expect(created.result?.isError).toBeFalsy();
    expect(created.result?.structuredContent?.documentId).toBeTruthy();

    // After: the document is open, so the reading tools work on it.
    const metadata = (await call('get_metadata', {})) as { result?: ToolResult };
    expect(metadata.result?.isError).toBeFalsy();
    expect((metadata.result?.content ?? [])[0]?.text ?? '').toContain('Page 1');

    // And a real write lands in it: the node the script created is readable back.
    const drawn = (await call('use_pigma', { code: "figma.createRectangle({ name: 'First rect', width: 4, height: 4 }).id;" })) as { result?: ToolResult };
    expect(drawn.result?.isError).toBeFalsy();
    const nodeId = String(drawn.result?.structuredContent?.output ?? '');
    expect(nodeId).not.toBe('');
    const design = (await call('get_design_context', { nodeId })) as { result?: ToolResult };
    expect(design.result?.isError).toBeFalsy();
    expect(JSON.stringify(design.result?.structuredContent ?? {})).toContain('First rect');
  });
});
