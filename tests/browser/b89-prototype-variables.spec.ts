import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/**
 * Prototype variables, slice 1: a SET_VARIABLE action runs on a click and holds its
 * value for the presentation. There is no authoring UI yet, so the interaction is set
 * through the store; the presentation exposes its variable values for the check.
 */
test('B89a a click that sets a variable holds its value for the presentation', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 300, 220, 0, 0);
  // A clickable rectangle inside the frame, which the trigger belongs to.
  await drawShape(page, 'Rectangle', 80, 60, 0, 0);
  const rectId = await page.evaluate(() => {
    const frame = (window.__pigmaStore!.getState().file.document.children[0]!.children as any[])[0];
    return frame.children[0].id as string;
  });
  await page.evaluate((id) => {
    window.__pigmaStore!.getState().apply('Trigger', (file) => {
      const fix = (node: any): any => (node.id === id
        ? { ...node, interactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'SET_VARIABLE', variableId: 'open', variableValue: true }] }] }
        : node.children ? { ...node, children: node.children.map(fix) } : node);
      return { ...file, document: fix(file.document) };
    });
  }, rectId);

  // The start frame: presentation plays from the page's prototype start.
  await page.evaluate(() => {
    const frame = (window.__pigmaStore!.getState().file.document.children[0]!.children as any[])[0];
    window.__pigmaStore!.getState().setPrototypeStart(frame.id);
  });

  await tool(page, 'Present').click();
  await page.waitForTimeout(500);
  const hotspot = page.locator('.present__hotspot').first();
  await expect(hotspot).toBeVisible();
  await expect(page.locator('.present')).toHaveAttribute('data-variables', '{}');
  await hotspot.click();
  await page.waitForTimeout(200);
  await expect(page.locator('.present'), 'the click did not set the variable').toHaveAttribute('data-variables', '{"open":true}');
});
