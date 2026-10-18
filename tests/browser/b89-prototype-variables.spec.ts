import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/**
 * Prototype variables, slice 1: a SET_VARIABLE action runs on a click and holds its
 * value for the presentation. There is no authoring UI yet, so the interaction is set
 * through the store; the presentation exposes its variable values for the check.
 */
test('B89a a click that sets a variable holds its value for the presentation', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 300, 220, 0, 0);
  // A clickable rectangle inside the frame, which the trigger belongs to.
  await drawShape(page, 'Rectangle', 80, 60, 0, 0);
  const rectId = await page.evaluate(() => {
    const frame = (window.__pigmaStore!.getState().file.document.children[0]!.children as any[])[0];
    return frame.children[0].id as string;
  });
  await page.evaluate((id) => {
    window.__pigmaStore!.getState().apply('Trigger', (file) => {
      const fix = (node: any): any => (node.id === id
        ? { ...node, interactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'SET_VARIABLE', variableId: 'open', variableValue: true }] }] }
        : node.children ? { ...node, children: node.children.map(fix) } : node);
      return { ...file, document: fix(file.document) };
    });
  }, rectId);

  // The start frame: presentation plays from the page's prototype start.
  await page.evaluate(() => {
    const frame = (window.__pigmaStore!.getState().file.document.children[0]!.children as any[])[0];
    window.__pigmaStore!.getState().setPrototypeStart(frame.id);
  });

  await tool(page, 'Present').click();
  await page.waitForTimeout(500);
  const hotspot = page.locator('.present__hotspot').first();
  await expect(hotspot).toBeVisible();
  await expect(page.locator('.present')).toHaveAttribute('data-variables', '{}');
  await hotspot.click();
  await page.waitForTimeout(200);
  await expect(page.locator('.present'), 'the click did not set the variable').toHaveAttribute('data-variables', '{"open":true}');
});

/**
 * Slice 2: the authoring UI. A Set variable link is made in the Prototype tab, with the
 * variable chosen from the file's variables, and playback then sets it on the click.
 */
test('B90a a Set variable link is authored in the Prototype tab and sets the variable on click', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 300, 220, 0, 0);
  await drawShape(page, 'Rectangle', 80, 60, 0, 0);
  const frameId = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as any[])[0].id as string);
  // A boolean variable to set.
  const variableId = await page.evaluate(() => {
    const store = window.__pigmaStore!.getState() as any;
    store.addVariableCollection();
    const collectionId = Object.keys((window.__pigmaStore!.getState() as any).file.variableCollections ?? {})[0]!;
    window.__pigmaStore!.getState().addVariable(collectionId, 'BOOLEAN');
    return Object.keys((window.__pigmaStore!.getState() as any).file.variables ?? {})[0]!;
  });
  // Select the rectangle, the trigger's layer.
  await page.locator('.app__left .layer-row', { hasText: 'Rectangle' }).first().click();

  await page.locator('.tab', { hasText: 'Prototype' }).click();
  await page.locator('select[aria-label="Action kind"]').selectOption('SET_VARIABLE');
  await page.locator('select[aria-label="Variable to set"]').selectOption(variableId);
  await page.locator('select[aria-label="Variable value"]').selectOption('false');
  await page.locator('.button', { hasText: 'Apply link' }).click();
  await page.waitForTimeout(250);

  const stored = await page.evaluate(() => {
    const doc = (window.__pigmaStore!.getState() as any).file.document;
    const found = (node: any): any => (node.interactions?.length ? node : (node.children ?? []).map(found).find(Boolean));
    return found(doc.children[0]);
  });
  expect(stored?.interactions?.[0]?.actions?.[0], 'the link was not stored').toMatchObject({ type: 'SET_VARIABLE', variableValue: false });

  // Play it: the click sets the variable, which the presentation then holds.
  await page.evaluate((id) => window.__pigmaStore!.getState().setPrototypeStart(id), frameId);
  await tool(page, 'Present').click();
  await page.waitForTimeout(500);
  await expect(page.locator('.present')).toHaveAttribute('data-variables', '{}');
  await page.locator('.present__hotspot').first().click();
  await page.waitForTimeout(200);
  await expect(page.locator('.present')).toHaveAttribute('data-variables', `{"${variableId}":false}`);
});

/**
 * Slice 3: a conditional interaction is a hotspot only while its variable holds the value
 * it names. A click that sets the variable shows the conditional hotspot.
 */
test('B91a a conditional hotspot appears only after a click sets its variable', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 300, 220, 0, 0);
  await drawShape(page, 'Rectangle', 80, 60, -80, -60);
  await drawShape(page, 'Ellipse', 80, 60, 80, 60);
  const ids = await page.evaluate(() => {
    const frame = (window.__pigmaStore!.getState().file.document.children[0]!.children as any[])[0];
    return { frame: frame.id as string, rect: frame.children[0].id as string, ellipse: frame.children[1].id as string };
  });
  // The rectangle sets `open` to true on a click; the ellipse is a link that runs only once `open` is true.
  await page.evaluate(([rect, ellipse, frame]) => {
    window.__pigmaStore!.getState().apply('Links', (file) => {
      const fix = (node: any): any => {
        if (node.id === rect) return { ...node, interactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'SET_VARIABLE', variableId: 'open', variableValue: true }] }] };
        if (node.id === ellipse) return { ...node, interactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'SET_VARIABLE', variableId: 'done', variableValue: true }], condition: { variableId: 'open', value: true } }] };
        return node.children ? { ...node, children: node.children.map(fix) } : node;
      };
      return { ...file, document: fix(file.document) };
    });
    window.__pigmaStore!.getState().setPrototypeStart(frame ?? null);
  }, [ids.rect, ids.ellipse, ids.frame]);

  await tool(page, 'Present').click();
  await page.waitForTimeout(500);
  // Before the click: the rectangle's link shows; the conditional ellipse's does not.
  await expect(page.locator('.present__hotspot[aria-label*="Rectangle"]')).toHaveCount(1);
  await expect(page.locator('.present__hotspot[aria-label*="Ellipse"]'), 'a conditional hotspot showed before its condition held').toHaveCount(0);

  await page.locator('.present__hotspot[aria-label*="Rectangle"]').click();
  await page.waitForTimeout(250);
  await expect(page.locator('.present__hotspot[aria-label*="Ellipse"]'), 'the conditional hotspot did not appear').toHaveCount(1);
});

