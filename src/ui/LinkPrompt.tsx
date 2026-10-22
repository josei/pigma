import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { useEscapeToClose } from './useEscapeToClose';

/**
 * The URL prompt for a text selection (Figma: Shift+Cmd+U). Enter links the selected characters; an empty URL removes
 * the link. Escape closes it without a change. The model and drawing are tested in textRanges.test.ts and
 * b120-text-links.spec.ts.
 */
export function LinkPrompt() {
  const prompt = useEditor((state) => state.linkPrompt);
  const close = useEditor((state) => state.closeLinkPrompt);
  const setTextLink = useEditor((state) => state.setTextLink);
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEscapeToClose(prompt !== null, close);

  useEffect(() => {
    if (prompt) {
      setUrl('');
      inputRef.current?.focus();
    }
  }, [prompt]);

  if (!prompt) return null;

  const apply = () => {
    const link = url.trim();
    setTextLink(prompt.nodeId, prompt.start, prompt.end, link === '' ? null : link);
    close();
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Link selected text">
      <div className="modal__backdrop" onClick={close} />
      <div className="modal__card" style={{ maxWidth: 420 }}>
        <div className="modal__title">Link selected text</div>
        <div className="modal__body">
          <input
            ref={inputRef}
            className="input"
            aria-label="Link URL"
            placeholder="https://"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                apply();
              }
            }}
          />
          <p style={{ margin: '6px 0 0', color: 'var(--figma-text-secondary)' }}>An empty URL removes the link.</p>
        </div>
        <div className="modal__actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={apply}>
            Link
          </button>
        </div>
      </div>
    </div>
  );
}
