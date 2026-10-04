/**
 * The in-app plugin runner enforces the same document invariants as the MCP path.
 *
 * `runPlugin` used to hand the script's file straight to `apply`, which settles
 * but does not validate: `node.opacity = 42` was REFUSED through the MCP
 * `use_pigma` tool and COMMITTED from the editor's own plugin panel — the same
 * script, the same engine, two different outcomes. Both now run the one shared
 * `documentProblems`, before the store sees anything, so a refusal leaves the
 * document AND the undo history untouched and surfaces as a console error plus a
 * toast instead of throwing at a user.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getQuickJS } from 'quickjs-emscripten';
import { useEditor } from './editorStore';
import { setPluginEngine } from '../plugins/browserLoader';
import { createPluginEngine, type QuickJSModuleLike } from '../plugins/engine';
import { emptyFile } from '../model/validate';
import { createRectNode } from '../model/factory';

const store = () => useEditor.getState();

beforeEach(() => {
  setPluginEngine(createPluginEngine(async () => (await getQuickJS()) as unknown as QuickJSModuleLike));
  useEditor.getState().loadFile(emptyFile('Plugin invariants'));
});

afterEach(() => {
  setPluginEngine(null as never);
});

/**
 * Register a plugin and run it. Only the console lines the run itself produced
 * are reported: the console is state and survives a load.
 */
async function run(source: string): Promise<{ errors: string[]; toasts: string[]; history: number; nodes: number }> {
  const before = store().pluginConsole.length;
  const id = store().savePlugin({ name: 'Probe', source });
  await store().runPlugin(id);
  const state = store();
  return {
    errors: state.pluginConsole.slice(before).filter((entry) => entry.kind === 'error').map((entry) => entry.text),
    toasts: state.toasts.map((toast) => toast.message),
    history: state.past.length,
    nodes: (state.file.document.children[0] as { children: unknown[] }).children.length,
  };
}

describe('in-app plugin runs are validated', () => {
  it('refuses a script that produces an invalid document, leaving history untouched', async () => {
    // A rectangle first, so the refusal has something to leave alone.
    const seeded = await run("figma.createRectangle({ x: 0, y: 0, width: 10, height: 10, name: 'Seeded' }).id;");
    expect(seeded.errors).toEqual([]);
    expect(seeded.nodes).toBe(1);

    const refused = await run("figma.createRectangle({ x: 0, y: 0, width: 10, height: 10 }).opacity = 42;");
    const message = refused.errors.join(' ');
    expect(message, 'the run was not refused').toMatch(/invalid/);
    expect(message, 'the refusal should name the field').toContain('opacity must be between 0 and 1');
    expect(message, 'the refusal should name the node').toMatch(/RECTANGLE "/);
    expect(refused.toasts.join(' ')).toMatch(/invalid/);
    // Nothing was committed: one rectangle, and no new undo entry.
    expect(refused.nodes).toBe(1);
    expect(refused.history).toBe(seeded.history);
  });

  it('refuses a negative size and a malformed colour the same way', async () => {
    await run("figma.createRectangle({ x: 0, y: 0, width: 10, height: 10 }).id;");
    const negative = await run("figma.getNodeById(figma.currentPage.children[0].id).resize(-10, 10);");
    expect(negative.errors.join(' ')).toMatch(/width must not be negative/);

    const colour = await run(
      "figma.getNodeById(figma.currentPage.children[0].id).fills = [{ type: 'SOLID', color: { r: 2, g: 0, b: 0 } }];",
    );
    expect(colour.errors.join(' ')).toMatch(/colour\.r must be between 0 and 1/);
  });

  it('still commits a valid script as ONE undo entry', async () => {
    const before = store().past.length;
    const ok = await run("figma.createRectangle({ x: 0, y: 0, width: 20, height: 20, name: 'Fine' });");
    expect(ok.errors).toEqual([]);
    expect(ok.nodes).toBe(1);
    expect(store().past.length, 'a valid run is one history entry').toBe(before + 1);
  });

  it('matches the MCP path: the same script lands the same way', async () => {
    // The asymmetry that started this: refused through the MCP, committed in-app.
    await run("figma.createRectangle({ x: 0, y: 0, width: 10, height: 10 }).id;");
    const nodesBefore = (store().file.document.children[0] as { children: unknown[] }).children.length;
    const inApp = await run("figma.getNodeById(figma.currentPage.children[0].id).opacity = 42;");
    expect(inApp.errors.join(' ')).toMatch(/opacity must be between 0 and 1/);
    expect((store().file.document.children[0] as { children: unknown[] }).children.length).toBe(nodesBefore);

    // The MCP session refuses the same file with the same wording.
    const { createSession } = await import('../mcp/session');
    const file = emptyFile('MCP');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 0, 0, 10, 10);
    (rect as { opacity: number }).opacity = 42;
    page.children = [rect];
    let mcp = '';
    try {
      createSession(emptyFile('Base')).setFile(file);
    } catch (error) {
      mcp = (error as Error).message;
    }
    expect(mcp).toMatch(/opacity must be between 0 and 1/);
  });
});
