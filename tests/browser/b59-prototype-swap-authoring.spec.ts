import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/**
 * Authoring a variant swap in the UI.
 *
 * This spec exists because the editor's own smoke drove the wrong selectors: it
 * reported that the kind control is not a `<select>` - it IS one - and the real
 * failures were two panel CONDITIONS (the Target row omitted `SWAP_STATE`, and
 * the create button was enabled with no destination). Both are fixed; this drives
 * the panel for real.
 */

async function openPrototypePanel(page: Page): Promise<void> {
  const tab = page.locator('.tab', { hasText: 'Prototype' });
  await expect(tab, 'the Prototype tab is missing').toHaveCount(1);
  await tab.click();
  await page.waitForTimeout(400);
}

const kind = (page: Page) => page.locator('select[aria-label="Action kind"]');
const target = (page: Page) => page.locator('select[aria-label="Navigate to"]');
const apply = (page: Page) => page.locator('button', { hasText: 'Apply link' });

/** A page holding a component set with two variants, plus a frame to swap on. */
async function withComponentSet(page: Page): Promise<void> {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -200, -120);
  await tool(page, 'Create component').click();
  await page.waitForTimeout(300);
  await drawShape(page, 'Rectangle', 120, 90, -60, -120);
  await tool(page, 'Create component').click();
  await page.waitForTimeout(300);

  // Select both components and combine them into a set.
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const pageNode = (store.getState() as unknown as {
      file: { document: { children: Array<{ children: Array<{ id: string; type: string }> }> } };
    }).file.document.children[0]!;
    const ids = pageNode.children.filter((n) => n.type === 'COMPONENT').map((n) => n.id);
    (store.getState() as unknown as { select: (ids: string[]) => void }).select(ids);
  });
  await page.waitForTimeout(250);
  await page.locator('button', { hasText: 'Create component set' }).click();
  await page.waitForTimeout(400);

  // A plain frame, which will carry the swap.
  await drawShape(page, 'Frame', 200, 140, 160, 0);
}

test('B59a the Prototype panel offers "Swap variant" as an action kind', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await openPrototypePanel(page);

  await expect(kind(page), 'the Action kind control is missing').toHaveCount(1);
  await expect(kind(page).locator('option[value="SWAP_STATE"]'), 'the kind list has no SWAP_STATE value').toHaveCount(1);
});

test('B59b choosing "Swap variant" OFFERS the destination, grouped by set name', async ({ page }) => {
  await withComponentSet(page);
  await openPrototypePanel(page);

  // Navigate offers a destination - the control can be driven at all.
  await kind(page).selectOption('NAVIGATE');
  await page.waitForTimeout(250);
  await expect(target(page), 'the Navigate kind offers no target - the harness is wrong').toHaveCount(1);

  // THE FLIPPED ASSERTION: the swap offers one too. It used to vanish.
  await kind(page).selectOption('SWAP_STATE');
  await page.waitForTimeout(350);
  await expect(target(page), 'the swap still offers no destination').toHaveCount(1);

  // The variants are listed under their SET, so a swap target is findable.
  const labels = await target(page).locator('option').allTextContents();
  expect(labels[0], 'the first option is not the empty choice').toContain('No action');
  expect(labels.slice(1).some((l) => l.includes(' / ')), `no variant is grouped by its set: ${JSON.stringify(labels)}`).toBe(true);
});

test('B59c the create button is DISABLED until a swap destination is chosen', async ({ page }) => {
  await withComponentSet(page);
  await openPrototypePanel(page);

  await kind(page).selectOption('SWAP_STATE');
  await page.waitForTimeout(350);
  // Enabled-with-no-destination was the sharper defect: a swap pointing at nothing.
  await expect(apply(page), 'a swap could be created with no destination').toBeDisabled();

  const firstVariant = await target(page).locator('option').nth(1).getAttribute('value');
  expect(firstVariant, 'no variant to choose').toBeTruthy();
  await target(page).selectOption(firstVariant!);
  await page.waitForTimeout(300);
  await expect(apply(page), 'the button stayed disabled after choosing a destination').toBeEnabled();
});

test('B59d a kind with no destination offers none (negative control)', async ({ page }) => {
  await withComponentSet(page);
  await openPrototypePanel(page);

  await kind(page).selectOption('BACK');
  await page.waitForTimeout(350);
  await expect(target(page), 'the Back kind offered a destination it does not take').toHaveCount(0);
  await expect(kind(page), 'the panel stopped rendering').toHaveCount(1);
});

