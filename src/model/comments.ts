import type { CommentThread, PigmaFile } from './types';
import { nextNodeId } from './ids';

/**
 * Comment threads (M13).
 *
 * A thread is a pin at a world-space position on a page, optionally attached to
 * a layer, with a list of replies and a resolved flag. Threads live in the file,
 * so they persist and travel with exports like any other document data.
 */

export const DEFAULT_AUTHOR = 'You';

export function commentsOf(file: PigmaFile): CommentThread[] {
  return file.comments ?? [];
}

export function commentsForPage(file: PigmaFile, pageId: string): CommentThread[] {
  return commentsOf(file).filter((thread) => thread.pageId === pageId);
}

export function openCommentCount(file: PigmaFile): number {
  return commentsOf(file).filter((thread) => !thread.resolved).length;
}

export function addComment(
  file: PigmaFile,
  input: { pageId: string; x: number; y: number; text: string; nodeId?: string | null; author?: string },
): { file: PigmaFile; commentId: string | null } {
  if (input.text.trim() === '') return { file, commentId: null };
  const thread: CommentThread = {
    id: nextNodeId(),
    pageId: input.pageId,
    x: Math.round(input.x * 100) / 100,
    y: Math.round(input.y * 100) / 100,
    nodeId: input.nodeId ?? null,
    author: input.author?.trim() || DEFAULT_AUTHOR,
    text: input.text.trim(),
    createdAt: Date.now(),
    resolved: false,
    replies: [],
  };
  return { file: { ...file, comments: [...commentsOf(file), thread] }, commentId: thread.id };
}

export function addReply(
  file: PigmaFile,
  commentId: string,
  text: string,
  author = DEFAULT_AUTHOR,
): PigmaFile {
  if (text.trim() === '') return file;
  return {
    ...file,
    comments: commentsOf(file).map((thread) =>
      thread.id === commentId
        ? {
            ...thread,
            resolved: false,
            replies: [...thread.replies, { id: nextNodeId(), author: author.trim() || DEFAULT_AUTHOR, text: text.trim(), createdAt: Date.now() }],
          }
        : thread,
    ),
  };
}

export function setCommentResolved(file: PigmaFile, commentId: string, resolved: boolean): PigmaFile {
  return {
    ...file,
    comments: commentsOf(file).map((thread) => (thread.id === commentId ? { ...thread, resolved } : thread)),
  };
}

export function deleteComment(file: PigmaFile, commentId: string): PigmaFile {
  return { ...file, comments: commentsOf(file).filter((thread) => thread.id !== commentId) };
}

/** Move a pin (dragging it on the canvas). */
export function moveComment(file: PigmaFile, commentId: string, x: number, y: number): PigmaFile {
  return {
    ...file,
    comments: commentsOf(file).map((thread) =>
      thread.id === commentId ? { ...thread, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 } : thread,
    ),
  };
}

export function commentSummary(thread: CommentThread): string {
  const replies = thread.replies.length;
  return `${thread.author}: ${thread.text}${replies > 0 ? ` (+${replies})` : ''}`;
}
