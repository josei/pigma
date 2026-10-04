import { test, expect } from '@playwright/test';
import { boot } from './helpers';

test('B9a the shell lays out rail | left panel | canvas | right panel', async ({ page }) => {
  await boot(page);
  const boxes = await page.evaluate(() => {
    const rect = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`missing ${sel}`);
      const b = el.getBoundingClientRect();
      return { x: b.x, width: b.width, right: b.right };
    };
    return {
      rail: rect('.app__rail'),
      left: rect('.app__left'),
      canvas: rect('.app__canvas'),
      right: rect('.app__right'),
    };
  });

  expect(boxes.rail.right).toBeLessThanOrEqual(boxes.left.x + 1);
  expect(boxes.left.right).toBeLessThanOrEqual(boxes.canvas.x + 1);
  expect(boxes.canvas.right).toBeLessThanOrEqual(boxes.right.x + 1);
  expect(boxes.canvas.width).toBeGreaterThan(boxes.left.width);
  expect(boxes.canvas.width).toBeGreaterThan(boxes.right.width);
});

test('B9b the rail is 56px wide and the side panels are 240px', async ({ page }) => {
  await boot(page);
  const widths = await page.evaluate(() => ({
    rail: document.querySelector('.app__rail')!.getBoundingClientRect().width,
    left: document.querySelector('.app__left')!.getBoundingClientRect().width,
    right: document.querySelector('.app__right')!.getBoundingClientRect().width,
  }));
  expect(widths.rail).toBeCloseTo(56, 0);
  expect(widths.left).toBeCloseTo(240, 0);
  expect(widths.right).toBeCloseTo(240, 0);
});

test('B9c the toolbar is white, floating at the bottom, 14px radius', async ({ page }) => {
  await boot(page);
  const info = await page.locator('.toolbar').evaluate((el) => {
    const c = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    const canvas = document.querySelector('.canvas')!.getBoundingClientRect();
    return {
      bg: c.backgroundColor,
      radius: c.borderTopLeftRadius,
      bottomGap: window.innerHeight - b.bottom,
      centerX: b.x + b.width / 2,
      canvasCenterX: canvas.x + canvas.width / 2,
    };
  });

  expect(info.bg).toBe('rgb(255, 255, 255)');
  expect(info.radius).toBe('14px');
  expect(info.bottomGap).toBeGreaterThanOrEqual(0);
  expect(info.bottomGap).toBeLessThan(48);
  // Centred over the canvas region (window-centred gives a small offset).
  expect(Math.abs(info.centerX - info.canvasCenterX)).toBeLessThan(48);
});

test('B9d the active tool is marked by a blue square', async ({ page }) => {
  await boot(page);
  const active = page.locator('.toolbar__button--active');
  await expect(active).toHaveCount(1);

  const style = await active.evaluate((el) => {
    const c = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return { bg: c.backgroundColor, color: c.color, w: b.width, h: b.height };
  });

  expect(style.bg).toBe('rgb(13, 153, 255)');
  expect(style.color).toBe('rgb(255, 255, 255)');
  expect(Math.abs(style.w - style.h)).toBeLessThan(1);
});

test('B9e the canvas sits on the Figma canvas background', async ({ page }) => {
  await boot(page);
  const bg = await page.locator('.canvas').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(229, 229, 229)');
});
