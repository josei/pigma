import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape } from './helpers';

/**
 * The text properties the code generators emit.
 *
 * Covers the two findings of the generator audit: the FONT FAMILY and the
 * spacing/alignment properties. SwiftUI and Compose spell these differently
 * (`.tracking` / `letterSpacing`), so each is asserted in its own vocabulary
 * rather than with a shared regex.
 */
const FAMILY = 'Playfair Display';

async function inspect(page: Page): Promise<void> {
  const tab = page.locator('.tab', { hasText: 'Inspect' });
  await expect(tab).toHaveCount(1);
  await tab.click();
  await page.waitForTimeout(350);
}

/** Select a code target. The tab row fits its container (see b44 B44e), so a plain click works. */
async function clickTab(page: Page, label: string): Promise<void> {
  await page.locator(`[aria-label="${label}"]`).click();
  await page.waitForTimeout(250);
}

async function code(page: Page): Promise<string> {
  return (await page.locator('pre[aria-label="Generated code"]').textContent()) ?? '';
}

/** A text layer in a non-system family with spacing, line height and alignment set. */
async function styledText(page: Page): Promise<void> {
  await drawShape(page, 'Text', 220, 60);
  await page.evaluate((family) => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const state = store.getState() as unknown as {
      updateSelectedTextStyle: (patch: Record<string, unknown>) => void;
    };
    state.updateSelectedTextStyle({
      fontFamily: family,
      fontSize: 24,
      fontWeight: 600,
      letterSpacing: { unit: 'PERCENT', value: 5 },
      lineHeight: { unit: 'PERCENT', value: 150 },
      textAlignHorizontal: 'CENTER',
    });
  }, FAMILY);
  await page.waitForTimeout(300);
}

test('B46a SwiftUI names the family and emits spacing, line height and alignment', async ({ page }) => {
  await boot(page, { blank: true });
  await styledText(page);
  await inspect(page);
  await page.locator('[aria-label="Show SwiftUI"]').click();

  const swift = await code(page);
  // The audit's headline finding: `.font(.system(...))` carried no family at all.
  expect(swift, 'SwiftUI still names no font family').toContain(`.custom("${FAMILY}"`);
  expect(swift, 'the family is not paired with the size').toMatch(/\.custom\("Playfair Display", size:\s*24/);

  // 5% of 24pt = 1.2pt of tracking.
  expect(swift, 'SwiftUI dropped the letter spacing').toMatch(/\.tracking\(1\.2\)/);
  // 150% of 24pt = 36pt line height.
  expect(swift, 'SwiftUI dropped the line height').toMatch(/\.lineSpacing\(/);
  expect(swift, 'SwiftUI dropped the alignment').toMatch(/\.multilineTextAlignment\(\.center\)/);
});

test('B46b Compose emits letterSpacing, lineHeight and textAlign', async ({ page }) => {
  await boot(page, { blank: true });
  await styledText(page);
  await inspect(page);
  await page.locator('[aria-label="Show Compose"]').click();

  const compose = await code(page);
  expect(compose, 'Compose dropped the letter spacing').toMatch(/letterSpacing\s*=\s*1\.2\.sp/);
  expect(compose, 'Compose dropped the line height').toMatch(/lineHeight\s*=\s*36\.sp/);
  expect(compose, 'Compose dropped the alignment').toContain('TextAlign.Center');
});

test('B46c Compose names the family it cannot generate', async ({ page }) => {
  await boot(page, { blank: true });
  await styledText(page);
  await inspect(page);
  await page.locator('[aria-label="Show Compose"]').click();

  const compose = await code(page);
  // FIXED. This test previously pinned a gap: Compose reported only that "the
  // design font family is not generated", without saying WHICH family, so a
  // developer reading the handoff could not act on it. The note now names it.
  expect(compose, 'the family is not noted as unrepresentable').toContain('Not represented:');
  expect(compose, `Compose does not name ${FAMILY} in its note`).toContain(`font family "${FAMILY}"`);
});

test('B46e every "Not represented" note names a property or a value', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Text', 220, 60);
  await inspect(page);

  // Drive a node that trips several notes at once: an exotic paint, an inner
  // shadow, a blur, a non-normal blend mode and a gradient fill. The point is
  // the NOTES, so the properties are set straight through the store.
  await page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const state = store.getState() as unknown as {
      updateSelected: (patch: Record<string, unknown>, label: string) => void;
      updateSelectedTextStyle: (patch: Record<string, unknown>) => void;
    };
    state.updateSelectedTextStyle({ fontFamily: 'Playfair Display' });
    state.updateSelected(
      {
        blendMode: 'MULTIPLY',
        effects: [
          { type: 'INNER_SHADOW', visible: true, radius: 4, offset: { x: 0, y: 1 }, color: { r: 0, g: 0, b: 0, a: 0.3 } },
          { type: 'LAYER_BLUR', visible: true, radius: 6 },
        ],
      },
      'test notes',
    );
  });
  await page.waitForTimeout(300);

  for (const label of ['Show SwiftUI', 'Show Compose']) {
    await clickTab(page, label);
    const text = await code(page);
    const notes = text
      .split('\n')
      .filter((line) => line.includes('Not represented:'))
      .map((line) => line.slice(line.indexOf('Not represented:') + 'Not represented:'.length).trim());

    expect(notes.length, `${label} produced no notes at all, so this proves nothing`).toBeGreaterThan(1);

    for (const note of notes) {
      // A usable note names something concrete: a quoted value, a parenthesised
      // value, an enum-like token, or a number. "the fill is not generated"
      // would tell a developer nothing; "the IMAGE fill" would.
      const namesSomething =
        /"[^"]+"/.test(note) ||          // a quoted value:  font family "Playfair Display"
        /\([^)]+\)/.test(note) ||        // a parenthesised value: INNER_SHADOW (radius 4)
        /\b[A-Z][A-Z_]{2,}\b/.test(note) || // an enum-like token: IMAGE, LAYER_BLUR
        /\d/.test(note);                 // a numeric value
      expect(
        namesSomething,
        `${label} emitted a bare, unnamed note that a developer cannot act on: "${note}"`,
      ).toBe(true);
    }
  }
});

test('B46d CSS and React both name the family', async ({ page }) => {
  await boot(page, { blank: true });
  await styledText(page);
  await inspect(page);

  await page.locator('[aria-label="Show CSS"]').click();
  const css = await code(page);
  expect(css, 'CSS dropped the font family').toMatch(/font-family:\s*Playfair Display/);
  expect(css).toMatch(/letter-spacing:\s*5%/);
  expect(css).toMatch(/line-height:\s*150%/);
  expect(css).toMatch(/text-align:\s*center/);

  await page.locator('[aria-label="Show React"]').click();
  const react = await code(page);
  expect(react, 'React dropped the font family').toMatch(/fontFamily[^\n]*Playfair Display/);
});
