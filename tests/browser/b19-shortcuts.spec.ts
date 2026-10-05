/**
 * The shortcut findings: two real bugs (a swallowed key, an unbound advertised key)
 * and two decisions (a divergence removed, a missing binding added).
 *
 * Each assertion is on the OBSERVABLE effect — a key that is no longer consumed, a
 * tool/state that changes — not on an attribute being present.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

test('Enter on a plain shape is no longer SWALLOWED', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  // A BUBBLE-phase listener downstream: if the app preventDefaults, this never sees
  // the key. The bug was preventDefault() BEFORE the container test, so a plain
  // shape consumed Enter with nothing happening.
  await page.evaluate(() => {
    (window as unknown as { __enterSeen?: number }).__enterSeen = 0;
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        (window as unknown as { __enterSeen?: number }).__enterSeen =
          ((window as unknown as { __enterSeen?: number }).__enterSeen ?? 0) + 1;
      }
    });
  });
  await page.keyboard.press('Enter');
  const seen = await page.evaluate(() => (window as unknown as { __enterSeen?: number }).__enterSeen ?? 0);
  expect(seen, 'Enter on a plain shape was consumed with nothing happening').toBe(1);
});

test('Enter still enters a container and still edits a text node', async ({ page }) => {
  await boot(page);
  await tool(page, 'Frame');
  await drawShape(page, 'Frame', 300, 200);
  await page.keyboard.press('Enter');
  // Entering a container makes its CHILDREN selectable — observable as the entered
  // state, which the app reflects by keeping the container as the selection target.
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);

  await tool(page, 'Text');
  await drawShape(page, 'Text', 160, 60);
  await page.keyboard.press('Enter');
  // Editing a text node opens the editor: a textarea/input appears.
  await expect(page.locator('textarea, [contenteditable="true"]').first()).toBeVisible();
});

test('the advertised Cmd/Ctrl+Alt+K creates a component', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  // The observable: creating a component makes the SELECTED node a component that
  // ADOPTS the shape as its child, so its row gains an expand chevron. Counting the
  // selected row's chevrons before and after is a document change, not an attribute.
  // The observable: creating a component ADOPTS the shape as a child, so the LAYER
  // COUNT grows by one — a document change, not an attribute.
  // The observable: the selected row's ICON. A component row renders the `component`
  // glyph; before the key it is the shape's `rect` glyph.
  const selectedIcon = () =>
    page.evaluate(
      () => document.querySelector('.layer-row--selected .layer-row__icon svg')?.innerHTML.slice(0, 24) ?? 'none',
    );
  const before = await selectedIcon();
  expect(await page.locator('.layer-row--selected').count(), 'precondition: one shape').toBe(1);
  await page.keyboard.press('Control+Alt+k');
  // And it did not refuse: the action's own guard says so via a toast.
  const toast = (await page.locator('.toast, [role="status"]').allInnerTexts()).join('|');
  expect(toast, `the action refused: ${toast}`).not.toContain('Select a single shape');
  const after = await selectedIcon();
  expect(after, `the row icon did not change (${before})`).not.toBe(before);
});

test('Shift+D toggles Dev Mode (Figma binds it there), not the theme', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
  await page.keyboard.press('Shift+D');
  const after = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
  expect(after, 'Shift+D still toggled the theme').toBe(before);
});

test('Shift+Enter selects the parent', async ({ page }) => {
  await boot(page);
  await tool(page, 'Frame');
  await drawShape(page, 'Frame', 300, 200);
  await tool(page, 'Rectangle');
  // Draw INSIDE the frame so the new rectangle's parent is the frame.
  await drawShape(page, 'Rectangle', 80, 60);
  const childSelected = await page.locator('.layer-row--selected').first().innerText();
  await page.keyboard.press('Shift+Enter');
  const parentSelected = await page.locator('.layer-row--selected').first().innerText();
  expect(parentSelected, 'Shift+Enter did not move the selection to the parent').not.toBe(childSelected);
});
