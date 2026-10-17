import { test, expect } from '@playwright/test';
import { boot, docToScreen, drawShape } from './helpers';

/** Flatten outlines Inter only, so it refuses text it cannot draw faithfully, and says why. */
test('B81a Ctrl+E refuses a frame whose text is not Inter, and says what to change', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 320, 160, 200, 160);
  const frame = await page.evaluate(() => {
    const node = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as any;
    return { id: node.id, x: node.transform.tx, y: node.transform.ty };
  });
  const at = await docToScreen(page, frame.x + 40, frame.y + 60);
  await page.keyboard.press('t');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type('Serif');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const s = window.__pigmaStore!.getState();
    const text = (s.file.document.children[0]!.children[0] as any).children[0];
    s.select([text.id]);
    s.updateSelected({ style: { ...text.style, fontFamily: 'Georgia' } } as never, 'Font');
  });
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), frame.id);
  await page.keyboard.press('Control+e');
  await expect(page.getByText(/Flatten outlines Inter text only/)).toBeVisible();
  const kids = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as any).children.map((c: any) => c.type));
  expect(kids, 'the refused flatten changed the frame').toEqual(['TEXT']);
});
