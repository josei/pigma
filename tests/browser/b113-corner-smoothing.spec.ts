/**
 * Corner smoothing (Figma's Corner smoothing): the Smoothing field in the properties panel reshapes a rectangle's
 * corners from circular arcs to smoothed curves, and 0 returns them to arcs. The geometry is unit-tested
 * (cornerSmoothing.test.ts); this drives the live panel and reads the drawn path.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, field } from './helpers';

/** The canvas paths that draw a rounded rectangle: a corner is an arc (A) or a smoothed cubic (C). */
async function cornerCommands(page: import('@playwright/test').Page): Promise<{ arcs: number; cubics: number }> {
  return page.locator('.canvas path').evaluateAll((paths) => {
    let arcs = 0;
    let cubics = 0;
    for (const path of paths) {
      const d = path.getAttribute('d') ?? '';
      if (/ A /.test(d)) arcs += 1;
      if (/ C /.test(d)) cubics += 1;
    }
    return { arcs, cubics };
  });
}

test('B113a the Smoothing field turns a rectangle\'s circular corners into smoothed curves, and 0 turns them back', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await field(page, 'Radius').fill('20');
  await field(page, 'Radius').press('Enter');
  await expect.poll(() => cornerCommands(page)).toEqual(expect.objectContaining({ cubics: 0 }));

  await field(page, 'Smoothing').fill('60');
  await field(page, 'Smoothing').press('Enter');
  await expect.poll(async () => (await cornerCommands(page)).cubics, { message: 'the corners should be smoothed curves' }).toBeGreaterThan(0);
  await expect(field(page, 'Smoothing')).toHaveValue('60');

  await field(page, 'Smoothing').fill('0');
  await field(page, 'Smoothing').press('Enter');
  await expect.poll(async () => (await cornerCommands(page)).cubics).toBe(0);
});
