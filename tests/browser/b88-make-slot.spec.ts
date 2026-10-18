import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/** A frame inside a component can be made a slot from the context menu. */
test('B88a Make slot turns a frame inside a component into a slot, from the context menu', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 200, 160, -200, 0);
  await drawShape(page, 'Frame', 100, 80, -200, 0);
  await page.locator('.app__left .layer-row', { hasText: 'Frame' }).first().click();
  await tool(page, 'Create component').click();
  await page.waitForTimeout(350);
  // Open the component in the layers panel and pick the frame inside it.
  await page.locator('.app__left .layer-row__chevron').first().click();
  await page.waitForTimeout(200);
  const inner = page.locator('.app__left .layer-row').nth(1);
  await inner.click({ button: 'right' });
  const slot = page.locator('.menu__item', { hasText: 'Make slot' });
  await expect(slot, 'Make slot is not offered for a frame inside a component').toBeVisible();
  await expect(slot).not.toHaveClass(/menu__item--disabled/);
  await slot.click();
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => {
    const doc = (window.__pigmaStore!.getState() as any).file.document;
    const component = doc.children[0].children.find((n: any) => n.type === 'COMPONENT');
    const frame = component.children[0];
    return { definitions: component.componentPropertyDefinitions ?? {}, reference: frame.componentPropertyReferences ?? {} };
  });
  expect(state.definitions, 'the component did not define a slot').toEqual({ Slot: { type: 'SLOT', defaultValue: null } });
  expect(state.reference, 'the frame does not name the slot it holds').toEqual({ slot: 'Slot' });
});

test('B88b Make slot is disabled, with the reason, for a frame that is not inside a component', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 200, 160, -200, 0);
  await page.locator('.app__left .layer-row', { hasText: 'Frame' }).first().click({ button: 'right' });
  const slot = page.locator('.menu__item', { hasText: 'Make slot' });
  await expect(slot).toHaveClass(/menu__item--disabled/);
  await expect(slot).toHaveAttribute('data-disabled-reason', /Select a frame inside a component/);
});

test('B88c an instance of a component with a slot offers the slot in its properties', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 200, 160, -200, 0);
  await drawShape(page, 'Frame', 100, 80, -200, 0);
  await page.locator('.app__left .layer-row', { hasText: 'Frame' }).first().click();
  await tool(page, 'Create component').click();
  await page.waitForTimeout(350);
  await page.locator('.app__left .layer-row__chevron').first().click();
  await page.waitForTimeout(200);
  await page.locator('.app__left .layer-row').nth(1).click({ button: 'right' });
  await page.locator('.menu__item', { hasText: 'Make slot' }).click();
  await page.waitForTimeout(300);

  // Insert an instance of the component, from Assets.
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.locator('.app__left .layer-row', { hasText: 'Frame' }).first().dblclick();
  await page.waitForTimeout(450);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await expect(page.locator('[data-testid="slot-row-Slot"]'), 'the instance does not offer its slot').toBeVisible();
});
