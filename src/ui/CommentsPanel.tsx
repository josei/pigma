import { useState } from 'react';
import { Icon } from './icons';
import { useEditor } from '../store/editorStore';
import { commentsForPage } from '../model/comments';

/** Comment threads for the current page: reply, resolve, reopen and delete. */
export function CommentsPanel() {
  const file = useEditor((state) => state.file);
  const pageId = useEditor((state) => state.pageId);
  const activeCommentId = useEditor((state) => state.activeCommentId);
  const setActiveComment = useEditor((state) => state.setActiveComment);
  const replyToComment = useEditor((state) => state.replyToComment);
  const setCommentResolved = useEditor((state) => state.setCommentResolved);
  const deleteComment = useEditor((state) => state.deleteComment);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const threads = commentsForPage(file, pageId);
  const open = threads.filter((thread) => !thread.resolved);

  return (
    <div className="section">
      <div className="section__header">
        <span>Comments</span>
        <span style={{ color: 'var(--figma-text-tertiary)' }}>{open.length} open</span>
      </div>
      <div className="section__body">
        {threads.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
            No comments on this page — pick the Comment tool and click the canvas.
          </p>
        ) : null}
        {threads.map((thread) => (
          <div
            key={thread.id}
            className={`layer-row layer-row--always-actions${activeCommentId === thread.id ? ' layer-row--selected' : ''}`}
            style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}
            onClick={() => setActiveComment(activeCommentId === thread.id ? null : thread.id)}
          >
            <span className="layer-row__icon">
              <Icon name={thread.resolved ? 'check' : 'menu'} size={13} />
            </span>
            <span className="layer-row__name" aria-label={`Comment ${thread.text}`}>
              {thread.resolved ? '✓ ' : ''}{thread.author}: {thread.text}
              {thread.replies.length > 0 ? ` (+${thread.replies.length})` : ''}
            </span>
            <span className="layer-row__actions">
              <button
                type="button"
                className="layer-row__action layer-row__action--text"
                aria-label={thread.resolved ? `Reopen ${thread.text}` : `Resolve ${thread.text}`}
                data-tooltip={thread.resolved ? 'Reopen' : 'Resolve'}
                onClick={(event) => {
                  event.stopPropagation();
                  setCommentResolved(thread.id, !thread.resolved);
                }}
              >
                <Icon name={thread.resolved ? 'unlock' : 'check'} size={13} />
                <span>{thread.resolved ? 'Reopen' : 'Resolve'}</span>
              </button>
              <button
                type="button"
                className="layer-row__action"
                aria-label={`Delete ${thread.text}`}
                data-tooltip="Delete thread"
                onClick={(event) => {
                  event.stopPropagation();
                  deleteComment(thread.id);
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </span>
            {activeCommentId === thread.id ? (
              <div style={{ width: '100%', paddingLeft: 18 }}>
                {thread.replies.map((reply) => (
                  <p key={reply.id} style={{ margin: '4px 0', color: 'var(--figma-text-secondary)' }}>
                    {reply.author}: {reply.text}
                  </p>
                ))}
                <div className="prop-row" onClick={(event) => event.stopPropagation()}>
                  <input
                    className="input"
                    aria-label={`Reply to ${thread.text}`}
                    placeholder="Reply…"
                    value={drafts[thread.id] ?? ''}
                    onChange={(event) => setDrafts({ ...drafts, [thread.id]: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      replyToComment(thread.id, drafts[thread.id] ?? '');
                      setDrafts({ ...drafts, [thread.id]: '' });
                    }}
                  />
                  <button
                    type="button"
                    className="button button--compact"
                    aria-label={`Send reply to ${thread.text}`}
                    onClick={(event) => {
                      // Posting must not bubble to the row: that would collapse
                      // the thread and hide the reply that was just written.
                      event.stopPropagation();
                      replyToComment(thread.id, drafts[thread.id] ?? '');
                      setDrafts({ ...drafts, [thread.id]: '' });
                    }}
                  >
                    Reply
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
