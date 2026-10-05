#!/usr/bin/env node
/**
 * UI evidence: INTERNAL contracts and EXTERNAL references, counted separately.
 *
 * INTERNAL checks are contracts on values that belong to THIS repository. They
 * catch drift ("the shell still has the geometry we chose"), and they are NOT
 * evidence about Figma. An internal check that compares Pigma@DPR2 against
 * Pigma@DPR1 is a SCALE-INDEPENDENCE check; it is labelled that, and it is not a
 * parity row.
 *
 * EXTERNAL checks compare against a value taken from OUTSIDE this repository, and
 * every one of them must carry a full provenance record (see REQUIRED_PROVENANCE).
 * A reference missing any field FAILS instead of being used silently.
 *
 * The two are printed and counted separately, and the verdict names what is still
 * unsupported: internal rows passing says nothing about Figma, and a structural
 * reference is not a pixel measurement.
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
 * Exits 0 only when every INTERNAL row passes AND at least one EXTERNAL reference
 * is measured and passes AND at least one of those references is a PIXEL
 * reference. Anything else exits 1 and prints which condition failed.
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? process.env.PIGMA_URL ?? 'http://127.0.0.1:5173';

/**
 * INTERNAL contracts — this repository's own design values.
 *
 * They are UNCITED: nobody has produced a Figma source that states these numbers,
 * so they cannot be used as evidence about Figma. They live here as a drift
 * contract. If a citation is ever added, the value moves into `EXTERNAL` with a
 * full provenance record rather than staying in this table.
 */
const INTERNAL_VALUES = {
  railWidth: 56,
  panelWidth: 240,
  canvasBg: [229, 229, 229], // #e5e5e5
  toolbarBg: [255, 255, 255], // white
  toolbarRadius: 14,
  controlHeight: 24,
};
const TOL = { px: 1, rgb: 4 };

/**
 * The provenance record an external reference must carry. Every field is required
 * and must be a non-empty string; a dimension the fact genuinely does not depend
 * on must say so explicitly ("n/a — …") rather than being omitted, so a reviewer
 * can see the judgement.
 */
const REQUIRED_PROVENANCE = [
  'sourceUrl',
  'capturedAt',
  'accessRole',
  'nodeType',
  'theme',
  'viewport',
  'browserZoom',
  'dpr',
];

/**
 * EXTERNAL references — values taken from outside this repository.
 *
 * `kind` says what the reference can support:
 *   'structure' — a documented fact about the UI's structure (a count, what a
 *                 surface contains). Needs no pixel interpretation.
 *   'pixels'    — a documented geometry or colour value measured against the
 *                 render. Only this kind supports a visual-parity claim.
 *
 * `measure` reads the value out of a `measure()` result; `documented` is the
 * reference's value.
 */
const EXTERNAL = [
  {
    property: 'properties panel tab count (edit access)',
    kind: 'structure',
    documented: 2,
    tolerance: 0,
    measure: (m) => m.rightPanelTabCount,
    sourceUrl:
      'https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar',
    capturedAt: '2026-10-05',
    accessRole: 'edit (the article documents the edit-access surface separately from view-only)',
    nodeType: 'none required — the article states the tab set for edit access; the measurement is taken with one rectangle selected, which does not change the tab set on either side',
    theme: 'n/a — a tab count is not a rendering',
    viewport: 'n/a — a tab count is not a rendering',
    browserZoom: 'n/a — a tab count is not a rendering',
    dpr: 'n/a — a tab count is not a rendering',
    quote:
      'There are two tabs available in the properties panel when you have edit access to a file: Design and Prototype.',
  },
];

/** Which required provenance fields this reference is missing. */
const missingProvenance = (reference) =>
  REQUIRED_PROVENANCE.filter((field) => typeof reference[field] !== 'string' || reference[field].trim() === '');

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
      // Structural facts an external reference can be measured against.
      rightPanelTabCount: document.querySelectorAll('[data-testid="right-tabs"] button.tab').length,
    };
  }, dataUrl);

  await browser.close();
  return result;
}

const rgbDist = (a, b) => (a && b ? Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])) : null);

const at1x = await measure(1);
const at2x = await measure(2);

/** An INTERNAL row: Pigma against Pigma's own value, or against itself at 2x. */
const row = (scope, name, measured, expected, tol, unit, via, note = '') => {
  const delta = typeof measured === 'number' ? Number(Math.abs(measured - expected).toFixed(2)) : rgbDist(measured, expected);
  return {
    scope,
    property: name,
    measured: typeof measured === 'number' ? Number(measured.toFixed(2)) : measured,
    expected,
    delta,
    tolerance: tol,
    unit,
    via,
    note,
    pass: delta <= tol,
  };
};

const internalRows = [];
const internalCmp = (name, measured, expected, tol, unit, via) =>
  internalRows.push(row('INTERNAL', name, measured, expected, tol, unit, via));

