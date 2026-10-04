/**
 * The naming criterion, enforced.
 *
 * `docs/MCP.md` states the criterion: tool and capability NAMES are Pigma's (the
 * product owner moved off the Figma brand because a Figma-branded name tells a
 * model it is talking to Figma, and an agent may then go looking for the design at
 * figma.com). Figma appears in DESCRIPTIONS as the compatibility statement, and in
 * identifiers that genuinely name a Figma artifact/API (`get_figjam` names a
 * FigJam board the way `.fig` names a file format).
 *
 * These assertions describe the CURRENT choice and catch **drift** — a name
 * changing by accident, a title claiming the wrong implementer, a capability tool
 * that does not say who cannot do it. They are not a prohibition: renaming is
 * allowed and deliberate (see the section in `docs/MCP.md`), and every message
 * below points at what a rename must update.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { allTools } from '../../src/mcp/tools/index';
import { createMcpServer } from '../../src/mcp/protocol';
import { createSession } from '../../src/mcp/session';

vi.setConfig({ testTimeout: 60_000 });

/**
 * The names as they stand today — the Figma dialect, chosen for drop-in
 * compatibility with clients whose config or saved skills carry these strings.
 * A deliberate rename updates this list (and the one in toolCatalog.test.ts),
 * every affected description, and adds a migration note to docs/MCP.md.
 */
const CURRENT_NAMES = [
  'add_code_connect_map',
  'create_generative_plugin',
  'create_new_file',
  'create_shader',
  'download_assets',
  'generate_diagram',
  'generate_pigma_design',
  'get_code_connect_map',
  'get_code_connect_suggestions',
  'get_context_for_code_connect',
  'get_design_context',
  'get_figjam',
  'get_generative_plugin',
  'get_libraries',
  'get_metadata',
  'get_motion_context',
  'get_screenshot',
  'get_shader',
  'get_variable_defs',
  'list_file_shaders',
  'list_generative_plugins',
  'list_shaders',
  'search_design_system',
  'send_code_connect_mappings',
  'update_generative_plugin',
  'update_shader',
  'upload_assets',
  'use_pigma',
  'weave_cancel_tool_run',
  'weave_get_tool_inputs',
  'weave_get_tool_run_output',
  'weave_list_tools',
  'weave_run_tool',
  'weave_upload_asset',
  'whoami',
];

