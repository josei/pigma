import { describe, expect, it, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('static site flag', () => {
  it('is on only when the build says it is the static online copy', async () => {
    vi.stubEnv('VITE_PIGMA_STATIC', '1');
    vi.resetModules();
    expect((await import('./endpoints')).STATIC_SITE).toBe(true);

    vi.unstubAllEnvs();
    vi.resetModules();
    expect((await import('./endpoints')).STATIC_SITE).toBe(false);
  });
});
