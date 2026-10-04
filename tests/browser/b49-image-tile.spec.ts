import { test, expect, type Page } from '@playwright/test';
import { boot, tool } from './helpers';

/**
 * TILE image scale mode on the live canvas.
 *
 * The unit test (`src/render/imageTile.test.ts`) covers the pattern maths; this
 * covers the rendered result: that the emitted pattern is a real repeating paint
 * server sized to the bitmap, and that pixels one tile period apart are the SAME
 * while half a period apart are DIFFERENT (i.e. it actually tiles rather than
 * stretching once).
 */

/** A 16x16 bitmap: left half red, right half blue - a hard edge one half-tile wide. */
async function tileDataUrl(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, 8, 16);
    g.fillStyle = '#0000ff';
    g.fillRect(8, 0, 8, 16);
    return c.toDataURL('image/png');
  });
}

/** Give the selected node an image fill through the app's own API. */
async function applyImageFill(page: Page, dataUrl: string): Promise<void> {
  await page.evaluate((url) => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const state = store.getState() as unknown as {
      applyImageFill: (dataUrl: string, size?: { width: number; height: number }) => boolean;
    };
    const ok = state.applyImageFill(url, { width: 16, height: 16 });
    if (!ok) throw new Error('applyImageFill refused');
  }, dataUrl);
  await page.waitForTimeout(400);
}

async function draw(page: Page): Promise<void> {
  await boot(page, { blank: true });
  await tool(page, 'Rectangle').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 110, cy - 70);
  await page.mouse.down();
  await page.mouse.move(cx + 110, cy + 70, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/** The TILE pattern's attributes, plus the canvas scale. */
async function patternInfo(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.canvas__svg');
    if (!svg) throw new Error('no canvas');
    const patterns = [...svg.querySelectorAll('pattern')].map((p) => ({
      units: p.getAttribute('patternUnits'),
      width: Number(p.getAttribute('width')),
      height: Number(p.getAttribute('height')),
      imageWidth: Number(p.querySelector('image')?.getAttribute('width') ?? '0'),
    }));
    const ctm = (svg as SVGSVGElement).getScreenCTM();
    return { patterns, zoom: ctm ? ctm.a : 1 };
  });
}

/** Decode a screenshot in the page and sample the mean colour of a small patch. */
async function samplePatch(page: Page, shot: Buffer, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(
    async ([url, px, py]) => {
      const img = new Image();
      img.src = url as string;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const data = g.getImageData(Math.round(px as number) - 1, Math.round(py as number) - 1, 3, 3).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]!;
        gg += data[i + 1]!;
        b += data[i + 2]!;
      }
      const n = data.length / 4;
      return [Math.round(r / n), Math.round(gg / n), Math.round(b / n)] as [number, number, number];
    },
    [`data:image/png;base64,${shot.toString('base64')}`, x, y] as [string, number, number],
  );
}

test('B49a TILE emits a userSpaceOnUse pattern sized to the bitmap', async ({ page }) => {
  await draw(page);
  await applyImageFill(page, await tileDataUrl(page));

  const select = page.locator('[aria-label="Image scale mode"]');
  await expect(select, 'the image scale-mode control is missing').toBeVisible();

  await select.selectOption('TILE');
  await page.waitForTimeout(400);

  const info = await patternInfo(page);
  const tile = info.patterns.find((p) => p.units === 'userSpaceOnUse');
  expect(tile, `no userSpaceOnUse pattern was emitted: ${JSON.stringify(info.patterns)}`).toBeDefined();

  // The tile period is the bitmap's natural size (16) times scalingFactor (1).
  // With objectBoundingBox the tile would be a fraction of the box and the image
  // would be stretched over it once instead of repeating.
  expect(tile!.width, 'the tile is not the bitmap width').toBe(16);
  expect(tile!.height, 'the tile is not the bitmap height').toBe(16);
  expect(tile!.imageWidth, 'the pattern image is not drawn at the tile size').toBe(16);

  // The tile must be far smaller than the node, or "repetition" is meaningless.
  expect(tile!.width, 'the tile is as wide as the shape - nothing repeats').toBeLessThan(200);
});

