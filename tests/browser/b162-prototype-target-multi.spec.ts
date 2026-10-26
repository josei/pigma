/**
 * Target with several layers selected: the destination changed in the Interactions section goes to each selected layer's
 * interaction at that position, as one document change, so one undo puts every target back. Lunacy 14 lets a designer
 * assign one prototype target to several selected objects. The model is unit-tested (retargetInteractions in
 * prototype.test.ts); this drives the live panel and reads each layer's destination from the store.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The layers of the page as [id, type], in document order. */
async function layers(page: Page): Promise<Array<[string, string]>> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const pageNode = store.getState().file.document.children[0]!;
    return (pageNode.children as Array<{ id: string; type: string }>).map((layer) => [layer.id, layer.type]);
  });
}

/** The destination of each layer's first interaction, in document order, or null where it has none. */
async function destinations(page: Page): Promise<Array<string | null>> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const pageNode = store.getState().file.document.children[0]!;
    return (pageNode.children as Array<{ interactions?: Array<{ actions: Array<{ type: string; destinationId?: string | null }> }> }>).map(
      (layer) => {
        const action = layer.interactions?.[0]?.actions[0];
        return action && action.type === 'NODE' ? (action.destinationId ?? null) : null;
      },
    );
  });
}

test('B162a a target changed with two layers selected reaches both, and one undo restores both', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -120, 0);
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await drawShape(page, 'Frame', 200, 150, -120, 300);
  await drawShape(page, 'Frame', 200, 150, 200, 300);

  const all = await layers(page);
  const rectangles = all.filter(([, type]) => type === 'RECTANGLE').map(([id]) => id);
  const frames = all.filter(([, type]) => type === 'FRAME').map(([id]) => id);

  await page.evaluate((selection: string[]) => window.__pigmaStore!.getState().select(selection, 'replace'), rectangles);
  await nextPaint(page);
  await page.locator('.tab', { hasText: 'Prototype' }).click();
  await nextPaint(page);
  await page.locator('[aria-label="Add interaction"]').click();
  await nextPaint(page);
  // The default target is the first frame on the page, so both layers now point at it.
  expect(await destinations(page)).toEqual([frames[0], frames[0], null, null]);

  // Both layers stay selected, so the Target select applies to both.
  await page.locator('[aria-label="Destination 0"]').selectOption(frames[1]!);
  await nextPaint(page);
  expect(await destinations(page), 'the target did not reach both selected layers').toEqual([frames[1], frames[1], null, null]);

  // One undo entry, not one per layer: a single undo puts both back on the first frame.
  await page.keyboard.press('Control+z');
  await nextPaint(page);
  expect(await destinations(page), 'one undo left a target changed on one layer').toEqual([frames[0], frames[0], null, null]);
});
