import { test, expect, connectEditor, mcpCall } from './relay';
import { field } from './helpers';

/**
 * A document built through the MCP is SETTLED exactly like an editor edit.
 *
 * The MCP write path takes a file the session has assembled and writes it to
 * disk; without settling, every derived geometry stays as the script left it -
 * auto-sized text kept the factory's hardcoded 100 x 16.8 box, and a boolean
 * never re-evaluated. The editor's own properties panel is the strongest
 * available witness here: it reads the document the bridge delivered, so if the
 * settle were skipped these values would be the stale ones.
 */

const STALE_WIDTH = 100; // createTextNode's hardcoded default
const STALE_HEIGHT = 16.8; // DEFAULT_FONT_SIZE (14) * 1.2

/** Run a plugin script through the MCP, failing with its message if it errors. */
async function runScript(relay: Parameters<typeof mcpCall>[0], code: string): Promise<void> {
  const response = (await mcpCall(relay, 'tools/call', {
    name: 'use_pigma',
    arguments: { code },
  })) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
  expect(
    response.result?.isError ?? false,
    `the script failed: ${response.result?.content?.[0]?.text ?? JSON.stringify(response).slice(0, 200)}`,
  ).toBe(false);
}

test('B54a an MCP-created text node reaches the editor with its SETTLED box', async ({ page, relay }) => {
  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  await connectEditor(page, relay);

  // A 20px label with real characters. The factory would leave this at 100 x 16.8
  // until something settles it.
  await runScript(
    relay,
    `const t = figma.createText();
t.name = 'Settled Label';
t.characters = 'Hello settled world';
t.fontSize = 20;
t.x = 60; t.y = 60;
figma.currentPage.appendChild(t);
figma.currentPage.selection = [t];`,
  );

  // The editor's own document: the node must exist and carry settled geometry.
  const node = await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const store = window.__pigmaStore;
          if (!store) throw new Error('window.__pigmaStore is not exposed');
          const walk = (nodes: Array<{ name?: string; children?: unknown[] }>): { w: number; h: number } | null => {
            for (const n of nodes) {
              if (n.name === 'Settled Label') return { w: (n as { width: number }).width, h: (n as { height: number }).height };
              const hit = walk((n.children ?? []) as Array<{ name?: string; children?: unknown[] }>);
              if (hit) return hit;
            }
            return null;
          };
          return walk((store.getState() as unknown as { file: { document: { children: Array<{ name?: string; children?: unknown[] }> } } }).file.document.children);
        }),
      { timeout: 10000 },
    )
    .not.toBeNull()
    .then(async () => {
      const read = await page.evaluate(() => {
        const store = window.__pigmaStore!;
        const walk = (nodes: Array<{ name?: string; children?: unknown[] }>): { w: number; h: number } | null => {
          for (const n of nodes) {
            if (n.name === 'Settled Label') return { w: (n as { width: number }).width, h: (n as { height: number }).height };
            const hit = walk((n.children ?? []) as Array<{ name?: string; children?: unknown[] }>);
            if (hit) return hit;
          }
          return null;
        };
        return walk((store.getState() as unknown as { file: { document: { children: Array<{ name?: string; children?: unknown[] }> } } }).file.document.children);
      });
      return read!;
    });

  // Height is the auto-size formula for the scripted font size: 20 * 1.2.
  expect(node.h, `the text height is the STALE default ${STALE_HEIGHT}, not settled`).not.toBeCloseTo(STALE_HEIGHT, 1);
  expect(node.h, `the text height ${node.h} is not the settled 24 for a 20px face`).toBeCloseTo(24, 1);
  // Width is measured from the characters, not the hardcoded 100.
  expect(node.w, 'the text width is still the stale default of 100').not.toBe(STALE_WIDTH);
  expect(node.w, `the text width ${node.w} did not grow with its characters`).toBeGreaterThan(STALE_WIDTH);

  // And the editor's own properties panel reports the same box, so this is what
  // the app shows. The selection is made through the store because after
  // `connectEditor` the LEFT panel is on the Tools tab, not Layers.
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const state = store.getState() as unknown as {
      file: { document: { children: Array<{ name?: string; id: string; children?: unknown[] }> } };
      select: (ids: string[]) => void;
    };
    const walk = (nodes: Array<{ name?: string; id: string; children?: unknown[] }>): string | null => {
      for (const n of nodes) {
        if (n.name === 'Settled Label') return n.id;
        const hit = walk((n.children ?? []) as Array<{ name?: string; id: string; children?: unknown[] }>);
        if (hit) return hit;
      }
      return null;
    };
    const id = walk(state.file.document.children);
    if (!id) throw new Error('the settled text node is missing');
    state.select([id]);
  });
  await page.waitForTimeout(300);
  const panelW = Number(await field(page, 'W').inputValue());
  const panelH = Number(await field(page, 'H').inputValue());
  expect(panelH, `the properties panel shows the stale height ${panelH}`).toBeCloseTo(node.h, 1);
  expect(panelW, `the properties panel shows the stale width ${panelW}`).toBeCloseTo(node.w, 1);
  expect(panelH).not.toBeCloseTo(STALE_HEIGHT, 1);
});

test('B54b an MCP-created boolean re-evaluates when an operand moves', async ({ page, relay }) => {
  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  await connectEditor(page, relay);

  // Build two overlapping rectangles and union them, then move one operand, all
  // through the MCP. A stale boolean would keep the first union's outline.
  await runScript(
    relay,
    `const a = figma.createRectangle();
a.name = 'Op A';
a.x = 0; a.y = 0; a.resize(120, 120);
figma.currentPage.appendChild(a);
const b = figma.createRectangle();
b.name = 'Op B';
b.x = 60; b.y = 60; b.resize(120, 120);
figma.currentPage.appendChild(b);
figma.currentPage.selection = [a, b];
figma.union([a, b]);`,
  );

  const readUnion = () =>
    page.evaluate(() => {
      const store = window.__pigmaStore!;
      const walk = (nodes: Array<{ type?: string; pathData?: string; children?: unknown[] }>): string | null => {
        for (const n of nodes) {
          if (n.type === 'BOOLEAN_OPERATION') return n.pathData ?? null;
          const hit = walk((n.children ?? []) as Array<{ type?: string; pathData?: string; children?: unknown[] }>);
          if (hit) return hit;
        }
        return null;
      };
      return walk((store.getState() as unknown as { file: { document: { children: Array<{ type?: string; children?: unknown[] }> } } }).file.document.children);
    });

  const before = await expect.poll(readUnion, { timeout: 10000 }).not.toBeNull().then(readUnion);
  expect(before, 'the union produced no geometry').toBeTruthy();

  // Move an operand through the MCP: the boolean is live, so its outline must move.
  // `findOne` is not part of the supported plugin surface here, but `children`
  // is - and after a union the operands are nested inside the boolean, so walk
  // the tree rather than looking at direct children only.
  await runScript(
    relay,
    `const find = (nodes) => {
  for (const n of nodes) {
    if (n.name === 'Op B') return n;
    const hit = find(n.children || []);
    if (hit) return hit;
  }
  return null;
};
const op = find(figma.currentPage.children);
if (!op) throw new Error('Op B not found');
op.x = 200;`,
  );
  await expect
    .poll(readUnion, { timeout: 10000 })
    .not.toBe(before);
});
