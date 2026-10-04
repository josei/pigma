import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './theme-dark.css';
import { useEditor } from './store/editorStore';
import { attachPersistence, attachRoomViewportSharing, restorePersistedDocument } from './store/persistence';
import { attachPresence } from './store/presence';
import { registerServiceWorker } from './pwa';
import {
  LINK_FORMAT_FAILURE,
  fetchLinkedDocument,
  readDocumentLink,
  resolveDocumentUrl,
} from './share/openLink';

declare global {
  interface Window {
    /** Dev-only handle so browser QA and debugging can inspect/drive the store. */
    __pigmaStore?: typeof useEditor;
  }
}

if (import.meta.env.DEV) window.__pigmaStore = useEditor;

/**
 * `?blank=1` boots an empty document instead of the starter design, and skips
 * restoring the saved one. Handy for a clean canvas and for browser QA, which
 * needs a deterministic starting point; persistence still runs from there.
 */
const blank = new URLSearchParams(window.location.search).get('blank') === '1';
// A document link is an explicit request, so it wins over the starter restore:
// the fragment decides what is open, `?blank=1` only skips the library.
const linked = readDocumentLink(window.location.hash);
if (blank || linked) {
  useEditor.getState().newFile();
} else {
  // The document library boots asynchronously (IndexedDB); the store's initial
  // starter document shows until the library has answered. A failed restore must
  // not be silent: the session continues, but the reason is reported.
  void restorePersistedDocument().catch((error: unknown) => {
    console.error('Could not restore the document library', error);
  });
}
/**
 * `#open=<url>&name=<optional>`: a link to a document the user hosts. The link
 * never carries the document itself (docs/FORMAT.md), so the browser fetches it,
 * the payload is validated as data, and the result is loaded **clean** — the
 * user's own document stays untouched until they edit or save.
 *
 * The link wins over the starter document: it is an explicit request, while
 * `?blank=1` only means "do not restore the library".
 */
/** The link already handled, so a repeat hash change does not re-fetch it. */
let loadedLink: string | null = null;

function openDocumentLink(link: { url: string; name: string | null }): void {
  const key = `${link.url}\u0000${link.name ?? ''}`;
  if (loadedLink === key) return;
  loadedLink = key;
  const url = resolveDocumentUrl(link.url, window.location.href);
  if (!url) {
    useEditor.getState().pushToast(LINK_FORMAT_FAILURE);
    return;
  }
  void fetchLinkedDocument(url).then(({ file, error }) => {
    if (file) {
      useEditor.getState().loadLinkedDocument(file, { url, name: link.name });
      return;
    }
    // A CORS refusal, an offline host or a non-Pigma file: say which, and keep
    // the editor usable rather than showing a blank screen.
    useEditor.getState().pushToast(error ?? LINK_FORMAT_FAILURE);
  });
}

if (linked) openDocumentLink(linked);

// A link pasted into an already-open tab changes only the fragment, which does
// not reload the page: handle it too, so a link always opens what it names.
window.addEventListener('hashchange', () => {
  const next = readDocumentLink(window.location.hash);
  if (next) openDocumentLink(next);
});

attachPersistence();
// Ask what this environment offers (desktop shell, server advertisement) so the
// MCP panel knows whether it may offer a connection at all.
void useEditor.getState().loadMcpEnvironment();
// A room peer can follow this tab's viewport, so share it as it changes.
attachRoomViewportSharing();
// Cursors and selections are shared with other tabs of this browser (local only).
attachPresence();
registerServiceWorker();

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
