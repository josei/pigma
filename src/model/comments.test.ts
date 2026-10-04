import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTHOR,
  addComment,
  addReply,
  commentSummary,
  commentsForPage,
  commentsOf,
  deleteComment,
  moveComment,
  openCommentCount,
  setCommentResolved,
} from './comments';
import { emptyFile } from './validate';
import { parseFile, serializeFile } from './serialize';

describe('comments', () => {
  it('adds threads with a pin position and author', () => {
    const file = emptyFile('Comments');
    const pageId = file.document.children[0]!.id;
    const created = addComment(file, { pageId, x: 120.456, y: 80, text: '  Tighten this  ' });
    expect(created.commentId).toBeTruthy();
    const thread = commentsOf(created.file)[0]!;
    expect(thread).toMatchObject({ pageId, x: 120.46, y: 80, text: 'Tighten this', author: DEFAULT_AUTHOR, resolved: false });
    expect(thread.replies).toEqual([]);
    expect(openCommentCount(created.file)).toBe(1);
    expect(commentsForPage(created.file, pageId)).toHaveLength(1);
    expect(commentsForPage(created.file, 'other')).toHaveLength(0);
    // Empty comments are refused.
    expect(addComment(file, { pageId, x: 0, y: 0, text: '   ' }).commentId).toBeNull();
  });

  it('threads replies and reopens a resolved thread', () => {
    const file = emptyFile('Comments');
    const pageId = file.document.children[0]!.id;
    const created = addComment(file, { pageId, x: 10, y: 10, text: 'First' });
    const withReply = addReply(created.file, created.commentId!, 'Agreed');
    const thread = commentsOf(withReply)[0]!;
    expect(thread.replies).toHaveLength(1);
    expect(thread.replies[0]).toMatchObject({ text: 'Agreed', author: DEFAULT_AUTHOR });
    expect(commentSummary(thread)).toContain('(+1)');
    expect(addReply(withReply, created.commentId!, '   ').comments).toBe(withReply.comments);

    const resolved = setCommentResolved(withReply, created.commentId!, true);
    expect(openCommentCount(resolved)).toBe(0);
    const reopened = addReply(resolved, created.commentId!, 'One more thing');
    expect(commentsOf(reopened)[0]!.resolved).toBe(false);
    expect(openCommentCount(reopened)).toBe(1);
  });

  it('moves and deletes pins', () => {
    const file = emptyFile('Comments');
    const pageId = file.document.children[0]!.id;
    const created = addComment(file, { pageId, x: 10, y: 10, text: 'Pin' });
    const moved = moveComment(created.file, created.commentId!, 55.555, 66.666);
    expect(commentsOf(moved)[0]).toMatchObject({ x: 55.56, y: 66.67 });
    expect(commentsOf(deleteComment(moved, created.commentId!))).toEqual([]);
  });

  it('round-trips threads through JSON', () => {
    const file = emptyFile('Comments');
    const pageId = file.document.children[0]!.id;
    const created = addComment(file, { pageId, x: 5, y: 6, text: 'Persisted' });
    const withReply = addReply(created.file, created.commentId!, 'Reply');
    const restored = parseFile(serializeFile(withReply));
    expect(restored.ok).toBe(true);
    const thread = commentsOf(restored.file!)[0]!;
    expect(thread.text).toBe('Persisted');
    expect(thread.replies).toHaveLength(1);
    expect(thread.x).toBe(5);
  });
});