internalCmp('nav rail width', at1x.railWidth, INTERNAL_VALUES.railWidth, TOL.px, 'px', 'DOM rect @1x');
internalCmp('left panel width', at1x.panelLeftWidth, INTERNAL_VALUES.panelWidth, TOL.px, 'px', 'DOM rect @1x');
internalCmp('right panel width', at1x.panelRightWidth, INTERNAL_VALUES.panelWidth, TOL.px, 'px', 'DOM rect @1x');
internalCmp('control height', at1x.controlHeight, INTERNAL_VALUES.controlHeight, TOL.px, 'px', 'DOM rect @1x');
internalCmp('toolbar radius', at1x.toolbarRadiusCss, INTERNAL_VALUES.toolbarRadius, TOL.px, 'px', 'computed style @1x');
internalCmp('canvas background', at1x.canvasBgPixels, INTERNAL_VALUES.canvasBg, TOL.rgb, 'rgb', 'screenshot pixels @1x');
internalCmp('toolbar background', at1x.toolbarBgPixels, INTERNAL_VALUES.toolbarBg, TOL.rgb, 'rgb', 'screenshot pixels @1x');

// Scale independence: Pigma@DPR2 vs Pigma@DPR1. INTERNAL by definition — both
// sides are this app — and labelled so it can never be read as a parity row.
for (const [name, key] of [
  ['nav rail width', 'railWidth'],
  ['left panel width', 'panelLeftWidth'],
  ['right panel width', 'panelRightWidth'],
  ['control height', 'controlHeight'],
]) {
  internalRows.push(
    row('INTERNAL', `${name} @2x device scale`, at2x[key], at1x[key], 0.5, 'px', 'DOM rect @2x vs @1x', 'scale independence, not parity'),
  );
}

const externalRows = [];
const invalidReferences = [];
for (const reference of EXTERNAL) {
  const missing = missingProvenance(reference);
  if (missing.length > 0) {
    // Not used, not silently accepted: a reference without provenance is not evidence.
    invalidReferences.push({ property: reference.property, missing });
    externalRows.push({
      scope: 'EXTERNAL',
      property: reference.property,
      measured: null,
      expected: reference.documented,
      delta: null,
      tolerance: reference.tolerance,
      unit: '',
      via: 'refused: incomplete provenance',
      note: `missing ${missing.join(', ')}`,
      pass: false,
    });
    continue;
  }
  externalRows.push(
    row(
      `EXTERNAL:${reference.kind}`,
      reference.property,
      reference.measure(at1x),
      reference.documented,
      reference.tolerance,
      '',
      `cited: ${reference.sourceUrl} (captured ${reference.capturedAt})`,
      `access=${reference.accessRole}; node=${reference.nodeType}; theme=${reference.theme}; viewport=${reference.viewport}; zoom=${reference.browserZoom}; dpr=${reference.dpr}`,
    ),
  );
}

const print = (r) => {
  console.log(
    `${r.pass ? 'PASS' : 'FAIL'}  [${r.scope}] ${r.property.padEnd(34)} measured=${JSON.stringify(r.measured).padEnd(20)} documented=${JSON.stringify(r.expected).padEnd(20)} delta=${r.delta} tol=${r.tolerance} ${r.unit}  [${r.via}]`,
  );
  if (r.note) console.log(`        ${r.note}`);
};

console.log('INTERNAL — contracts on Pigma\'s own values. A pass here is NOT evidence about Figma.');
for (const r of internalRows) print(r);

console.log('\nEXTERNAL — comparisons against a reference outside this repository.');
if (externalRows.length === 0) {
  console.log('  (none: no external reference with provenance exists)');
} else {
  for (const r of externalRows) print(r);
}

const internalPass = internalRows.every((r) => r.pass);
const externalPass = externalRows.length > 0 && externalRows.every((r) => r.pass);
const pixelReferences = EXTERNAL.filter((r) => r.kind === 'pixels' && missingProvenance(r).length === 0).length;
const structureReferences = EXTERNAL.filter((r) => r.kind === 'structure' && missingProvenance(r).length === 0).length;

console.log('');
console.log(`INTERNAL: ${internalRows.filter((r) => r.pass).length} passed / ${internalRows.length}`);
console.log(
  `EXTERNAL: ${externalRows.filter((r) => r.pass).length} passed / ${externalRows.length}` +
    `  (${structureReferences} structure, ${pixelReferences} pixel)` +
    (invalidReferences.length > 0 ? `  · ${invalidReferences.length} refused for missing provenance` : ''),
);
console.log(
  `VISUAL PARITY: ${pixelReferences > 0 ? 'measured — see the pixel references above' : 'UNSUPPORTED — no pixel reference with provenance exists; the internal rows say nothing about Figma'}`,
);

const reasons = [];
if (!internalPass) reasons.push('an internal contract row failed');
if (externalRows.length === 0) reasons.push('there are no external references at all');
if (!externalPass && externalRows.length > 0) reasons.push('an external reference row failed (or was refused)');
if (pixelReferences === 0) reasons.push('no pixel reference exists, so visual parity is unmeasured');
console.log(`\nVERDICT: ${reasons.length === 0 ? 'PASS' : 'FAIL'}${reasons.length ? ` — ${reasons.join('; ')}` : ''}`);
process.exit(reasons.length === 0 ? 0 : 1);
