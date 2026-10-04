import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/**
 * Component slots / instance swap - what a user can actually reach.
 *
 * The editor's slot work is model-level. This checks the CONTROL a user would
 * use, and it found that it cannot render at all (see B58a).
 */

/** Draw a rectangle and promote it to a component; returns its name. */
async function makeComponent(page: Page, dx: number): Promise<string> {
  await drawShape(page, 'Rectangle', 160, 120, dx, 0);
  await tool(page, 'Create component').click();
  await page.waitForTimeout(350);
  return (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
}

/** The swap control's presence, and the property definitions behind it. */
async function swapSurface(page: Page) {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const state = store.getState() as unknown as {
      selection: string[];
      file: { document: { children: Array<{ children: Array<Record<string, unknown>> }> } };
    };
    const id = state.selection[0];
    const walk = (nodes: Array<Record<string, unknown>>): Record<string, unknown> | null => {
      for (const n of nodes) {
        if (n.id === id) return n;
        const hit = walk((n.children ?? []) as Array<Record<string, unknown>>);
        if (hit) return hit;
      }
      return null;
    };
    const node = walk(state.file.document.children as unknown as Array<Record<string, unknown>>)!;
    const masters: Array<{ name: unknown; defs: string[] }> = [];
    const collect = (nodes: Array<Record<string, unknown>>): void => {
      for (const n of nodes) {
        if (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') masters.push({ name: n.name, defs: Object.keys((n.componentPropertyDefinitions ?? {}) as object) });
        collect((n.children ?? []) as Array<Record<string, unknown>>);
      }
    };
    collect(state.file.document.children as unknown as Array<Record<string, unknown>>);
    return {
      selectedType: node.type as string,
      selectedId: id,
      instanceProps: (node.componentProperties ?? {}) as Record<string, unknown>,
      panelSelects: [...document.querySelectorAll('.app__right select')].map((s) => s.getAttribute('aria-label')),
      masters,
    };
  });
}

test('B58a an instance does NOT offer its component\'s swap control (DEFECT)', async ({ page }) => {
  await boot(page, { blank: true });
  const component = await makeComponent(page, -160);

  // The COMPONENT offers the control, and a definition really is stored.
  await page.locator('input[aria-label="New property name"]').fill('Swap target');
  await page.waitForTimeout(150);
  await page.locator('[aria-label="Add instance_swap property"]').click();
  await page.waitForTimeout(400);

  const onComponent = await swapSurface(page);
  expect(onComponent.selectedType, 'the source is not a component').toBe('COMPONENT');
  expect(
    onComponent.masters.some((m) => m.defs.includes('Swap target')),
    `the INSTANCE_SWAP definition was not stored: ${JSON.stringify(onComponent.masters)}`,
  ).toBe(true);

  // Insert an instance of that same component.
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.locator('.app__left .layer-row', { hasText: component }).first().dblclick();
  await page.waitForTimeout(450);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.waitForTimeout(250);

  const onInstance = await swapSurface(page);
  expect(onInstance.selectedType, 'the inserted node is not an instance').toBe('INSTANCE');

  // OBSERVED DEFECT. `componentPropertiesOf` (src/model/variants.ts:46) returns
  // `{}` for anything that is not a COMPONENT or COMPONENT_SET, and the panel
  // builds `definitions` from the SELECTED node - so on an instance it is always
  // empty and no variant/BOOLEAN/TEXT/INSTANCE_SWAP control can render, even
  // though the section's own doc comment promises "For an instance: a switch per
  // variant property plus BOOLEAN/TEXT/INSTANCE_SWAP controls".
  //
  // Pinned so that landing the fix shows up as a failure here.
  expect(
    onInstance.panelSelects,
    `an instance now offers its component's properties: ${JSON.stringify(onInstance.panelSelects)} - the defect is fixed, update this test`,
  ).not.toContain('Swap target');
  expect(onInstance.masters.some((m) => m.defs.includes('Swap target')), 'the definition vanished').toBe(true);
  expect(onInstance.instanceProps['Swap target'], 'the swap has no value to resolve').toBeUndefined();
});
