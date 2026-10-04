import { expect, type Page } from '@playwright/test';

/** Load the app and assert the contracted shell is present. */
export async function boot(page: Page, options: { blank?: boolean } = {}): Promise<void> {
  // ?blank=1 boots an empty document: no starter frames to parent into and no
  // auto-expanded tree, so counts and coordinates are deterministic.
  await page.goto(options.blank ? '/?blank=1' : '/');
  await page.waitForSelector('.app');
  await expect(page.locator('.app__rail')).toBeVisible();
  await expect(page.locator('.app__left')).toBeVisible();
  await expect(page.locator('.canvas')).toBeVisible();
  await expect(page.locator('.app__right')).toBeVisible();
  await expect(page.locator('.toolbar')).toBeVisible();
}

/**
 * Tool buttons are addressed by accessible name across every spec, so the
 * selector lives here rather than being re-spelled in each test.
 */
export function tool(page: Page, label: string) {
  return page.locator(`.toolbar__button[aria-label="${label}"]`);
}

/**
 * Numeric/composite property fields are addressed by their aria-label, which is
 * a contract shared by all property specs.
 */
export function field(page: Page, aria: string) {
  return page.locator(`input[aria-label="${aria}"]`);
}

export async function canvasBox(page: Page) {
  const box = await page.locator('.canvas').boundingBox();
  if (!box) throw new Error('.canvas has no bounding box');
  return box;
}

/**
 * Exact document->screen scale from the canvas SVG's screen CTM. The toolbar
 * readout is rounded to whole percent, which is not precise enough to predict
 * pointer deltas.
 */
export async function zoom(page: Page): Promise<number> {
  const scale = await page.evaluate(() => {
    const svg = document.querySelector('.canvas__svg') as SVGGraphicsElement | null;
    const m = svg ? svg.getScreenCTM() : null;
    return m ? m.a : null;
  });
  if (scale && Number.isFinite(scale)) return scale;
  const label = page.locator('[aria-label="Current zoom"]');
  const text = (await label.count()) ? ((await label.textContent()) ?? '100%') : '100%';
  const pct = Number(text.replace('%', '').trim());
  return Number.isFinite(pct) && pct > 0 ? pct / 100 : 1;
}

/** Convert a drag measured in screen pixels into document units. */
export async function toDoc(page: Page, screenPx: number): Promise<number> {
  return screenPx / (await zoom(page));
}

/**
 * Screen coordinates of a document point, so pointer input can target a node
 * exactly at any pan/zoom instead of guessing from the canvas centre.
 */
export async function docToScreen(page: Page, x: number, y: number) {
  return page.evaluate(
    (point: { x: number; y: number }) => {
      const svg = document.querySelector('.canvas__svg') as SVGGraphicsElement | null;
      const m = svg ? svg.getScreenCTM() : null;
      if (!m) throw new Error('.canvas__svg has no screen CTM');
      return { x: m.a * point.x + m.e, y: m.d * point.y + m.f };
    },
    { x, y },
  );
}

export async function nodeGeometry(page: Page) {
  // The properties panel renders its geometry fields once the selection has
  // settled. Reading them straight after a drag ASSUMES that has already
  // happened; under load it lags, and the read then waits out the whole test
  // timeout (this is how B20d flaked once in a full serial run). Wait on the
  // condition instead of on a fixed pause.
  await field(page, 'X').waitFor({ state: 'visible', timeout: 10000 });
  const v = async (aria: string) => Number(await field(page, aria).inputValue());
  return { x: await v('X'), y: await v('Y'), w: await v('W'), h: await v('H') };
}

/**
 * Drag on the canvas, in coordinates relative to the canvas centre.
 * `ctrl` holds Ctrl for the gesture, which bypasses smart snapping.
 */
export async function drag(
  page: Page,
  from: [number, number],
  to: [number, number],
  options: { ctrl?: boolean } = {},
): Promise<void> {
  const box = await canvasBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (options.ctrl) await page.keyboard.down('Control');
  try {
    await page.mouse.move(cx + from[0], cy + from[1]);
    await page.mouse.down();
    await page.mouse.move(cx + to[0], cy + to[1], { steps: 8 });
    await page.mouse.up();
  } finally {
    if (options.ctrl) await page.keyboard.up('Control');
  }
}

/**
 * Select a creation tool and drag out a shape of the given screen size,
 * centred on (offsetX, offsetY) relative to the canvas centre.
 */
export async function drawShape(
  page: Page,
  toolLabel: string,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
): Promise<void> {
  await tool(page, toolLabel).click();
  await drag(
    page,
    [offsetX - width / 2, offsetY - height / 2],
    [offsetX + width / 2, offsetY + height / 2],
  );
  // Wait on the CONDITION, not a fixed pause: drawing selects the shape and the
  // properties panel then renders its geometry. A caller that reads a field or
  // the node geometry straight afterwards otherwise waits out the whole test
  // timeout under load (how B22a flaked once in a full serial run).
  await field(page, 'X').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(60);
}

export async function clickCanvas(page: Page, dx = 0, dy = 0, modifiers: 'Shift'[] = []) {
  const box = await canvasBox(page);
  // page.mouse.click ignores `modifiers`, so hold the keys around the click.
  for (const key of modifiers) await page.keyboard.down(key);
  try {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  } finally {
    for (const key of modifiers) await page.keyboard.up(key);
  }
}

/** Open the main menu from the bottom toolbar. */
/**
 * Open the main menu.
 *
 * The menu is toggled by a CLICK, and a single click is not reliable under load:
 * it can be lost, or land while the app is busy, leaving the 30s wait to fail
 * with a bare timeout (this is how `B23g` flaked in a full serial run, while
 * passing 3/3 in isolation). Retry the trigger until the CONDITION holds rather
 * than assuming one click works.
 */
export async function openMenu(page: Page): Promise<void> {
  const first = page.locator('.menu__item').first();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await tool(page, 'Main menu').click();
    try {
      await first.waitFor({ state: 'visible', timeout: 2000 });
      return;
    } catch {
      // Not open - the click was swallowed. Try again.
    }
  }
  throw new Error('the main menu did not open after 5 clicks');
}

/** Corner resize handle of the current selection (the NW handle). */
export function nwHandle(page: Page) {
  return page.locator('.canvas__overlay rect[style*="nwse-resize"]').first();
}
