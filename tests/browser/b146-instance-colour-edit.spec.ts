/**
 * A colour edit in the Selection colours section reaches a child of an instance the way an edit to the child does: the
 * instance records an override, so the component keeps its colour and the other instances are unchanged. The override
 * builder is shared with updateSelected. This drives the live editor; the rule is covered by B145 for layers outside an
 * instance.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, nextPaint, tool } from './helpers';

/** A red component and one instance of it, the instance selected, then a red rectangle outside the instance. */
async function componentAndSibling(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 180, 120);
  await field(page, 'Fill hex').fill('FF0000');
  await field(page, 'Fill hex').press('Enter');
  await tool(page, 'Create component').click();
  await nextPaint(page);
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.locator('.app__left .layer-row').first().dblclick();
  await nextPaint(page);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await drawShape(page, 'Rectangle', 120, 90, 0, -300);
  await field(page, 'Fill hex').fill('FF0000');
  await field(page, 'Fill hex').press('Enter');
  await nextPaint(page);
}

/** The ids the store knows: the instance's child, and the rectangle on the page that is not inside an instance. */
const ids = (page: Page) =>
  page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ id: string; type: string; children?: Array<{ id: string; type: string }> }>;
    const instance = kids.find((node) => node.type === 'INSTANCE')!;
    const sibling = kids.find((node) => node.type === 'RECTANGLE')!;
    return { child: instance.children![0]!.id, sibling: sibling.id };
  });

test('B146a the edit records an override on the instance child, and the component keeps its colour', async ({ page }) => {
  await componentAndSibling(page);
  const { child, sibling } = await ids(page);
  await page.evaluate(({ c, s }: { c: string; s: string }) => {
    const state = window.__pigmaStore!.getState();
    state.select([c], 'replace');
    state.select([s], 'add');
  }, { c: child, s: sibling });
  await nextPaint(page);
  await page.getByLabel('Selection colour 1 hex').fill('00FF00');
  await page.getByLabel('Selection colour 1 hex').press('Enter');
  await nextPaint(page);

  const after = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    const instance = kids.find((node) => node.type === 'INSTANCE');
    const component = kids.find((node) => node.type === 'COMPONENT');
    const override = Object.values(instance.overrides ?? {})[0] as { fills?: Array<{ color: { g: number; r: number } }> } | undefined;
    return {
      overrideGreen: override?.fills?.[0]?.color.g,
      componentRed: component.children[0].fills[0].color.r,
      componentGreen: component.children[0].fills[0].color.g,
      siblingGreen: kids.find((node) => node.type === 'RECTANGLE').fills[0].color.g,
    };
  });
  expect(after.overrideGreen).toBeCloseTo(1, 5);
  expect(after.componentRed).toBeCloseTo(1, 5);
  expect(after.componentGreen).toBeCloseTo(0, 5);
  expect(after.siblingGreen).toBeCloseTo(1, 5);
});

test('B146b one undo reverts the instance override with the sibling', async ({ page }) => {
  await componentAndSibling(page);
  const { child, sibling } = await ids(page);
  await page.evaluate(({ c, s }: { c: string; s: string }) => {
    const state = window.__pigmaStore!.getState();
    state.select([c], 'replace');
    state.select([s], 'add');
  }, { c: child, s: sibling });
  await nextPaint(page);
  await page.getByLabel('Selection colour 1 hex').fill('00FF00');
  await page.getByLabel('Selection colour 1 hex').press('Enter');
  await nextPaint(page);
  await page.keyboard.press('ControlOrMeta+z');
  await nextPaint(page);
  const greenAfterUndo = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    const instance = kids.find((node) => node.type === 'INSTANCE');
    const override = Object.values(instance.overrides ?? {})[0] as { fills?: Array<{ color: { g: number } }> } | undefined;
    return { instanceOverrideGreen: override?.fills?.[0]?.color.g ?? null, siblingGreen: kids.find((node) => node.type === 'RECTANGLE').fills[0].color.g };
  });
  expect(greenAfterUndo.instanceOverrideGreen === null || Math.abs(greenAfterUndo.instanceOverrideGreen) < 0.01).toBe(true);
  expect(greenAfterUndo.siblingGreen).toBeCloseTo(0, 5);
});
