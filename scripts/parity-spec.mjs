#!/usr/bin/env node
/**
 * Parity diff against Figma's DOCUMENTED UI values — reproducible.
 *
 * The marketing/help screenshots are cropped and scaled, so they are not a valid
 * measurement basis. This compares the running app against the documented Figma
 * UI3 numbers instead, with stated tolerances.
 *
 * Protocol, so the numbers mean something:
 *   - Chromium at a KNOWN scale: viewport 1440x900, deviceScaleFactor 1, so CSS
 *     px map 1:1 onto device px
 *   - geometry is read from DOM rects; colours are read from the SCREENSHOT
 *     PIXELS (not computed style), so the diff is against what was rendered
 *   - a 2x pass re-measures the same CSS geometry to prove the values are
 *     scale-independent
 *
 * Usage:
 *   npm run dev -- --port 5173 --strictPort --host 127.0.0.1   # in another shell
 *   node scripts/parity-spec.mjs [baseUrl]
 *
 * Exits non-zero when any row exceeds its tolerance.
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? process.env.PIGMA_URL ?? 'http://127.0.0.1:5173';

const DOCUMENTED = {
  railWidth: 56,
  panelWidth: 240,
  canvasBg: [229, 229, 229], // #e5e5e5
  toolbarBg: [255, 255, 255], // white
  toolbarRadius: 14,
  controlHeight: 24,
};
const TOL = { px: 1, rgb: 4 };

async function measure(scale) {
  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale })
  ).newPage();
  await page.goto(`${BASE}/?blank=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.app');

  // A selection is required for the property fields (and the 24px control) to exist.
  const box = await page.locator('.canvas').boundingBox();
  await page.locator('.toolbar__button[aria-label="Rectangle"]').click();
  await page.mouse.move(box.x + box.width / 2 - 90, box.y + box.height / 2 - 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const shot = await page.screenshot();
  const dataUrl = `data:image/png;base64,${shot.toString('base64')}`;

  const result = await page.evaluate(async (url) => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const dpr = c.width / window.innerWidth;
    const mean = (x0, y0, x1, y1) => {
      let r = 0, gg = 0, b = 0, n = 0;
      for (let y = Math.round(y0 * dpr); y < Math.round(y1 * dpr); y++)
        for (let x = Math.round(x0 * dpr); x < Math.round(x1 * dpr); x++) {
          const i = (y * c.width + x) * 4;
          r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
        }
      return n ? [Math.round(r / n), Math.round(gg / n), Math.round(b / n)] : null;
    };
    const rail = rect('.app__rail');
    const toolbar = rect('.toolbar');
    const canvas = rect('.canvas');
    const fieldEl = document.querySelector('input[aria-label="W"]');
    const field = fieldEl ? fieldEl.closest('.input').getBoundingClientRect() : null;
    return {
      dpr,
      screenshot: { w: c.width, h: c.height },
      railWidth: rail.w,
      panelLeftWidth: rect('.app__left').w,
      panelRightWidth: rect('.app__right').w,
      controlHeight: field ? field.height : null,
      toolbarRadiusCss: parseFloat(getComputedStyle(document.querySelector('.toolbar')).borderTopLeftRadius),
      canvasBgPixels: mean(canvas.x + 30, canvas.y + 30, canvas.x + 90, canvas.y + 90),
      // The pill's BOTTOM strip: the buttons are 32px inside a 42px pill, so the
      // top strip clips the blue active-tool square and reads blue.
      toolbarBgPixels: mean(toolbar.x + 40, toolbar.y + toolbar.h - 4, toolbar.x + toolbar.w - 40, toolbar.y + toolbar.h - 2),
    };
  }, dataUrl);

  await browser.close();
  return result;
}

const rgbDist = (a, b) => (a && b ? Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])) : null);

const at1x = await measure(1);
const at2x = await measure(2);

const rows = [];
const cmp = (name, measured, documented, tol, unit, via) =>
  rows.push({
    property: name,
    measured: typeof measured === 'number' ? Number(measured.toFixed(2)) : measured,
    documented,
    delta: typeof measured === 'number' ? Number(Math.abs(measured - documented).toFixed(2)) : rgbDist(measured, documented),
    tolerance: tol,
    unit,
    via,
    pass: typeof measured === 'number' ? Math.abs(measured - documented) <= tol : rgbDist(measured, documented) <= tol,
  });

cmp('nav rail width', at1x.railWidth, DOCUMENTED.railWidth, TOL.px, 'px', 'DOM rect @1x');
cmp('left panel width', at1x.panelLeftWidth, DOCUMENTED.panelWidth, TOL.px, 'px', 'DOM rect @1x');
cmp('right panel width', at1x.panelRightWidth, DOCUMENTED.panelWidth, TOL.px, 'px', 'DOM rect @1x');
cmp('control height', at1x.controlHeight, DOCUMENTED.controlHeight, TOL.px, 'px', 'DOM rect @1x');
cmp('toolbar radius', at1x.toolbarRadiusCss, DOCUMENTED.toolbarRadius, TOL.px, 'px', 'computed style @1x');
cmp('canvas background', at1x.canvasBgPixels, DOCUMENTED.canvasBg, TOL.rgb, 'rgb', 'screenshot pixels @1x');
cmp('toolbar background', at1x.toolbarBgPixels, DOCUMENTED.toolbarBg, TOL.rgb, 'rgb', 'screenshot pixels @1x');

const scaleRows = [
  ['nav rail width', 'railWidth'],
  ['left panel width', 'panelLeftWidth'],
  ['right panel width', 'panelRightWidth'],
  ['control height', 'controlHeight'],
].map(([name, key]) => ({
  property: `${name} @2x device scale`,
  measured: Number(at2x[key].toFixed(2)),
  documented: Number(at1x[key].toFixed(2)),
  delta: Number(Math.abs(at2x[key] - at1x[key]).toFixed(2)),
  tolerance: 0.5,
  unit: 'px',
  via: 'DOM rect @2x vs @1x',
  pass: Math.abs(at2x[key] - at1x[key]) <= 0.5,
}));

for (const r of [...rows, ...scaleRows]) {
  console.log(
    `${r.pass ? 'PASS' : 'FAIL'}  ${r.property.padEnd(28)} measured=${JSON.stringify(r.measured).padEnd(20)} documented=${JSON.stringify(r.documented).padEnd(20)} delta=${r.delta} tol=${r.tolerance} ${r.unit}  [${r.via}]`,
  );
}
const allPass = [...rows, ...scaleRows].every((r) => r.pass);
console.log(`\nALL PASS: ${allPass}  (${rows.length + scaleRows.length} rows, viewport 1440x900, deviceScaleFactor 1 and 2)`);
process.exit(allPass ? 0 : 1);
