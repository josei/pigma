import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';
import { useEditor } from './store/editorStore';

/**
 * Server-render smoke test: it mounts the real shell (rail, panels, canvas,
 * toolbar) with the real store, which catches missing providers, bad hooks and
 * broken render paths without needing a browser.
 */
/** Render with a phone-sized viewport: the initial state is all SSR reads. */
function renderMobile(): string {
  const globals = globalThis as unknown as { window?: unknown };
  const previous = globals.window;
  globals.window = { innerWidth: 390, innerHeight: 844, matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) };
  try {
    return renderToStaticMarkup(<App />);
  } finally {
    if (previous === undefined) delete globals.window;
    else globals.window = previous;
  }
}

describe('App shell', () => {
  it('renders the full editor chrome with the starter document', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('class="app"');
    expect(html).toContain('app__rail');
    expect(html).toContain('app__left');
    expect(html).toContain('app__right');
    expect(html).toContain('app__canvas');
    expect(html).toContain('class="toolbar"');
    expect(html).toContain('canvas__svg');
    expect(html).toContain('Pigma');
  });

  it('marks the closed mobile drawer explicitly and leaves one close control', () => {
    const html = renderMobile();
    // The closed state is observable in the markup, not just a transform.
    expect(html).toContain('data-drawer="left"');
    expect(html).toContain('data-drawer-state="closed"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('drawer-scrim');
    // Exactly one control claims the "Close panel" label (the left drawer); the
    // design drawer and the scrim do not compete for it.
    expect(html.match(/aria-label="Close panel"/g) ?? []).toHaveLength(1);
    expect(html.match(/aria-label="Close design panel"/g) ?? []).toHaveLength(1);
  });

  it('toggles the mobile drawer through the store', () => {
    // The markup for the open drawer is covered by the mobile browser specs; the
    // store side is the part a unit test can pin: one drawer at a time, and a
    // second click on the same side closes it.
    useEditor.setState({ mobileDrawer: null });
    useEditor.getState().setMobileDrawer('left');
    expect(useEditor.getState().mobileDrawer).toBe('left');
    useEditor.getState().setMobileDrawer('right');
    expect(useEditor.getState().mobileDrawer).toBe('right');
    useEditor.getState().setMobileDrawer('right');
    expect(useEditor.getState().mobileDrawer).toBeNull();
  });

  it('leaves the desktop markup free of drawer state', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).not.toContain('data-drawer-state');
    expect(html).not.toContain('drawer-scrim');
  });

  it('renders every tool button and panel tab', () => {
    const html = renderToStaticMarkup(<App />);
    for (const label of ['Move', 'Frame', 'Rectangle', 'Ellipse', 'Line', 'Text', 'Hand tool']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('>Design<');
    expect(html).toContain('>Prototype<');
    expect(html).toContain('>Pages<');
  });

  it('renders scene content, layer rows and page rows', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('layer-row');
    expect(html).toContain('page-row');
    expect(html).toContain('Home / Hero');
    expect(html).toContain('<text');
  });

  it('renders the empty-selection panel for the active page', () => {
    // zustand v4 deliberately serves the initial snapshot during SSR, so this
    // asserts the boot state; live selection updates are covered by the store
    // tests and the browser QA suite.
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('Nothing selected');
    expect(html).toContain('Alignment');
    expect(html).toContain('Website');
    expect(useEditor.getState().selection).toEqual([]);
  });
});
