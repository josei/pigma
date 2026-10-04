import { test as base, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * PWA offline reload.
 *
 * Service workers are NOT registered in dev, so this runs against the BUILT app
 * served by `vite preview`. A cold visit must register the worker; a reload with
 * the network disabled must still render the shell.
 *
 * Skipped with an explicit reason when `dist/` has not been built.
 */
async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const closed = once(probe, 'close');
  probe.close();
  await closed;
  return port;
}

async function waitForHttp(url: string, timeoutMs = 40000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await delay(300);
  }
  return false;
}

export const test = base.extend<{ previewUrl: string }>({
  previewUrl: async ({}, use) => {
    const { existsSync } = await import('node:fs');
    if (!existsSync('dist/index.html')) {
      test.skip(true, 'dist/ has not been built: run `npm run build` first');
    }
    const port = await freePort();
    const child: ChildProcess = spawn(
      'npx',
      ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
      { cwd: process.cwd(), stdio: 'ignore', detached: true },
    );
    const url = `http://127.0.0.1:${port}`;
    try {
      const up = await waitForHttp(url);
      expect(up, `vite preview never served ${url}`).toBe(true);
      await use(url);
    } finally {
      const pid = child.pid;
      if (pid) {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          try {
            child.kill('SIGTERM');
          } catch {
            // already gone
          }
        }
        await Promise.race([once(child, 'exit').then(() => undefined), delay(3000)]);
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
  },
});

test('B37a a cold visit registers a service worker', async ({ page, previewUrl }) => {
  await page.goto(previewUrl);
  await page.waitForSelector('.app');

  // Registration is async; poll until the worker exists.
  await expect
    .poll(
      async () => page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
});

test('B37b an offline reload still renders the shell', async ({ page, context, previewUrl }) => {
  await page.goto(previewUrl);
  await page.waitForSelector('.app');

  // Let the worker install and take control, then reload so the page is served
  // by it rather than by the network.
  await expect
    .poll(
      async () => page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  await page.reload();
  await page.waitForSelector('.app');
  await page.waitForTimeout(1500);

  await context.setOffline(true);
  try {
    await page.reload();
    // The shell must come back from the cache with no network.
    await expect(page.locator('.app')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.canvas')).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
