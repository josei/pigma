/**
 * A text style edit reaches a child of an instance the way a colour edit does: the instance records the child's style as
 * an override, so the component keeps its own size and the instance shows the new one. A text layer outside the instance
 * changes as before. The override is applied by applyOverride (instances.test.ts); this drives the live editor.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, clickCanvas, field, nextPaint, tool } from './helpers';

/** A text layer at a horizontal offset, with the given size. */
async function textLayer(page: Page, dx: number, dy: number, size: number) {
  await tool(page, 'Text').click();
  await clickCanvas(page, dx, dy);
  await nextPaint(page);
  if (await page.locator('.text-editor').count()) {
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
  }
  await nextPaint(page);
  await field(page, 'Size').fill(String(size));
  await field(page, 'Size').press('Enter');
  await nextPaint(page);
}

/** A text component, one instance of it inserted, and a text layer outside the instance; the layer is selected. */
async function componentAndSibling(page: Page) {
  await boot(page, { blank: true });
  await textLayer(page, 0, 0, 14);
  await tool(page, 'Create component').click();
  await nextPaint(page);
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.locator('.app__left .layer-row').first().dblclick();
  await nextPaint(page);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await textLayer(page, 0, -300, 14);
}

const ids = (page: Page) =>
  page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ id: string; type: string; children?: Array<{ id: string }> }>;
    const instance = kids.find((node) => node.type === 'INSTANCE')!;
    const sibling = kids.find((node) => node.type === 'TEXT')!;
    return { c: instance.children![0]!.id, s: sibling.id };
  });

async function selectChildAndSibling(page: Page) {
  const { c, s } = await ids(page);
  await page.evaluate(({ c, s }: { c: string; s: string }) => {
    const state = window.__pigmaStore!.getState();
    state.select([c], 'replace');
    state.select([s], 'add');
  }, { c, s });
  await nextPaint(page);
}

test('B147a a size typed on a text child of an instance is an override, and the component keeps its size', async ({ page }) => {
  await componentAndSibling(page);
  await selectChildAndSibling(page);
  await field(page, 'Size').fill('30');
  await field(page, 'Size').press('Enter');
  await nextPaint(page);

  const after = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    const instance = kids.find((node) => node.type === 'INSTANCE');
    const component = kids.find((node) => node.type === 'COMPONENT');
    const override = Object.values(instance.overrides ?? {})[0] as { style?: { fontSize: number } } | undefined;
    return {
      overrideSize: override?.style?.fontSize,
      componentSize: component.children[0].style.fontSize,
      instanceChildSize: instance.children[0].style.fontSize,
      siblingSize: kids.find((node) => node.type === 'TEXT').style.fontSize,
    };
  });
  expect(after.overrideSize).toBe(30);
  expect(after.componentSize).toBe(14);
  expect(after.instanceChildSize).toBe(30);
  expect(after.siblingSize).toBe(30);
});

test('B147b one undo reverts the instance override with the sibling', async ({ page }) => {
  await componentAndSibling(page);
  await selectChildAndSibling(page);
  await field(page, 'Size').fill('30');
  await field(page, 'Size').press('Enter');
  await nextPaint(page);
  // The edit must have recorded its override first, or the undo below has nothing to revert.
  await expect.poll(() => page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    const instance = kids.find((node) => node.type === 'INSTANCE');
    return (Object.values(instance.overrides ?? {})[0] as { style?: { fontSize: number } } | undefined)?.style?.fontSize;
  })).toBe(30);
  await page.keyboard.press('ControlOrMeta+z');
  await nextPaint(page);
  const undone = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    const instance = kids.find((node) => node.type === 'INSTANCE');
    const override = Object.values(instance.overrides ?? {})[0] as { style?: { fontSize: number } } | undefined;
    return { overrideSize: override?.style?.fontSize ?? null, siblingSize: kids.find((node) => node.type === 'TEXT').style.fontSize };
  });
  expect(undone.siblingSize).toBe(14);
  expect(undone.overrideSize === null || undone.overrideSize === 14).toBe(true);
});

test('B147c moving a text child of an instance does not freeze its style, so a component text edit still reaches it', async ({ page }) => {
  await boot(page, { blank: true });
  await textLayer(page, 0, 0, 14);
  await tool(page, 'Create component').click();
  await nextPaint(page);
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.locator('.app__left .layer-row').first().dblclick();
  await nextPaint(page);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  // A move is recorded as an override of position only: the instance's child takes the new x.
  const child = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    return kids.find((node) => node.type === 'INSTANCE').children[0].id as string;
  });
  await page.evaluate((c) => window.__pigmaStore!.getState().select([c], 'replace'), child);
  await nextPaint(page);
  await field(page, 'X').fill('200');
  await field(page, 'X').press('Enter');
  await nextPaint(page);
  // The component's own text changes size; the instance's child has no style override, so it follows.
  await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    window.__pigmaStore!.getState().select([kids.find((node) => node.type === 'COMPONENT').children[0].id], 'replace');
  });
  await nextPaint(page);
  await field(page, 'Size').fill('30');
  await field(page, 'Size').press('Enter');
  await nextPaint(page);
  const sizes = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    const instance = kids.find((node) => node.type === 'INSTANCE');
    return { instanceChild: instance.children[0].style.fontSize, styleOverride: Object.values(instance.overrides ?? {}).some((o: any) => o.style !== undefined) };
  });
  expect(sizes.styleOverride).toBe(false);
  expect(sizes.instanceChild).toBe(30);
});
