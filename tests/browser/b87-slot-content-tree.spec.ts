import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/**
 * Slot content in the layers tree. A component's SLOT property is bound to a frame; an
 * instance supplies content for it (`setSlotContent`), which is stored as that frame's
 * override children. Expanding the instance in the layers panel must show that content.
 */
test('B87a an instance expands in the layers tree to show the content it supplies for a slot', async ({ page }) => {
  await boot(page, { blank: true });
  // A component frame with one frame inside it: that inner frame is the slot.
  await drawShape(page, 'Frame', 200, 160, -200, 0);
  await drawShape(page, 'Frame', 100, 80, -200, 0);
  await page.locator('.app__left .layer-row', { hasText: 'Frame' }).first().click();
  await tool(page, 'Create component').click();
  await page.waitForTimeout(350);
  const componentId = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as any[]).find((n) => n.type === 'COMPONENT').id);

  // Bind a SLOT property to the inner frame, the node instances supply content for.
  const slotId = await page.evaluate((id) => {
    const comp = (window.__pigmaStore!.getState().file.document.children[0]!.children as any[]).find((n) => n.id === id);
    const slot = comp.children[0].id as string;
    window.__pigmaStore!.getState().apply('Bind slot', (file) => {
      const fix = (node: any): any => (node.id === slot
        ? { ...node, componentPropertyDefinitions: { Body: { type: 'SLOT', defaultValue: null } }, componentPropertyReferences: { slot: 'Body' } }
        : node.children ? { ...node, children: node.children.map(fix) } : node);
      return { ...file, document: fix(file.document) };
    });
    return slot;
  }, componentId);

  // The content: a rectangle with a name no other layer has.
  await drawShape(page, 'Rectangle', 40, 40, 300, 0);
  const contentId = await page.evaluate(() => {
    const rect = (window.__pigmaStore!.getState().file.document.children[0]!.children as any[]).find((n) => n.type === 'RECTANGLE');
    window.__pigmaStore!.getState().renameNode(rect.id, 'Slot content');
    return rect.id as string;
  });

  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.locator('.app__left .layer-row').first().dblclick();
  await page.waitForTimeout(450);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  const instanceId = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as any[]).find((n) => n.type === 'INSTANCE').id);
  await page.evaluate(([inst, slot, content]) => window.__pigmaStore!.getState().setSlotContent(inst, slot, [content]), [instanceId, slotId, contentId]);
  await page.waitForTimeout(300);

  // Collapsed: the content is not a top-level row.
  const collapsed = await page.locator('.app__left .layer-row', { hasText: 'Slot content' }).count();
  expect(collapsed, 'the slot content showed without expanding the instance').toBe(1);

  // Expand the instance (the top row). It shows the frame the slot is bound to; the
  // supplied content sits inside that frame, so expand the frame as well.
  await page.locator('.app__left .layer-row__chevron').first().click();
  await page.waitForTimeout(250);
  await page.locator('.app__left .layer-row__chevron').nth(1).click();
  await page.waitForTimeout(250);
  const content = page.locator('.app__left .layer-row', { hasText: 'Slot content' });
  // One row for the layer on the page, one for the copy the instance supplies.
  await expect(content, 'the slot content is not nested under the instance').toHaveCount(2);
  const rows = await page.locator('.app__left .layer-row').evaluateAll((rows) =>
    rows.map((row) => ({ text: row.textContent ?? '', pad: Number.parseFloat((row as HTMLElement).style.paddingLeft) })),
  );
  const instance = rows[0]!;
  const nested = rows.slice(1).find((row) => row.text.includes('Slot content'))!;
  expect(nested.pad, 'the supplied content is not indented under the instance').toBeGreaterThan(instance.pad);
});
