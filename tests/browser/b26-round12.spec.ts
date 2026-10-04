import { test, expect, type Page } from '@playwright/test';
import { boot } from './helpers';

const APP_ORIGIN = 'http://127.0.0.1:5173';

async function openTools(page: Page) {
  await page.locator('.rail__button[aria-label="Tools"]').click();
  await page.waitForTimeout(400);
}

test('B26a the MCP panel never renders a raw token', async ({ page }) => {
  await boot(page, { blank: true });
  await openTools(page);

  // The endpoint field is STATE-DEPENDENT: present in the desktop and
  // self-hosted states, absent in the hosted state where the panel is gated
  // (see b34-mcp-gating). Assert the invariant that holds in every state rather
  // than assuming the connect UI is always present.
  const endpoint = page.locator('input[aria-label="MCP endpoint"]');
  if ((await endpoint.count()) > 0) {
    expect(await endpoint.inputValue()).toMatch(/^https?:\/\/|^ws:\/\//);
  }

  // Any token field must be masked in the DOM: password type, or a sentinel that
  // is not a secret.
  const tokens = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>('.app__left input')]
      .filter((i) => /token/i.test(i.getAttribute('aria-label') ?? ''))
      .map((i) => ({
        aria: i.getAttribute('aria-label'),
        type: i.type,
        value: i.value,
      })),
  );
  expect(tokens.length, 'no token fields found').toBeGreaterThan(0);
  for (const token of tokens) {
    const masked = token.type === 'password' || /none required|^$/.test(token.value);
    expect(masked, `token "${token.aria}" is not masked: type=${token.type} value=${token.value}`).toBe(
      true,
    );
  }

  // If the panel offers a connect state, its status is visible.
  const status = page.locator('[data-testid="mcp-bridge-status"]');
  if ((await status.count()) > 0) {
    await expect(status).toHaveText(/disconnected/);
  }
});

test('B26b Copy harness config writes a config for the selected harness', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_ORIGIN });
  await boot(page, { blank: true });
  await openTools(page);

  const harness = page.locator('select[aria-label="Harness"]');
  await expect(harness).toHaveCount(1);
  const harnesses = await harness.locator('option').allTextContents();
  expect(harnesses.length).toBeGreaterThan(1);

  const copied = async () => {
    await page.locator('[aria-label="Copy harness config"]').click();
    return expect
      .poll(
        async () => page.evaluate(async () => navigator.clipboard.readText()),
        { timeout: 5000 },
      )
      .not.toBe('');
  };

  await harness.selectOption({ index: 0 });
  await copied();
  const first = await page.evaluate(async () => navigator.clipboard.readText());

  // A different harness must produce different config.
  await harness.selectOption({ index: 1 });
  await expect
    .poll(async () => {
      await page.locator('[aria-label="Copy harness config"]').click();
      return page.evaluate(async () => navigator.clipboard.readText());
    }, { timeout: 5000 })
    .not.toBe(first);

  const second = await page.evaluate(async () => navigator.clipboard.readText());
  expect(second).not.toBe(first);
  expect(second.length).toBeGreaterThan(10);
});

test('B26c the endpoint and token have copy affordances', async ({ page }) => {
  await boot(page, { blank: true });
  await openTools(page);
  await expect(page.locator('[aria-label="Copy MCP endpoint"]')).toHaveCount(1);
  await expect(page.locator('[aria-label="Copy MCP token"]')).toHaveCount(1);
});

test('B26d Rooms offers a join control with a nickname', async ({ page }) => {
  await boot(page, { blank: true });
  const rooms = page.locator('.rail__button[aria-label="Rooms"]');
  await expect(rooms).toHaveCount(1);
  await rooms.click();
  await page.waitForTimeout(400);

  const controls = await page.evaluate(() =>
    [...document.querySelectorAll('.app__left input, .app__left select, .app__left button')].map(
      (el) => el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 24),
    ).filter(Boolean),
  );
  expect(controls.length, 'the Rooms panel is empty').toBeGreaterThan(0);
  const joined = controls.join(' | ').toLowerCase();
  expect(joined, `no join/nickname control in Rooms: ${JSON.stringify(controls)}`).toMatch(
    /join|nickname|room/,
  );
});
