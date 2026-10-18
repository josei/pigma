import { test, expect } from '@playwright/test';
import { boot, drawShape } from './helpers';

/**
 * Conditions on an interaction, authored in the Prototype tab (slice 3b of prototype
 * variables). The list also shows a Set variable link as that kind, not as Navigate.
 */
test('B92a an interaction is made conditional on a variable, from the Prototype tab', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 300, 220, 0, 0);
  await drawShape(page, 'Rectangle', 80, 60, 0, 0);
  const variableId = await page.evaluate(() => {
    const store = window.__pigmaStore!.getState() as any;
    store.addVariableCollection();
    const collectionId = Object.keys((window.__pigmaStore!.getState() as any).file.variableCollections ?? {})[0]!;
    window.__pigmaStore!.getState().addVariable(collectionId, 'BOOLEAN');
    return Object.keys((window.__pigmaStore!.getState() as any).file.variables ?? {})[0]!;
  });
  // A click on the rectangle sets the variable: the interaction the condition belongs to.
  await page.evaluate((id) => {
    window.__pigmaStore!.getState().apply('Link', (file) => {
      const fix = (node: any): any => (node.type === 'RECTANGLE'
        ? { ...node, interactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'SET_VARIABLE', variableId: id, variableValue: true }] }] }
        : node.children ? { ...node, children: node.children.map(fix) } : node);
      return { ...file, document: fix(file.document) };
    });
  }, variableId);
  await page.locator('.app__left .layer-row', { hasText: 'Rectangle' }).first().click();
  await page.locator('.tab', { hasText: 'Prototype' }).click();

  // The action shows as Set variable, not as Navigate to.
  await expect(page.locator('select[aria-label="Action 0"]')).toHaveValue('SET_VARIABLE');

  // Make it conditional on the variable, and choose the value it must hold.
  await page.locator('select[aria-label="Condition 0"]').selectOption(variableId);
  await page.locator('select[aria-label="Condition value 0"]').selectOption('false');
  await page.waitForTimeout(200);

  const condition = await page.evaluate(() => {
    const find = (node: any): any => (node.interactions?.length ? node : (node.children ?? []).map(find).find(Boolean));
    return find((window.__pigmaStore!.getState() as any).file.document.children[0]).interactions[0].condition;
  });
  expect(condition, 'the condition was not stored on the interaction').toEqual({ variableId, value: false });

  // Back to Always: the condition is removed.
  await page.locator('select[aria-label="Condition 0"]').selectOption('');
  await page.waitForTimeout(200);
  const cleared = await page.evaluate(() => {
    const find = (node: any): any => (node.interactions?.length ? node : (node.children ?? []).map(find).find(Boolean));
    return find((window.__pigmaStore!.getState() as any).file.document.children[0]).interactions[0].condition ?? null;
  });
  expect(cleared, 'choosing Always did not remove the condition').toBeNull();
});