describe('the tool names are Pigma\'s (after the rename off the Figma brand)', () => {
  it('matches the pinned name set (this is what catches drift)', () => {
    const actual = allTools.map((tool) => tool.definition.name).sort();
    expect(
      actual,
      'The tool names changed. If that was accidental, revert it. If it was a deliberate rename ' +
        '(the product owner may decide to move off the Figma dialect), update the pinned set in ' +
        'tests/mcp/toolCatalog.test.ts and here, update every affected description, and add an ' +
        'old-name → new-name migration note to the Naming section of docs/MCP.md.',
    ).toEqual(CURRENT_NAMES);
  });

  it('names the tools Pigma\'s, with Figma only where it names an artifact', () => {
    // The rule after the rename: a Figma-branded NAME is allowed only when it
    // names the artifact being requested — `get_figjam` (a FigJam board), the way
    // `.fig` names a file format. Anything else Figma-branded is the misleading
    // affordance the owner moved off.
    // `get_figjam` matches on "fig", not "figma": it names the artifact (a FigJam
    // board). Nothing else may carry the brand at all.
    const branded = allTools.map((tool) => tool.definition.name).filter((name) => /fig/i.test(name));
    expect(branded, 'only artifact-naming tools may carry the Figma brand').toEqual(['get_figjam']);

    // And the two tools that used to carry it are now Pigma's.
    const names = allTools.map((tool) => tool.definition.name);
    expect(names).toContain('use_pigma');
    expect(names).toContain('generate_pigma_design');
    expect(names).not.toContain('use_figma');
    expect(names).not.toContain('generate_figma_design');
  });

  it('states the Figma relationship in the descriptions of the renamed tools', () => {
    // The rename moved the brand from the name into the description, so the
    // description has to carry what the name used to imply — plus the locality
    // statement, since that is the misleading affordance being removed.
    const usePigma = allTools.find((tool) => tool.definition.name === 'use_pigma');
    expect(usePigma?.definition.title).toBe('Use Pigma');
    expect(usePigma?.definition.description ?? '').toMatch(/FIGMA PLUGIN API/i);
    expect(usePigma?.definition.description ?? '').toMatch(/PIGMA/i);
    expect(usePigma?.definition.description ?? '').toMatch(/local/i);
    expect(usePigma?.definition.description ?? '').toMatch(/NOTHING is\s+fetched from Figma/i);

    const generate = allTools.find((tool) => tool.definition.name === 'generate_pigma_design');
    expect(generate?.definition.description ?? '').toMatch(/PIGMA HAS NO BROWSER-CAPTURE BACKEND/i);
    expect(generate?.definition.description ?? '').toMatch(/Figma captures live web UI/i);

    // `get_figjam` keeps its artifact name, and its description says what it is.
    const figjam = allTools.find((tool) => tool.definition.name === 'get_figjam');
    expect(figjam?.definition.description ?? '').toMatch(/FigJam/i);
  });

  it('keeps every title brand-neutral or Pigma-branded, never Figma-branded', () => {
    for (const tool of allTools) {
      expect(
        tool.definition.title,
        `${tool.definition.name}: titles are identity, not dialect — name Pigma or stay neutral`,
      ).not.toMatch(/figma/i);
      expect((tool.definition.title ?? '').length).toBeGreaterThan(0);
    }
  });

  it('keeps every title brand-neutral or Pigma-branded, never Figma-branded', () => {
    for (const tool of allTools) {
      expect(
        tool.definition.title,
        `${tool.definition.name}: titles are identity, not dialect — name Pigma or stay neutral`,
      ).not.toMatch(/figma/i);
      expect((tool.definition.title ?? '').length).toBeGreaterThan(0);
    }
  });
});

/**
 * The tools that can never work, pinned from the parity table (their tabled
 * outcome is (b)). A tool that reports a capability gap for one *argument* — say
 * `generate_diagram` without mermaid — is not in this set: it works.
 */
const CAPABILITY_ONLY = [
  'whoami',
  'generate_pigma_design',
  'list_generative_plugins',
  'get_generative_plugin',
  'create_generative_plugin',
  'update_generative_plugin',
  'list_shaders',
  'list_file_shaders',
  'get_shader',
  'create_shader',
  'update_shader',
  'weave_list_tools',
  'weave_get_tool_inputs',
  'weave_upload_asset',
  'weave_run_tool',
  'weave_get_tool_run_output',
  'weave_cancel_tool_run',
];

describe('a capability Pigma cannot honour says so, naming Pigma', () => {
  it('names Pigma in every capability-only description', () => {
    expect(CAPABILITY_ONLY).toHaveLength(17);
    for (const name of CAPABILITY_ONLY) {
      const tool = allTools.find((entry) => entry.definition.name === name);
      expect(tool, `${name} is not registered`).toBeTruthy();
      // The description must say who cannot do it; otherwise a model reads a
      // Figma capability that does not exist here.
      expect(
        tool?.definition.description,
        `${name}: a capability tool must name Pigma, because the description is what a model reads — a rename does not change that`,
      ).toMatch(/Pigma/i);
    }
  });

  it('never describes a working tool as unavailable', () => {
    for (const tool of allTools) {
      if (CAPABILITY_ONLY.includes(tool.definition.name)) continue;
      expect(
        tool.definition.description,
        `${tool.definition.name} works, so its description must not claim otherwise (a rename must keep this true)`,
      ).not.toMatch(/not available in Pigma|not supported by Pigma/i);
    }
  });
});

