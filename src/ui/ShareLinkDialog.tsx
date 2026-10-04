import { useEffect, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { buildDocumentLink } from '../share/openLink';
import { copyText } from './clipboard';

/**
 * "Copy link to this document".
 *
 * The link does **not** carry the document: it names the URL where the user
 * hosts the file (`#open=<url>&name=<optional>`). Embedding is deliberately not
 * supported — a real design is far past every browser's URL limit and images
 * alone would blow it (docs/FORMAT.md).
 *
 * The document's own URL is used when this document was opened from a link, so
 * re-sharing is one click; otherwise the user says where they put the file.
 */
export function ShareLinkDialog() {
  const open = useEditor((state) => state.shareLinkOpen);
  const setOpen = useEditor((state) => state.setShareLinkOpen);
  const linkedSource = useEditor((state) => state.linkedSource);
  const documentName = useEditor((state) => state.file.name);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Prefill from the link this document came from, and from its name.
    setUrl(linkedSource?.url ?? '');
    setName(linkedSource?.name ?? documentName);
    setCopied(false);
  }, [open, linkedSource, documentName]);

  if (!open) return null;

  const trimmed = url.trim();
  const link =
    trimmed === '' ? '' : buildDocumentLink({ base: window.location.origin, url: trimmed, name: name.trim() });

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Copy link to this document" data-testid="share-link-dialog">
      <div className="modal__backdrop" onClick={() => setOpen(false)} />
      <div className="modal__card">
        <div className="modal__title">Copy link to this document</div>
        <div className="modal__body">
          <p style={{ margin: '0 0 8px', color: 'var(--figma-text-secondary)' }}>
            The link points at the file where you host it — it does not contain the document. Whoever opens it
            needs to be able to read that URL from their browser.
          </p>
          <div className="prop-row">
            <span className="prop-row__label">File URL</span>
            <input
              className="input"
              aria-label="Document URL"
              placeholder="https://example.com/my-design.pigma"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="prop-row">
            <span className="prop-row__label">Name</span>
            <input
              className="input"
              aria-label="Link name"
              placeholder={documentName}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <p style={{ margin: '8px 0 0', color: 'var(--figma-text-secondary)' }}>
            Link: <code aria-label="Document link" data-testid="share-link-value">{link === '' ? '—' : link}</code>
          </p>
        </div>
        <div className="modal__actions">
          <button type="button" className="button" onClick={() => setOpen(false)}>
            Close
          </button>
          <button
            type="button"
            className="button button--primary"
            aria-label="Copy document link"
            disabled={link === ''}
            onClick={() => {
              void copyText(link).then((ok) => {
                setCopied(ok);
                if (ok) useEditor.getState().pushToast('Link copied', 'success');
              });
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  );
}
