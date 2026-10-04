import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, tool } from './helpers';

/** Rename the currently selected layer through the layers panel. */
async function renameSelected(page: Page, name: string) {
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.waitForTimeout(200);
  await page.locator('.layer-row--selected .layer-row__name').first().dblclick();
  const input = page.locator('.layer-row__rename-input');
  await expect(input).toHaveCount(1);
  await input.fill(name);
  await input.press('Enter');
  await page.waitForTimeout(300);
}

async function openPrototype(page: Page) {
  await page.locator('.tab', { hasText: 'Prototype' }).click();
  await page.waitForTimeout(400);
}

test('B33a a scrolling frame scrolls in presentation', async ({ page }) => {
  await boot(page, { blank: true });
  // A frame with a child taller than it, so there is something to scroll.
  await drawShape(page, 'Frame', 300, 200, 0, 0);
  const frame = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;

  // The child must be INSIDE the frame: drawing a rect that overshoots the
  // frame's bounds leaves it a page-level sibling (verified against the store:
  // DOCUMENT > CANVAS > FRAME, RECTANGLE). So draw it small and inside, then
  // grow its height, which keeps it a child and creates the overflow.
  await drawShape(page, 'Rectangle', 200, 60, 0, 0);
  await field(page, 'H').fill('600');
  await field(page, 'H').press('Enter');
  await page.waitForTimeout(300);
  const types = await page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const frameNode = (() => {
      let found: { children?: unknown[] } | null = null;
      const walk = (n: { name?: string; children?: unknown[] }): void => {
        if (n.name === 'Frame 1') found = n;
        for (const c of (n.children ?? []) as Array<{ name?: string; children?: unknown[] }>) walk(c);
      };
      walk(store.getState().file.document);
      return found as { children?: unknown[] } | null;
    })();
    return (frameNode?.children ?? []).map((c) => (c as { type: string }).type);
  });
  expect(types, 'the rectangle is not a child of the frame').toContain('RECTANGLE');

  await page.locator('.layer-row', { hasText: frame }).first().click();
  await openPrototype(page);

  const scrolling = page.locator('select[aria-label="Frame scrolling"]');
  await expect(scrolling).toHaveCount(1);
  await expect(scrolling.locator('option', { hasText: 'Vertical' })).toHaveCount(1);
  await scrolling.selectOption({ label: 'Vertical' });
  await page.waitForTimeout(400);

  await page.locator('select[aria-label="Prototype start frame"]').selectOption({ label: frame });
  await page.waitForTimeout(300);
  await tool(page, 'Present').click();
  await page.waitForTimeout(700);

  const stage = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.present__stage, .present__frame, .present__scroller')];
    return nodes.map((n) => ({
      cls: typeof n.className === 'string' ? n.className : '',
      scrollH: n.scrollHeight,
      clientH: n.clientHeight,
      overflowY: getComputedStyle(n).overflowY,
    }));
  });

  const scrollable = stage.find((s) => s.overflowY !== 'visible' && s.scrollH > s.clientH + 1);
  expect(
    scrollable,
    `no scrollable surface in presentation; measured ${JSON.stringify(stage)}`,
  ).toBeTruthy();

  // Scrolling actually moves the content.
  const before = scrollable!.scrollH - scrollable!.clientH;
  expect(before).toBeGreaterThan(0);
});

