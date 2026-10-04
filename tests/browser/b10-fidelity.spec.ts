import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field } from './helpers';

/** Every field in the right panel must be a 24px control inside the panel. */
async function fieldProblems(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.app__right')!.getBoundingClientRect();
    const problems: string[] = [];
    for (const el of document.querySelectorAll<HTMLInputElement>('.app__right input')) {
      if (el.type === 'color') continue;
      const host = el.closest('.input') ?? el;
      const r = host.getBoundingClientRect();
      const label = el.getAttribute('aria-label');
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (Math.abs(r.height - 16) > 1) problems.push(`toggle ${label} is ${r.height.toFixed(1)}px tall`);
        continue;
      }
      if (Math.abs(r.height - 24) > 1) problems.push(`field ${label} is ${r.height.toFixed(1)}px tall`);
      if (r.right > panel.right + 0.5) problems.push(`field ${label} overflows the panel by ${(r.right - panel.right).toFixed(1)}px`);
      if (r.left < panel.left - 0.5) problems.push(`field ${label} starts left of the panel`);
      if (getComputedStyle(el).borderStyle === 'inset') problems.push(`field ${label} still has a native border`);
    }
    return problems;
  });
}

test('B10a selected-object fields are 24px controls inside the panel', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  await expect(field(page, 'W')).toBeVisible();
  expect(await fieldProblems(page)).toEqual([]);
});

test('B10b no two controls in a property row or grid overlap', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);

  const overlaps = await page.evaluate(() => {
    const hits: string[] = [];
    const intersects = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    for (const group of document.querySelectorAll('.prop-row, .prop-grid')) {
      const kids = [...group.children].map((k) => ({ el: k as HTMLElement, r: k.getBoundingClientRect() }));
      for (let i = 0; i < kids.length; i++) {
        const a = kids[i];
        if (!a) continue;
        for (let j = i + 1; j < kids.length; j++) {
          const b = kids[j];
          if (!b || !intersects(a.r, b.r)) continue;
          hits.push(
            `${group.className}: ${a.el.className || a.el.tagName} overlaps ${b.el.className || b.el.tagName}`,
          );
        }
      }
    }
    return hits;
  });

  expect(overlaps).toEqual([]);
});

test('B10c neither side panel scrolls horizontally', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);

  const overflowing = await page.evaluate(() => {
    const hits: string[] = [];
    for (const sel of ['.app__left .panel__scroll', '.app__right .panel__scroll']) {
      const el = document.querySelector(sel)!;
      if (el.scrollWidth > el.clientWidth + 1) hits.push(`${sel} overflows ${el.scrollWidth} > ${el.clientWidth}`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) hits.push('document overflows horizontally');
    return hits;
  });

  expect(overflowing).toEqual([]);
});

test('B10d the file name sits above the project summary', async ({ page }) => {
  await boot(page);
  const stacked = await page.evaluate(() => {
    const title = document.querySelector('.panel-header__title')!.getBoundingClientRect();
    const subtitle = document.querySelector('.panel-header__subtitle')!.getBoundingClientRect();
    return { below: subtitle.top >= title.bottom - 0.5, titleFull: title.width };
  });
  expect(stacked.below).toBe(true);
});

test('B10e the Layers tree has exactly one header and follows Pages', async ({ page }) => {
  await boot(page);
  const info = await page.evaluate(() => {
    const layers = document.querySelector('.layers')!;
    const header = layers.previousElementSibling;
    const pages = document.querySelector('.section')!;
    return {
      headerIsSectionHeader: header ? header.classList.contains('section__header') : false,
      headerText: (header?.textContent ?? '').trim(),
      belowPages: layers.getBoundingClientRect().top >= pages.getBoundingClientRect().bottom - 1,
      layersHeadings: [...document.querySelectorAll('.app__left .section__header')]
        .map((h) => (h.textContent ?? '').trim())
        .filter((text) => text.startsWith('Layers')),
    };
  });

  expect(info.headerIsSectionHeader).toBe(true);
  expect(info.headerText).toContain('Layers');
  expect(info.belowPages).toBe(true);
  // A CSS fallback heading alongside real markup renders "Layers" twice.
  expect(info.layersHeadings).toHaveLength(1);
});

test('B10f typing into a numeric field with the keyboard resizes the shape', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  const w = field(page, 'W');
  await expect(w).toBeVisible();

  // A real interaction: click the field, select the value, type a new one.
  await w.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('300');
  await page.keyboard.press('Enter');

  expect(Number(await w.inputValue())).toBeCloseTo(300, 0);
  const overlayWidth = Number(await page.locator('.canvas__overlay rect').first().getAttribute('width'));
  expect(overlayWidth).toBeCloseTo(300, 0);
});
