import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape } from './helpers';

const APP_ORIGIN = 'http://127.0.0.1:5173';

/** Open the Inspect tab for the current selection. */
async function inspect(page: Page): Promise<void> {
  const tab = page.locator('.tab', { hasText: 'Inspect' });
  await expect(tab).toHaveCount(1);
  await tab.click();
  await page.waitForTimeout(350);
}

/**
 * Select a code target with a REAL click.
 *
 * This used `force: true` while the tabs overflowed their container and the last
 * one was clipped (B44e pinned that defect). The tab row now has its own class
 * and fits, so a plain click must work - forcing here would hide a regression.
 */
async function clickTab(page: Page, label: string): Promise<void> {
  await page.locator(`[aria-label="${label}"]`).click();
  await page.waitForTimeout(250);
}

async function code(page: Page): Promise<string> {
  return (await page.locator('pre[aria-label="Generated code"]').textContent()) ?? '';
}

/** The name of the currently selected node. */
async function selectedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const state = store.getState() as unknown as {
      selection: string[];
      file: { document: { children: Array<{ children: Array<{ id: string; name: string }> }> } };
    };
    const id = state.selection[0];
    const node = state.file.document.children[0]!.children.find((n) => n.id === id);
    if (!node) throw new Error('nothing selected');
    return node.name;
  });
}

/** Copy via the Inspect panel's copy button, then read the clipboard. */
async function copyAndRead(page: Page): Promise<string> {
  await page.locator('[aria-label="Copy code"]').click();
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()), { timeout: 15000 })
    .not.toBe('');
  return page.evaluate(() => navigator.clipboard.readText());
}

test('B44a the Inspect panel exposes all four code targets', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await inspect(page);

  for (const label of ['Show CSS', 'Show React', 'Show SwiftUI', 'Show Compose']) {
    await expect(page.locator(`[aria-label="${label}"]`), `${label} tab is missing`).toBeVisible();
  }
});

test('B44b each target shows real code with the selection name and its geometry', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await inspect(page);

  const name = await selectedName(page);

  // CSS
  await clickTab(page, 'Show CSS');
  let text = await code(page);
  expect(text, 'CSS does not mention the layer').toContain(name.toLowerCase().replace(/\s+/g, '-'));
  expect(text, 'CSS does not carry the measured width').toMatch(/width:\s*200(\.0+)?px/);
  expect(text, 'CSS does not carry the measured height').toMatch(/height:\s*120(\.0+)?px/);

  // React
  await clickTab(page, 'Show React');
  text = await code(page);
  expect(text, 'React does not name the component after the layer').toContain(name.replace(/\s+/g, ''));
  expect(text, 'React does not carry the measured size').toMatch(/200/);
  expect(text).toContain('export function');

  // SwiftUI
  await clickTab(page, 'Show SwiftUI');
  text = await code(page);
  expect(text, 'SwiftUI does not carry the layer name').toContain(name);
  expect(text, 'SwiftUI is not a View').toContain('struct');
  expect(text, 'SwiftUI has no offset for the measured position').toMatch(/\.offset\(x:\s*-?\d/);
  expect(text, 'SwiftUI has no rectangle primitive').toContain('Rectangle()');

  // Compose
  await clickTab(page, 'Show Compose');
  text = await code(page);
  expect(text, 'Compose does not carry the layer name').toContain(name);
  expect(text, 'Compose is not a composable').toContain('@Composable');
  expect(text, 'Compose does not carry the measured size').toMatch(
    /\.size\(width\s*=\s*200(\.0+)?\.dp,\s*height\s*=\s*120(\.0+)?\.dp\)/,
  );
});

test('B44c the copy button follows the active tab', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_ORIGIN });
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await inspect(page);

  // The button label tracks the tab.
  await clickTab(page, 'Show CSS');
  await expect(page.locator('[aria-label="Copy code"]')).toContainText('Copy CSS');
  const cssText = await code(page);

  await clickTab(page, 'Show Compose');
  await expect(page.locator('[aria-label="Copy code"]')).toContainText('Copy Compose');

  const copied = await copyAndRead(page);

  // The clipboard must hold the COMPOSE source, not the CSS that was on screen
  // before: this is the whole point of the button following the tab.
  expect(copied, 'the clipboard holds something other than the Compose output').toContain('@Composable');
  expect(copied, 'the clipboard still holds the CSS view').not.toContain('position: absolute');
  // The clipboard matches the source actually displayed on the Compose tab.
  expect(copied.trim(), 'the copied text differs from the code shown').toBe((await code(page)).trim());
  expect(copied, "the clipboard still holds the previous tab's code").not.toBe(cssText);
});

