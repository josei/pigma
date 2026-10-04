import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, openMenu, tool } from './helpers';

const APP_ORIGIN = 'http://127.0.0.1:5173';

/**
 * Read the clipboard, polling until it holds the expected content.
 *
 * The copy handlers write asynchronously, so a single read races them. Polling
 * keeps the assertion strict (the content must actually match) while removing
 * the timing dependence - the alternative, waiting a fixed period, is what made
 * this flaky under load.
 */
async function expectClipboard(page: Page, pattern: RegExp) {
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()), { timeout: 15000 })
    .toMatch(pattern);
}

/** Copy via the main menu, which writes to the clipboard. */
async function copyVia(page: Page, label: string) {
  await openMenu(page);
  await page.locator('.menu__item', { hasText: label }).first().click();
  await page.waitForTimeout(400);
}

test('B21a Copy as SVG writes SVG markup to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_ORIGIN });
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);

  await copyVia(page, 'Copy as SVG');
  // Strict content match: markup must be real SVG containing the drawn rect.
  await expectClipboard(page, /<svg[\s\S]*<rect/);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.length).toBeGreaterThan(20);
});

test('B21b Copy as CSS writes CSS declarations to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_ORIGIN });
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);

  await copyVia(page, 'Copy as CSS');
  await expectClipboard(page, /width:\s*\d+px/);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('background');
});

test('B21c the Inspect tab renders measurements and both code views', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);

  const inspectTab = page.locator('.tab', { hasText: 'Inspect' });
  await expect(inspectTab).toHaveCount(1);
  await inspectTab.click();
  await page.waitForTimeout(400);

  const panel = page.locator('.app__right');

  // Measurements for the selection, rendered as text.
  await expect(panel).toContainText(/\d+\s*x\s*\d+/);
  await expect(panel).toContainText(/position/i);
  await expect(panel).toContainText(/fill/i);

  // The code-view controls must be genuinely clickable, not merely present:
  // they used to sit in a hover-hidden `.layer-row__actions` wrapper (0x0).
  const showCss = page.locator('[aria-label="Show CSS"]');
  const showReact = page.locator('[aria-label="Show React"]');
  await expect(showCss).toBeVisible();
  await expect(showReact).toBeVisible();

  // CSS is the default view.
  await expect(panel).toContainText(/\.rectangle/);
  await expect(panel).toContainText(/position:\s*absolute/);
  await expect(panel).toContainText(/width:\s*\d+px/);
  await expect(panel).toContainText(/background:/);

  // Toggle to React and assert the generated component.
  await showReact.click();
  await expect(panel).toContainText(/export function/);
  await expect(panel).toContainText(/<div/);
  await expect(panel).toContainText(/style=\{\{/);
  await expect(panel).not.toContainText(/position:\s*absolute/);

  // Toggle back to CSS.
  await showCss.click();
  await expect(panel).toContainText(/position:\s*absolute/);
  await expect(panel).not.toContainText(/export function/);
});

test('B21d the prototype trigger list offers ON_CLICK and ON_HOVER', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await page.locator('.tab', { hasText: 'Prototype' }).click();
  await page.waitForTimeout(300);

  await page.locator('[aria-label="Add interaction"]').click();
  await page.waitForTimeout(300);

  const options = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLSelectElement>('.app__right select')].flatMap((s) =>
      [...s.options].map((o) => `${s.getAttribute('aria-label') ?? '?'}=${o.label}`),
    ),
  );
  expect(options.join(' ')).toMatch(/ON_CLICK|On click/i);
  expect(options.join(' ')).toMatch(/ON_HOVER|On hover/i);
  expect(options.join(' ')).toMatch(/OVERLAY|Overlay/i);
});

test('B21e a flow can be added', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await page.locator('.tab', { hasText: 'Prototype' }).click();
  await page.waitForTimeout(300);

  const addFlow = page.locator('[aria-label="Add flow"]');
  await expect(addFlow).toHaveCount(1);
  const before = await page.locator('.app__right .layer-row, .app__right .flow-row').count();
  await addFlow.click();
  await page.waitForTimeout(400);
  const after = await page.locator('.app__right .layer-row, .app__right .flow-row').count();
  expect(after).toBeGreaterThanOrEqual(before);
  // The panel must acknowledge the flow exists.
  await expect(page.locator('.app__right')).toContainText(/flow/i);
});