test('B33b smart animate interpolates rather than jumping', async ({ page }) => {
  await boot(page, { blank: true });
  // The layers panel drives selection and renaming here, so make sure it is the
  // active rail tab before reading any row.
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.waitForTimeout(300);

  // Two frames with a child at different Y positions.
  await drawShape(page, 'Frame', 300, 240, -240, 0);
  const source = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  await drawShape(page, 'Rectangle', 120, 80, -240, -60);
  // Both frames' rectangles must share a NAME: smart animate pairs layers by
  // exact name (as Figma does), and auto-names give Rectangle 1 / Rectangle 2.
  const mover = 'Mover';
  await renameSelected(page, mover);

  await drawShape(page, 'Frame', 300, 240, 240, 0);
  const target = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  await drawShape(page, 'Rectangle', 120, 80, 240, 70);
  await renameSelected(page, mover);

  // Link the mover in the source frame to the target frame, with smart animate.
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.waitForTimeout(300);
  // Select the mover INSIDE THE SOURCE FRAME. The tree is top-most first, so
  // with rows ["Frame 2","Mover","Frame 1","Mover"] a plain .first() picks the
  // DESTINATION's rectangle. Take the Mover row that follows the source frame.
  const sourceIndex = await page.evaluate((frameName) => {
    const rows = [...document.querySelectorAll('.layer-row')];
    return rows.findIndex((r) => r.querySelector('.layer-row__name')?.textContent === frameName);
  }, source);
  expect(sourceIndex, `source frame row not found: ${source}`).toBeGreaterThanOrEqual(0);
  const moverRow = page.locator('.layer-row').nth(sourceIndex + 1);
  await expect(moverRow.locator('.layer-row__name')).toHaveText(mover);
  await moverRow.click();
  await page.waitForTimeout(300);
  await openPrototype(page);
  await page.locator('select[aria-label="Prototype start frame"]').selectOption({ label: source });
  await page.waitForTimeout(300);

  const destination = page.locator('select[aria-label="Navigate to"]');
  await expect(destination.locator('option', { hasText: target })).toHaveCount(1, { timeout: 15000 });
  await destination.selectOption({ label: target });

  const smart = page.locator('[aria-label^="Smart animate "]').first();
  await expect(smart, 'no Smart animate control on the interaction').toHaveCount(1);
  await smart.check();
  await page.waitForTimeout(300);
  const duration = page.locator('[aria-label^="Smart animate duration "]').first();
  if (await duration.count()) {
    await duration.fill('900');
    await duration.press('Enter');
    await page.waitForTimeout(200);
  }

  const apply = page.locator('.button', { hasText: 'Apply link' });
  if (await apply.count()) {
    await apply.click();
  } else {
    // The panel may already be in the per-interaction editor; the destination
    // select is the same control in both forms.
    await expect(page.locator('select[aria-label="Navigate to"]')).toHaveCount(1);
  }
  await page.waitForTimeout(400);

  await tool(page, 'Present').click();
  await page.waitForTimeout(600);
  const hotspot = page.locator('.present__hotspot').first();
  await expect(hotspot).toHaveCount(1);

  // Sample the moving element's rendered y during the transition.
  // Read the animated position from COMPUTED STYLE, with no attribute filter.
  //
  // An animating layer carries a CSS transform (`style="transform: matrix(...)"`)
  // and its SVG `transform` ATTRIBUTE is null, so a `g[transform]` selector drops
  // exactly the moving node - which is why earlier readings showed no motion.
  const readY = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.present__frame svg g')]
        .map((g) => {
          const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(g).transform);
          if (!m) return null;
          const raw = m[1];
          if (raw === undefined) return null;
          const parts = raw.split(',').map(Number);
          return parts.length === 6 ? (parts[5] ?? null) : null;
        })
        .filter((v): v is number => v !== null),
    );

  const startYs = await readY();
  await hotspot.click();
  const samples: number[][] = [];
  for (let i = 0; i < 40; i++) {
    samples.push(await readY());
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(1200);
  const endYs = await readY();

  // Any intermediate sample that is neither the start nor the end proves
  // interpolation rather than an instant jump.
  const intermediate = samples.flat().filter((y) => {
    const startsAt = startYs.some((s) => Math.abs(s - y) < 0.5);
    const endsAt = endYs.some((e) => Math.abs(e - y) < 0.5);
    return !startsAt && !endsAt;
  });
  expect(
    intermediate.length,
    `no interpolated frame observed; start=${JSON.stringify(startYs)} end=${JSON.stringify(endYs)} samples=${JSON.stringify(samples.slice(0, 6))}`,
  ).toBeGreaterThan(0);
});