test('B59e applying the link creates a SWAP_STATE action at the chosen variant', async ({ page }) => {
  await withComponentSet(page);
  await openPrototypePanel(page);

  await kind(page).selectOption('SWAP_STATE');
  await page.waitForTimeout(300);
  const options = await target(page).locator('option').evaluateAll((els) =>
    els.map((e) => ({ value: (e as HTMLOptionElement).value, label: e.textContent ?? '' })),
  );
  const variant = options.find((o) => o.label.includes(' / '));
  expect(variant, `no grouped variant in the destination list: ${JSON.stringify(options)}`).toBeTruthy();
  await target(page).selectOption(variant!.value);
  await page.waitForTimeout(300);
  await apply(page).click();
  await page.waitForTimeout(450);

  const created = await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const s = store.getState() as unknown as {
      selection: string[];
      file: { document: { children: Array<{ children: Array<Record<string, unknown>> }> } };
    };
    const walk = (nodes: Array<Record<string, unknown>>): Record<string, unknown> | null => {
      for (const n of nodes) {
        if (n.id === s.selection[0]) return n;
        const hit = walk((n.children ?? []) as Array<Record<string, unknown>>);
        if (hit) return hit;
      }
      return null;
    };
    const node = walk(s.file.document.children as unknown as Array<Record<string, unknown>>)!;
    const actions = (node.interactions ?? []) as Array<{ actions?: Array<{ navigation?: string; destinationId?: string }> }>;
    const all = actions.flatMap((i) => i.actions ?? []);
    return all.map((a) => ({ navigation: a.navigation, destinationId: a.destinationId }));
  });

  expect(created.length, 'no interaction was created').toBeGreaterThan(0);
  expect(created[0]!.navigation, 'the created action is not a swap').toBe('SWAP_STATE');
  expect(created[0]!.destinationId, 'the swap points at nothing').toBe(variant!.value);
});

test('B59f the authored swap plays back IN PLACE: the stack and the frame are untouched', async ({ page }) => {
  await withComponentSet(page);
  await openPrototypePanel(page);

  await kind(page).selectOption('SWAP_STATE');
  await page.waitForTimeout(300);
  const options = await target(page).locator('option').evaluateAll((els) =>
    els.map((e) => ({ value: (e as HTMLOptionElement).value, label: e.textContent ?? '' })),
  );
  const variant = options.find((o) => o.label.includes(' / '));
  expect(variant, 'no grouped variant to swap to').toBeTruthy();
  await target(page).selectOption(variant!.value);
  await page.waitForTimeout(250);
  await apply(page).click();
  await page.waitForTimeout(400);

  // Make the swapped frame the prototype start frame.
  const startFrame = page.locator('select[aria-label="Prototype start frame"]');
  const frameOptions = await startFrame.locator('option').evaluateAll((els) =>
    els.map((e) => ({ v: (e as HTMLOptionElement).value, t: (e.textContent ?? '').trim() })),
  );
  const chosen = frameOptions.find((o) => o.v !== '' && o.t.includes('Frame'));
  expect(chosen, `no frame offered as a start frame: ${JSON.stringify(frameOptions)}`).toBeTruthy();
  await startFrame.selectOption(chosen!.v);
  await page.waitForTimeout(350);

  await tool(page, 'Present').click();
  await page.waitForTimeout(600);
  await expect(page.locator('.present__stage'), 'presentation has no stage to play in').toHaveCount(1);

  // Snapshot AFTER entering: `presentationFrameId` is set on entering, so reading
  // it earlier compares against null and proves nothing.
  const before = await page.evaluate(() => {
    const s = window.__pigmaStore!.getState() as unknown as {
      presentationFrameId: string | null;
      presentationStack: string[];
    };
    return { frame: s.presentationFrameId, stack: [...s.presentationStack] };
  });
  expect(before.frame, 'presentation has no frame, so there is nothing to swap within').not.toBeNull();

  // Click the stage where the hotspot is, then read the stack back.
  const stage = (await page.locator('.present__stage').boundingBox())!;
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.waitForTimeout(700);

  const after = await page.evaluate(() => {
    const s = window.__pigmaStore!.getState() as unknown as {
      presentationFrameId: string | null;
      presentationStack: string[];
    };
    return { frame: s.presentationFrameId, stack: [...s.presentationStack] };
  });

  // A swap happens IN PLACE: it must NOT push the destination onto the stack (that
  // is what a NAVIGATE does). The presented frame stays the same too.
  expect(after.stack, `the swap pushed onto the stack instead of swapping in place: ${JSON.stringify(after)}`).toEqual(before.stack);
  expect(after.frame, 'the swap changed the presented frame').toBe(before.frame);
});
