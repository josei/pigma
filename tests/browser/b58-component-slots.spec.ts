import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/**
 * Component slots / instance swap, from the panel a user actually uses.
 *
 * An instance of a STANDALONE component used to lose every property control:
 * the panel resolved definitions from `componentSetOf(instance.componentId)` and
 * fell back to the instance's own node, which owns none. `propertyOwnerOf` now
 * resolves the node that owns the definitions, so the controls render - and this
 * checks the control is offered AND that changing it reaches the canvas.
 */

const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };

async function paintSelected(page: Page, rgb: { r: number; g: number; b: number }): Promise<void> {
  await page.evaluate((colour) => {
    window.__pigmaStore!.getState().apply('Colour', (file) => {
      const id = (window.__pigmaStore!.getState() as unknown as { selection: string[] }).selection[0];
      const paintNode = (node: { id?: string; children?: unknown[] }): unknown =>
        node.id === id
          ? { ...node, fills: [{ type: 'SOLID', color: colour, opacity: 1 }] }
          : { ...node, children: ((node.children ?? []) as Array<{ id?: string; children?: unknown[] }>).map(paintNode) };
      return { ...file, document: paintNode(file.document as unknown as { children?: unknown[] }) as typeof file.document };
    });
  }, rgb);
  await page.waitForTimeout(250);
}

/** Draw a rectangle, colour it, promote it to a component; returns its name. */
async function makeComponent(page: Page, colour: { r: number; g: number; b: number }, dx: number): Promise<string> {
  await drawShape(page, 'Rectangle', 160, 120, dx, 0);
  await paintSelected(page, colour);
  await tool(page, 'Create component').click();
  await page.waitForTimeout(350);
  return (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
}

async function addSwapProperty(page: Page, name: string): Promise<void> {
  await page.locator('input[aria-label="New property name"]').fill(name);
  await page.waitForTimeout(150);
  await page.locator('[aria-label="Add instance_swap property"]').click();
  await page.waitForTimeout(400);
}

async function insertInstance(page: Page, name: string): Promise<void> {
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.locator('.app__left .layer-row', { hasText: name }).first().dblclick();
  await page.waitForTimeout(450);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.waitForTimeout(250);
}

/** The selected node's type and stored property values, plus every rendered fill. */
async function state(page: Page) {
  const node = await page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const s = store.getState() as unknown as {
      selection: string[];
      file: { document: { children: Array<{ children: Array<Record<string, unknown>> }> } };
    };
    const walk = (nodes: Array<Record<string, unknown>>): Record<string, unknown> | null => {
      for (const n of nodes) {
        if (n.id === s.selection[0]) return n;
        const hit = walk((n.children ?? []) as Array<Record<string, unknown>>);
        if (hit) return hit;
      }
      return null;
    };
    const found = walk(s.file.document.children as unknown as Array<Record<string, unknown>>)!;
    return { type: found.type as string, properties: (found.componentProperties ?? {}) as Record<string, unknown> };
  });
  const fills = await page.evaluate(() => [...document.querySelectorAll('.canvas__svg rect')].map((r) => r.getAttribute('fill')));
  return { ...node, fills };
}

/** The id of the page-level node with this name. */
async function idOf(page: Page, name: string): Promise<string> {
  return page.evaluate((wanted) => {
    const pageNode = (window.__pigmaStore!.getState() as unknown as {
      file: { document: { children: Array<{ children: Array<{ id: string; name: string }> }> } };
    }).file.document.children[0]!;
    return pageNode.children.find((n) => n.name === wanted)?.id ?? '';
  }, name);
}

test('B58a an instance of a standalone component OFFERS its properties, and a swap reaches the canvas', async ({ page }) => {
  await boot(page, { blank: true });
  const source = await makeComponent(page, RED, -160);
  await addSwapProperty(page, 'Swap target');
  const replacement = await makeComponent(page, BLUE, 160);

  await insertInstance(page, source);
  const before = await state(page);
  expect(before.type, 'the inserted node is not an instance').toBe('INSTANCE');

  // THE FLIPPED ASSERTION: the control is present on an instance of a standalone
  // component. It used to be absent - `propertyOwnerOf` resolves the owner now.
  const picker = page.locator('select[aria-label="Swap target"]');
  await expect(picker, 'an instance still does not offer its component\'s swap control').toBeVisible();
  expect(before.fills, 'the source component did not render red').toContain('rgb(255, 0, 0)');

  const replacementId = await idOf(page, replacement);
  expect(replacementId, 'the replacement component has no id').toBeTruthy();
  await picker.selectOption(replacementId);
  await page.waitForTimeout(500);

  const after = await state(page);
  // Stored...
  expect(after.properties['Swap target'], 'the swap was not stored on the instance').toBe(replacementId);
  // ...and HONOURED on the canvas: the instance repaints as the replacement.
  expect(after.fills, `the swap did not reach the canvas: ${JSON.stringify(after.fills)}`).toContain('rgb(0, 0, 255)');
});

test('B58b a component with no such property offers no such control', async ({ page }) => {
  await boot(page, { blank: true });
  // A component with NO properties at all: the control must not appear, so the
  // positive case above cannot pass vacuously.
  const plain = await makeComponent(page, RED, -160);
  await insertInstance(page, plain);

  expect((await state(page)).type, 'the inserted node is not an instance').toBe('INSTANCE');
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.app__right select')].map((s) => s.getAttribute('aria-label')),
  );
  // The panel still renders for the instance (the variable selects are there)...
  expect(labels.length, 'the instance panel rendered no selects at all').toBeGreaterThan(0);
  // ...but no property control, because there is no property to control.
  expect(labels, `an instance without properties offered a swap control: ${JSON.stringify(labels)}`).not.toContain('Swap target');
});
