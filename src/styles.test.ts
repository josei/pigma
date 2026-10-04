import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Two contracts in src/styles.css are about *order*, not just declarations:
 * an override with the same specificity as the rule it cancels only wins when it
 * comes later. Both have already been broken once (a 44px square clipped the
 * text actions; the mobile drawer kept animating under reduced motion), and
 * neither is visible without a browser, so the file itself is asserted here.
 */
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');

/** The body of the `@media (max-width: 900px)` block, braces balanced. */
function mobileBlock(): string {
  const start = css.indexOf('@media (max-width: 900px)');
  expect(start, 'the mobile breakpoint moved: update this test').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces in the mobile block');
}

describe('stylesheet contracts', () => {
  it('keeps a text action as wide as its word on mobile', () => {
    const mobile = mobileBlock();
    const square = mobile.indexOf('.layer-row__action {');
    const text = mobile.indexOf('.layer-row__action--text {');
    expect(square).toBeGreaterThan(-1);
    // Same specificity, so the text rule must come after the square one...
    expect(text).toBeGreaterThan(square);
    // ...and must release the fixed width while keeping the 44px tap target.
    const rule = mobile.slice(text, mobile.indexOf('}', text));
    expect(rule).toContain('width: auto');
    expect(rule).toContain('min-width: 44px');
  });

  it('cancels the drawer animation under reduced motion, after the layout', () => {
    const reduced = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(reduced).toBeGreaterThan(-1);
    const rule = css.slice(reduced);
    expect(rule).toContain('.app__left--open');
    expect(rule).toContain('.app__right--open');
    expect(rule).toContain('animation: none');
    // The mobile block sets the animation; an equal-specificity override must
    // come after it to win.
    expect(reduced).toBeGreaterThan(css.indexOf('@media (max-width: 900px)'));
    expect(css.indexOf('@media', reduced + 1)).toBe(-1);
  });
});
