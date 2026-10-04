import { useEffect, useState } from 'react';

/**
 * Layout breakpoint: at or below this width the panels become drawers.
 *
 * MUST stay in sync with the `@media (max-width: 900px)` block at the end of
 * src/styles.css (the CSS owns the layout, this constant owns the behaviour).
 */
export const MOBILE_MAX_WIDTH = 900;

/**
 * True while the viewport is at or below the mobile breakpoint. Implemented with
 * `matchMedia` so it reacts to rotation and window resizing without polling.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => isMobileViewport());
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= MOBILE_MAX_WIDTH;
}
