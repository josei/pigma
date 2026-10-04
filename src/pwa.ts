/**
 * Registers the Pigma service worker so the editor is installable and can boot
 * offline. Registration is production-only: a dev server with an active worker
 * caches transformed modules and fights Vite's HMR. Any failure is swallowed —
 * offline support is a progressive enhancement, never a boot dependency.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Offline support is best-effort; a failed registration must not break the app.
  });
}
