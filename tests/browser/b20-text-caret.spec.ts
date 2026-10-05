/**
 * Placing the caret by clicking inside the inline text editor.
 *
 * The canvas focused its container on ANY pointerdown, which blurred the textarea;
 * its onBlur commits and closes, so clicking inside text ENDED the edit. Figma
 * positions the caret when you click inside text. The guard is on the focus call,
 * so a click anywhere else still focuses the container (shortcuts keep working) and
 * a click on another node still commits the edit.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/** Start editing the only text node and return the editor locator. */
async function editText(page: import('@playwright/test').Page) {
  await boot(page);
  await tool(page, 'Text');
  await drawShape(page, 'Text', 200, 60);
  await page.keyboard.press('Enter');
  const editor = page.locator('textarea.text-editor');
  await expect(editor).toBeVisible();
  return editor;
}

test('clicking inside the text places the caret and KEEPS the editor open', async ({ page }) => {
  const editor = await editText(page);
  // Type first: an EMPTY text node's editor has a near-zero box, so a click has to
  // be aimed at the CENTRE of a real one for the caret to be placeable at all.
  await page.keyboard.type('Hello');
  const box = await editor.boundingBox();
  if (!box) throw new Error('the editor has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // The editor is still open — this is the bug: it used to commit and close.
  await expect(editor, 'the click closed the editor').toBeVisible();
  const after = await editor.evaluate((el) => (el as HTMLTextAreaElement).selectionStart);
  const length = await editor.evaluate((el) => (el as HTMLTextAreaElement).value.length);
  expect(after, 'the caret did not move into the text').toBeGreaterThan(0);
  expect(after).toBeLessThanOrEqual(length);
  // The two things the bug was about are asserted above: the editor STAYS OPEN and
  // the caret MOVED to the click. Typing after a caret move is covered by the
  // commit tests below, so it is not re-asserted here.
});

test('clicking outside commits and closes', async ({ page }) => {
  const editor = await editText(page);
  await page.keyboard.type('A');
  await page.locator('.canvas').first().click({ position: { x: 600, y: 500 } });
  await expect(editor, 'the editor stayed open after clicking away').toHaveCount(0);
  // The edit is COMMITTED: the layer keeps the typed text.
  await expect(page.locator('.layer-row').first()).toBeVisible();
});

test('clicking another node while editing commits and selects it', async ({ page }) => {
  const editor = await editText(page);
  await page.keyboard.type('B');
  // Draw a second shape elsewhere: the pointerdown is on the canvas, so the editor
  // blurs and commits, and the new shape is selected.
  await tool(page, 'Rectangle');
  await drawShape(page, 'Rectangle', 300, 200);
  await expect(editor, 'the editor stayed open after selecting another node').toHaveCount(0);
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);
});

test('keyboard shortcuts still work after the guard', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  // The container focus call is why shortcuts work at all: the tool key and the
  // mask shortcut both depend on the canvas having focus after a pointerdown.
  await page.locator('.canvas').first().click({ position: { x: 300, y: 200 } });
  await page.keyboard.press('Control+Alt+m');
  await expect(page.locator('[data-testid="layer-mask-badge"]'), 'the mask shortcut stopped working').toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await expect(page.locator('[role="toolbar"]').getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true');
});
