import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Screenshot-vs-reference diff of the editor shell, with a STATED tolerance.
 *
 * This is a REGRESSION harness, not Figma parity: the reference is the app's own
 * committed baseline, so it catches unintended visual change (layout, colour,
 * spacing) between revisions. `scripts/parity-spec.mjs` is what compares against
 * Figma's documented numbers.
 *
 * Baseline is created on first run (with UPDATE_BASELINE=1) and compared after
 * that. Comparison happens IN THE PAGE: both PNGs are decoded to a canvas and
 * diffed pixel-by-pixel, so no image library is needed.
 */
const BASELINE = 'tests/browser/__baseline__/shell-1440x900.png';
const VIEWPORT = { width: 1440, height: 900 };
/** Channel delta at or above which a pixel counts as changed. */
const CHANNEL_TOLERANCE = 12;
/** Share of changed pixels allowed before the diff fails. */
const MAX_CHANGED_RATIO = 0.005;

async function capture(page: import('@playwright/test').Page): Promise<Buffer> {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/?blank=1', { waitUntil: 'networkidle' });
  await page.waitForSelector('.app');
  await page.waitForTimeout(700);
  return page.screenshot();
}

test('B39a the shell matches its committed baseline within tolerance', async ({ page }) => {
  const shot = await capture(page);
  const update = process.env.UPDATE_BASELINE === '1';

  if (update) {
    mkdirSync(dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, shot);
    test.info().annotations.push({ type: 'baseline', description: `created ${BASELINE}` });
    return;
  }

  // A missing baseline must FAIL. Recreating it on demand would let a deleted or
  // never-committed reference turn this spec into a no-op that always passes -
  // the harness would report green while comparing nothing.
  expect(
    existsSync(BASELINE),
    `baseline ${BASELINE} is missing - regenerate and commit it with UPDATE_BASELINE=1`,
  ).toBe(true);

  const baseline = readFileSync(BASELINE);
  const result = await page.evaluate(
    async ([a, b, tol]) => {
      const load = async (dataUrl: string): Promise<ImageData> => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height);
      };
      const x = await load(a);
      const y = await load(b);
      if (x.width !== y.width || x.height !== y.height) {
        return { sizeMismatch: true, a: [x.width, x.height], b: [y.width, y.height], changed: -1, total: 0, worst: 0 };
      }
      let changed = 0;
      let worst = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const d = Math.max(
          Math.abs(x.data[i]! - y.data[i]!),
          Math.abs(x.data[i + 1]! - y.data[i + 1]!),
          Math.abs(x.data[i + 2]! - y.data[i + 2]!),
        );
        if (d > worst) worst = d;
        if (d >= tol) changed++;
      }
      return { sizeMismatch: false, changed, total: x.width * x.height, worst };
    },
    [
      `data:image/png;base64,${baseline.toString('base64')}`,
      `data:image/png;base64,${shot.toString('base64')}`,
      CHANNEL_TOLERANCE,
    ] as [string, string, number],
  );

  expect(result.sizeMismatch, `baseline vs screenshot size differs: ${JSON.stringify(result)}`).toBe(false);
  const ratio = result.changed / result.total;
  expect(
    ratio,
    `${result.changed}/${result.total} px changed (${(ratio * 100).toFixed(3)}%), worst channel delta ${result.worst}, tolerance ${CHANNEL_TOLERANCE}`,
  ).toBeLessThan(MAX_CHANGED_RATIO);
});

test('B39b the diff harness actually detects a change', async ({ page }) => {
  // Guard against a harness that passes because it compares nothing: perturb the
  // app (a visible panel toggle) and require the diff to notice.
  const clean = await capture(page);
  await page.locator('.toolbar__button[aria-label="Frame"]').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 320, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const changed = await page.screenshot();

  const result = await page.evaluate(
    async ([a, b, tol]) => {
      const load = async (dataUrl: string): Promise<ImageData> => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height);
      };
      const x = await load(a);
      const y = await load(b);
      let changedPx = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const d = Math.max(
          Math.abs(x.data[i]! - y.data[i]!),
          Math.abs(x.data[i + 1]! - y.data[i + 1]!),
          Math.abs(x.data[i + 2]! - y.data[i + 2]!),
        );
        if (d >= tol) changedPx++;
      }
      return changedPx;
    },
    [
      `data:image/png;base64,${clean.toString('base64')}`,
      `data:image/png;base64,${changed.toString('base64')}`,
      CHANNEL_TOLERANCE,
    ] as [string, string, number],
  );

  expect(result, 'drawing a frame changed no pixels - the diff is blind').toBeGreaterThan(1000);
});
