import type { PigmaFile, UserGuide } from './types';
import { updateNode } from './tree';

/**
 * Ruler guides on a page (Figma's guides). Pure edits: each returns a new file. The store wraps them in an undo
 * step. A guide is kept by index, so moving or removing one names the position it has in the page's list.
 */

export function pageGuides(file: PigmaFile, pageId: string): UserGuide[] {
  return file.document.children.find((child) => child.id === pageId)?.guides ?? [];
}

function setGuides(file: PigmaFile, pageId: string, guides: UserGuide[]): PigmaFile {
  return {
    ...file,
    lastModified: Date.now(),
    document: updateNode(file.document, pageId, (node) => ({ ...node, guides })) as PigmaFile['document'],
  };
}

export function addPageGuide(file: PigmaFile, pageId: string, guide: UserGuide): PigmaFile {
  return setGuides(file, pageId, [...pageGuides(file, pageId), guide]);
}

export function movePageGuide(file: PigmaFile, pageId: string, index: number, offset: number): PigmaFile {
  const guides = pageGuides(file, pageId);
  if (index < 0 || index >= guides.length) return file;
  return setGuides(file, pageId, guides.map((guide, position) => (position === index ? { ...guide, offset } : guide)));
}

export function removePageGuide(file: PigmaFile, pageId: string, index: number): PigmaFile {
  const guides = pageGuides(file, pageId);
  if (index < 0 || index >= guides.length) return file;
  return setGuides(file, pageId, guides.filter((_, position) => position !== index));
}

/** The offsets of the page's guides on one axis, for snapping. */
export function guideOffsets(file: PigmaFile, pageId: string, axis: 'x' | 'y'): number[] {
  return pageGuides(file, pageId)
    .filter((guide) => guide.axis === axis)
    .map((guide) => guide.offset);
}