describe('Pigma-branded identifiers appear where Pigma is the subject', () => {
  it('serves pigma:// resource uris and names the server pigma', async () => {
    const server = createMcpServer({ session: createSession(null) });
    expect(server.name).toBe('pigma');

    const listed = await server.handle({ jsonrpc: '2.0', id: 1, method: 'resources/list' });
    const resources = (listed as { result?: { resources?: Array<{ uri: string; name: string }> } }).result?.resources ?? [];
    expect(resources.length).toBeGreaterThan(0);
    for (const resource of resources) {
      // The URI scheme names the implementation, not the dialect; a rename does
      // not touch it.
      expect(resource.uri, `${resource.uri} must be a pigma:// resource (the implementation's scheme)`).toMatch(/^pigma:\/\//);
      expect(resource.name).not.toMatch(/figma/i);
    }
  });

  it('advertises the capabilities under their protocol names, not brands', async () => {
    const server = createMcpServer({ session: createSession(null) });
    const initialized = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const capabilities = (initialized as { result?: { capabilities?: Record<string, unknown> } }).result?.capabilities ?? {};
    // Capability names are the protocol dialect, never branded.
    expect(Object.keys(capabilities).sort()).toEqual(['logging', 'prompts', 'resources', 'tools']);
    expect(JSON.stringify(capabilities)).not.toMatch(/pigma/i);
  });
});

describe('the rename is discoverable, not a silent break', () => {
  it('answers an old tool name with the replacement', async () => {
    const server = createMcpServer({ session: createSession(null) });
    const call = (name: string) =>
      server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }).then(
        (response) => (response as { result?: { isError?: boolean; content?: Array<{ text?: string }> } }).result,
      );

    const old = await call('use_figma');
    expect(old?.isError).toBe(true);
    expect(old?.content?.[0]?.text ?? '').toMatch(/renamed to "use_pigma"/);
    expect((await call('generate_figma_design'))?.content?.[0]?.text ?? '').toMatch(/renamed to "generate_pigma_design"/);

    // A name that never existed gets the plain error, with no invented hint.
    const never = await call('totally_unknown_tool');
    expect(never?.content?.[0]?.text ?? '').toMatch(/Unknown tool "totally_unknown_tool"/);
    expect(never?.content?.[0]?.text ?? '').not.toMatch(/renamed/);

    // And the new name is served: with no arguments it is a validation error,
    // which is how a live tool answers — never "unknown tool".
    // With no document and no arguments it is a precondition error, which is how
    // a live tool answers — never "unknown tool".
    const current = await call('use_pigma');
    expect(current?.isError).toBe(true);
    expect(current?.content?.[0]?.text ?? '').toMatch(/No Pigma document is loaded|provide `code`/i);
    expect(current?.content?.[0]?.text ?? '').not.toMatch(/Unknown tool/);
  });

  it('carries the locality statement in the server instructions', () => {
    // The CLI's INSTRUCTIONS is the one string every harness reads first.
    const source = readFileSync(new URL('../../src/mcp/bin.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/THE DOCUMENT IS LOCAL TO THIS MACHINE/);
    expect(source).toMatch(/never fetch a design from figma\.com/);
    expect(source).toMatch(/no Figma account, no Figma cloud/);
    expect(source).toMatch(/use_pigma executes/);
  });

  it('leaves no stale old name anywhere outside the migration table', () => {
    const files = ['src/mcp/protocol.ts', 'src/mcp/tools/index.ts', 'src/mcp/tools/write.ts', 'src/mcp/tools/platform.ts', 'src/mcp/bin.ts'];
    for (const file of files) {
      const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      // `use_figma` / `generate_figma_design` may appear only as the OLD side of
      // the migration map, never as a live name.
      for (const line of text.split('\n')) {
        if (!/use_figma|generate_figma_design/.test(line)) continue;
        expect(line, `${file}: a stale old name survived outside the migration map: ${line.trim()}`).toMatch(
          /use_figma: 'use_pigma'|generate_figma_design: 'generate_pigma_design'/,
        );
      }
    }
  });
});
