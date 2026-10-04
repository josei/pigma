/**
 * Registry-level guard coverage.
 *
 * Every write tool passes `expectedRevision` today, but nothing asserted it: a
 * future tool that forgot would silently lose the revision guard. This drives
 * every registered tool through a spy session and asserts, registry-level, that
 * every write carries the revision the session was at when it was made — so a
 * missing OR wrong revision fails, and so does a tool that starts or stops
 * writing.
 *
 * It is deliberately not a per-tool test: the writer set is pinned, and adding or
 * removing a writer is a deliberate edit here.
 */
import { describe, expect, it } from 'vitest';
import { getQuickJS } from 'quickjs-emscripten';
import { allTools } from '../../src/mcp/tools/index';
import { createPluginEngine } from '../../src/plugins/engine';
import { nodeRasterizer } from '../../src/mcp/raster.node';
import { createSession, type DocumentSession } from '../../src/mcp/session';
import { emptyFile } from '../../src/model/validate';
import { createRectNode } from '../../src/model/factory';
import type { RegisteredTool } from '../../src/mcp/registry';

/** A 1x1 transparent PNG, so an asset tool has something real to place. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * The tools that write, and the arguments that make them do it. Everything else
 * is driven with schema-derived arguments and must NOT write — which is what
 * pins the set below.
 */
const WRITERS: Record<string, (seed: { nodeId: string; pageId: string }) => Record<string, unknown>> = {
  // A script that CHANGES the document: `use_pigma` skips the write when the
  // result is unchanged, so a no-op script would prove nothing.
  use_pigma: () => ({ code: "figma.createRectangle({ x: 0, y: 0, width: 10, height: 10 }).id;" }),
  // `editorType` must be `design`, and assets must carry a real data URL.
  create_new_file: () => ({ name: 'Probe', editorType: 'design' }),
  upload_assets: () => ({ images: [{ dataUrl: TINY_PNG, name: 'Probe' }] }),
  send_code_connect_mappings: (seed) => ({
    mappings: [{ nodeId: seed.nodeId, componentName: 'Probe', source: 'const x = 1;' }],
  }),
};

/** Arguments from the tool's own schema, so a new tool is still exercised. */
function argsFor(tool: RegisteredTool, seed: { nodeId: string; pageId: string }): Record<string, unknown> {
  const hint = WRITERS[tool.definition.name];
  if (hint) return hint(seed);
  const schema = tool.definition.inputSchema as { properties?: Record<string, { type?: string }> };
  const args: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (/nodeId$/i.test(key)) args[key] = seed.nodeId;
    else if (/parentId$/i.test(key)) args[key] = seed.pageId;
    else if (spec.type === 'string') args[key] = 'Probe';
    else if (spec.type === 'number') args[key] = 1;
    else if (spec.type === 'boolean') args[key] = false;
    else if (spec.type === 'array') args[key] = [];
    else if (spec.type === 'object') args[key] = {};
  }
  return args;
}

interface Write {
  method: 'setFile' | 'setSelection';
  expectedRevision: number | undefined;
  revisionAtCall: number;
}

/** A session that records every write and the revision it was made against. */
function spySession(): { session: DocumentSession; writes: Write[]; seed: { nodeId: string; pageId: string } } {
  const file = emptyFile('Guard');
  const page = file.document.children[0]!;
  const rect = createRectNode(file.document, 0, 0, 10, 10);
  page.children = [rect];
  const real = createSession(file);
  const writes: Write[] = [];
  const revision = (): number => (real.getSnapshot?.() as { revision: number }).revision;
  const session: DocumentSession = {
    getFile: () => real.getFile(),
    getSnapshot: () => real.getSnapshot!(),
    getSelection: () => real.getSelection(),
    setFile: (next, options) => {
      writes.push({ method: 'setFile', expectedRevision: options?.expectedRevision, revisionAtCall: revision() });
      return real.setFile(next, options);
    },
    setSelection: (ids, options) => {
      writes.push({ method: 'setSelection', expectedRevision: options?.expectedRevision, revisionAtCall: revision() });
      return real.setSelection(ids, options);
    },
  };
  return { session, writes, seed: { nodeId: rect.id, pageId: page.id } };
}

describe('every registered tool that writes passes the revision guard', () => {
  it('carries the revision the session was at, on every write', async () => {
    // The plugin and raster contexts a real server supplies, so `use_pigma` and
    // `upload_assets` reach their write instead of failing early.
    const interpreter = createPluginEngine(async () => (await getQuickJS()) as never);

    const observed: string[] = [];
    const failures: string[] = [];
    for (const tool of allTools) {
      const { session, writes, seed } = spySession();
      try {
        await tool.handler(argsFor(tool, seed), { session, interpreter, rasterizer: nodeRasterizer });
      } catch {
        // The schema-derived arguments are generic; a tool may refuse them. What
        // matters is any write it DID make before refusing.
      }
      if (writes.length === 0) continue;
      observed.push(tool.definition.name);
      for (const write of writes) {
        if (write.expectedRevision === undefined) {
          failures.push(`${tool.definition.name}: ${write.method} without expectedRevision`);
        } else if (write.expectedRevision !== write.revisionAtCall) {
          failures.push(
            `${tool.definition.name}: ${write.method} passed ${write.expectedRevision} but the session was at ${write.revisionAtCall}`,
          );
        }
      }
    }

    expect(failures, `writes missing or passing the wrong revision: ${failures.join('; ')}`).toEqual([]);
    // Pinned from the registry: a tool that starts or stops writing must be a
    // deliberate edit here, and every one of these calls setFile today.
    expect(observed.sort()).toEqual(
      ['add_code_connect_map', 'create_new_file', 'generate_diagram', 'send_code_connect_mappings', 'upload_assets', 'use_pigma'],
    );
  });

  it('drives enough tools that the check above is not vacuous', () => {
    // If the pinned set ever becomes empty the assertion above would pass for the
    // wrong reason; this fails first.
    expect(Object.keys(WRITERS).length).toBeGreaterThan(0);
  });
});
