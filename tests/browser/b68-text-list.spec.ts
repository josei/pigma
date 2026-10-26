import { test, expect } from '@playwright/test';
import { boot, tool } from './helpers';

/** A text layer can be a bulleted or numbered list, set from the Text section. */
test('B68a a bulleted list puts a bullet on each line, and the box grows with it', async ({ page }) => {
  await boot(page, { blank: true });
  await page.keyboard.press('t');
  await page.mouse.click(420, 260);
  await page.keyboard.type('First');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await page.keyboard.press('Escape');
  await tool(page, 'Move').click();
  const before = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as any).width);
  await page.locator('[role="group"][aria-label="List"] button', { hasText: '•' }).click();
  const after = await page.evaluate(() => {
    const node = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as any;
    return { list: node.style.listType, width: node.width };
  });
  expect(after.list).toBe('UNORDERED');
  expect(after.width, 'the list marker did not widen the auto-size box').toBeGreaterThan(before);
  await expect(page.locator('.canvas__svg text', { hasText: '• First' }).first()).toBeAttached();
});

test('B68b a numbered list counts its lines', async ({ page }) => {
  await boot(page, { blank: true });
  await page.keyboard.press('t');
  await page.mouse.click(420, 260);
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Beta');
  await page.keyboard.press('Escape');
  await tool(page, 'Move').click();
  await page.locator('[role="group"][aria-label="List"] button', { hasText: '1.' }).click();
  await expect(page.locator('.canvas__svg text', { hasText: '2. Beta' }).first()).toBeAttached();
});

test('B68c a wrapped list item hangs its second line under the text', async ({ page }) => {
  await boot(page, { blank: true });
  await page.keyboard.press('t');
  await page.mouse.click(420, 260);
  await page.keyboard.type('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu');
  await page.keyboard.press('Escape');
  await tool(page, 'Move').click();
  await page.locator('[role="group"][aria-label="List"] button', { hasText: '•' }).click();
  // Fixed width, so the item has to wrap.
  await page.evaluate(() => {
    const s = window.__pigmaStore!.getState();
    const id = s.file.document.children[0]!.children[0]!.id;
    s.select([id]);
    s.updateSelected({ width: 120, style: { ...(s.file.document.children[0]!.children[0] as any).style, textAutoResize: 'HEIGHT' } } as never, 'Fix width');
  });
  // Each wrapped line is its own tspan inside the text element.
  const lines = await page.evaluate(() => {
    const text = [...document.querySelectorAll('.canvas__svg text')].find((t) => (t.textContent ?? '').includes('alpha'));
    return text ? [...text.querySelectorAll('tspan')].map((t) => t.textContent ?? '') : [];
  });
  expect(lines.length, `expected a wrapped item, got ${JSON.stringify(lines)}`).toBeGreaterThan(1);
  expect(lines[0]!.startsWith('•')).toBe(true);
  expect(lines.slice(1).every((line) => line.startsWith(' '))).toBe(true);
});