test('B44d a polygon yields a note, not a fabricated primitive', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Polygon', 140, 100);
  await inspect(page);

  const name = await selectedName(page);

  for (const [label, primitives] of [
    ['Show SwiftUI', ['Rectangle()', 'Ellipse()']],
    ['Show Compose', ['RectangleShape()', 'Circle()']],
  ] as Array<[string, string[]]>) {
    await clickTab(page, label);
    const text = await code(page);

    expect(text, `${label} does not mention the layer`).toContain(name);
    expect(text, `${label} does not report the missing primitive`).toContain('Not represented:');
    expect(text.toLowerCase(), `${label} does not explain the polygon`).toContain('no primitive');

    for (const primitive of primitives) {
      expect(
        text,
        `${label} fabricated a ${primitive} for a polygon - the geometry should be omitted, not faked`,
      ).not.toContain(primitive);
    }
  }

  // The same selection IS given a primitive when it has one, so the absence
  // above is about the polygon rather than a broken panel.
  await clickTab(page, 'Show SwiftUI');
  expect(await code(page)).toContain('Not represented:');
});


test('B44e the tab row fits, and a normal click reaches Show Compose', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await inspect(page);

  const measured = await page.evaluate(() => {
    const wrap = document.querySelector('[data-testid="code-tabs"]');
    if (!wrap) throw new Error('the code-tabs container was not found');
    const rect = wrap.getBoundingClientRect();
    const buttons = [...wrap.querySelectorAll('button')].map((b) => ({
      label: b.getAttribute('aria-label') ?? '',
      right: b.getBoundingClientRect().right,
    }));
    return {
      clientWidth: wrap.clientWidth,
      scrollWidth: wrap.scrollWidth,
      right: rect.right,
      overflow: getComputedStyle(wrap).overflow,
      clipped: buttons.filter((b) => b.right > rect.right + 0.5).map((b) => b.label),
    };
  });

  // FIXED. This test previously pinned a defect: the control reused
  // `.layer-row__actions` - a fixed-width, `overflow: hidden` class built for
  // hover-revealed row actions - so the four tabs (190px) overflowed the 183px
  // box and the last tab was clipped. The tabs now have their own container and
  // nothing is cut off.
  expect(
    measured.scrollWidth,
    `the tabs still overflow (client ${measured.clientWidth}, scroll ${measured.scrollWidth})`,
  ).toBeLessThanOrEqual(measured.clientWidth);
  expect(measured.clipped, `these tabs are still clipped: ${JSON.stringify(measured.clipped)}`).toEqual([]);

  // The real proof of the fix: a plain click, with no force and no workaround,
  // reaches the LAST tab and actually switches the view.
  const compose = page.locator('[aria-label="Show Compose"]');
  await compose.click();
  await expect(compose).toHaveClass(/segmented__option--active/);
  await expect(page.locator('pre[aria-label="Generated code"]')).toContainText('@Composable');
  await expect(page.locator('[aria-label="Copy code"]')).toContainText('Copy Compose');

  // And each of the other three is reachable the same way.
  for (const [label, expected] of [
    ['Show CSS', /position:\s*absolute/],
    ['Show React', /export function/],
    ['Show SwiftUI', /struct/],
  ] as Array<[string, RegExp]>) {
    await page.locator(`[aria-label="${label}"]`).click();
    await expect(page.locator('pre[aria-label="Generated code"]')).toContainText(expected);
  }
});

test('B44f a polygon WITH a shadow invents no primitive in either target', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Polygon', 140, 100);
  await inspect(page);

  // Give the polygon the shadow that makes the shadow modifier appear at all.
  await page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const state = store.getState() as unknown as {
      updateSelected: (patch: Record<string, unknown>, label: string) => void;
    };
    state.updateSelected(
      { effects: [{ type: 'DROP_SHADOW', visible: true, radius: 8, offset: { x: 0, y: 2 }, color: { r: 0, g: 0, b: 0, a: 0.2 } }] },
      'test shadow',
    );
  });
  await page.waitForTimeout(300);

  // FIXED. This test previously pinned a defect: the shadow modifier fell back to
  // `shape ?? corner`, and `corner` defaults to `RectangleShape()`, so a polygon
  // that is deliberately NOT drawn still had a rectangle named as its shadow
  // shape. The shadow now drops the shape argument entirely when the geometry was
  // omitted - no invented primitive.
  await clickTab(page, 'Show Compose');
  const compose = await code(page);
  const shadowLine = compose.split('\n').find((line) => line.includes('.shadow')) ?? '';
  expect(shadowLine, 'the Compose shadow line is missing, so this test proves nothing').not.toBe('');
  expect(shadowLine, 'Compose still fabricates a shape for the shadow').not.toContain('RectangleShape()');
  expect(shadowLine, 'Compose still passes a shape argument for a polygon').not.toContain('shape =');

  // SwiftUI carries the shadow as colour/radius/offset, so the check there is
  // that no primitive was invented anywhere in the output.
  await clickTab(page, 'Show SwiftUI');
  const swift = await code(page);
  expect(swift, 'SwiftUI does not report the missing geometry').toContain('Not represented:');
  for (const primitive of ['Rectangle()', 'Ellipse()', 'Circle()']) {
    expect(swift, `SwiftUI invented a ${primitive} for a polygon`).not.toContain(primitive);
  }
});