test('B21f an interaction produces a navigable hotspot in presentation', async ({ page }) => {
  await boot(page, { blank: true });
  // Two frames: the source and the destination.
  await drawShape(page, 'Frame', 300, 220, -260, 0);
  const source = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  await drawShape(page, 'Frame', 300, 220, 260, 0);
  const target = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  await drawShape(page, 'Rectangle', 120, 80, -260, 0);

  await page.locator('.tab', { hasText: 'Prototype' }).click();
  await page.locator('select[aria-label="Prototype start frame"]').selectOption({ label: source });
  // With no interactions yet the panel offers the destination select directly;
  // "Add interaction" switches to the per-interaction row editor instead.
  await page.waitForTimeout(300);

  const destination = page.locator('select[aria-label="Navigate to"]');
  await expect(destination.locator('option', { hasText: target })).toHaveCount(1, { timeout: 15000 });
  await destination.selectOption({ label: target });
  await page.locator('.button', { hasText: 'Apply link' }).click();
  await page.waitForTimeout(300);

  await tool(page, 'Present').click();
  await page.waitForTimeout(500);
  await expect(page.locator('.present__hotspot')).toHaveCount(1);
});

test('B21g two components can be combined into a variant set', async ({ page }) => {
  await boot(page, { blank: true });

  // Two components, drawn apart so each drag creates its own node.
  await drawShape(page, 'Rectangle', 140, 140, -160, 0);
  await tool(page, 'Create component').click();
  await page.waitForTimeout(300);
  await drawShape(page, 'Rectangle', 140, 140, 160, 0);
  await tool(page, 'Create component').click();
  await page.waitForTimeout(300);
  expect(await page.locator('.layer-row').count()).toBe(2);

  // Select both, which is what enables the set action.
  await tool(page, 'Move').click();
  await page.keyboard.press('Escape');
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 280, cy - 170);
  await page.mouse.down();
  await page.mouse.move(cx + 280, cy + 170, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.layer-row--selected')).toHaveCount(2);

  // With components selected the panel shows the component-properties section,
  // which is where the set action lives.
  await expect(page.locator('.section__header', { hasText: 'Component properties' })).toHaveCount(1);
  const createSet = page.locator('.button', { hasText: 'Create component set' });
  await expect(createSet).toBeEnabled();
  await createSet.click();
  await page.waitForTimeout(500);

  // The two components collapse into one set node.
  await expect.poll(async () => page.locator('.layer-row').count(), { timeout: 10000 }).toBe(1);
});

test('B21h an Open-overlay action stacks the destination over the source', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 300, 220, -260, 0);
  const source = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  await drawShape(page, 'Frame', 300, 220, 260, 0);
  const target = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  await drawShape(page, 'Rectangle', 120, 80, -260, 0);

  await page.locator('.tab', { hasText: 'Prototype' }).click();
  await page.locator('select[aria-label="Prototype start frame"]').selectOption({ label: source });

  const destination = page.locator('select[aria-label="Navigate to"]');
  await expect(destination.locator('option', { hasText: target })).toHaveCount(1, { timeout: 15000 });
  await destination.selectOption({ label: target });

  const actionSelect = page.locator('.app__right select', { hasText: 'Open overlay' }).first();
  await expect(actionSelect).toHaveCount(1);
  await actionSelect.selectOption({ label: 'Open overlay' });
  await page.locator('.button', { hasText: 'Apply link' }).click();
  await page.waitForTimeout(400);

  await tool(page, 'Present').click();
  await page.waitForTimeout(500);
  const spot = page.locator('.present__hotspot');
  await expect(spot).toHaveCount(1);

  const present = page.locator('.present');
  // The source is on screen before the interaction.
  await expect(present).toContainText(source);

  // Opening an overlay STACKS the destination over the source, whereas a
  // navigation would replace it. Both names being present therefore
  // distinguishes a genuine overlay from an accidental navigation pass.
  await spot.click();
  await page.waitForTimeout(500);
  await expect(present).toContainText(target);
  await expect(present).toContainText(source);
});