test('B49b TILE actually repeats on the canvas: one period matches, half differs', async ({ page }) => {
  await draw(page);
  await applyImageFill(page, await tileDataUrl(page));
  await page.locator('[aria-label="Image scale mode"]').selectOption('TILE');
  await page.waitForTimeout(400);

  const info = await patternInfo(page);
  const tile = info.patterns.find((p) => p.units === 'userSpaceOnUse')!;
  const period = tile.width * info.zoom; // tile period in screen pixels

  const canvas = (await page.locator('.canvas').boundingBox())!;
  const shot = await page.screenshot();
  const y = canvas.y + canvas.height / 2;

  // `patternUnits="userSpaceOnUse"` anchors the tile to the SVG origin, not to
  // the node, so which half of the bitmap lands at a given x is not knowable up
  // front. Find a strongly saturated patch instead of assuming a phase - the
  // bitmap's halves are pure red and pure blue, so a saturated patch means the
  // sample sits inside one half rather than on the seam.
  const nodeLeft = canvas.x + canvas.width / 2 - 100;
  let startX: number | null = null;
  for (let x = nodeLeft + 12; x < nodeLeft + 80; x += 2) {
    const sample = await samplePatch(page, shot, x, y);
    if (Math.abs(sample[0] - sample[2]) > 180) {
      startX = x;
      break;
    }
  }
  expect(startX, 'no saturated sample found - the image fill did not render the bitmap').not.toBeNull();

  const here = await samplePatch(page, shot, startX!, y);
  const oneAway = await samplePatch(page, shot, startX! + period, y);
  const twoAway = await samplePatch(page, shot, startX! + period * 2, y);
  const halfAway = await samplePatch(page, shot, startX! + period / 2, y);

  // ONE FULL TILE AWAY is the same colour: that is the repetition. Checked at
  // one and two periods so a single coincidence cannot pass this.
  for (let i = 0; i < 3; i++) {
    expect(
      Math.abs(oneAway[i]! - here[i]!),
      `a pixel one tile period away differs (${JSON.stringify(here)} vs ${JSON.stringify(oneAway)}) - the image is not tiling`,
    ).toBeLessThan(12);
    expect(
      Math.abs(twoAway[i]! - here[i]!),
      `a pixel two tile periods away differs (${JSON.stringify(here)} vs ${JSON.stringify(twoAway)}) - the image is not tiling`,
    ).toBeLessThan(12);
  }

  // HALF A TILE AWAY lands in the other half of the bitmap: proof this is a
  // repeat and not one copy stretched across the shape.
  expect(
    Math.abs(halfAway[0]! - here[0]!) > 40 || Math.abs(halfAway[2]! - here[2]!) > 40,
    `half a tile away is the same colour (${JSON.stringify(here)} vs ${JSON.stringify(halfAway)}) - the bitmap is stretched, not tiled`,
  ).toBe(true);
});

test('B49c TILE renders differently from FILL for the same image', async ({ page }) => {
  await draw(page);
  await applyImageFill(page, await tileDataUrl(page));

  const select = page.locator('[aria-label="Image scale mode"]');
  await select.selectOption('FILL');
  await page.waitForTimeout(400);
  const fillShot = await page.screenshot();
  const fillPatterns = (await patternInfo(page)).patterns;

  await select.selectOption('TILE');
  await page.waitForTimeout(400);
  const tileShot = await page.screenshot();
  const tilePatterns = (await patternInfo(page)).patterns;

  // FILL covers the box with one stretched copy (the pattern is the node box),
  // TILE repeats the bitmap - so the two must not render the same.
  expect(Buffer.compare(fillShot, tileShot), 'TILE renders identically to FILL').not.toBe(0);
  expect(fillPatterns.some((p) => p.units === 'userSpaceOnUse' && p.width === 16), 'FILL is already tiled').toBe(false);
  expect(tilePatterns.some((p) => p.width === 16), 'TILE did not emit the tile pattern').toBe(true);
});
