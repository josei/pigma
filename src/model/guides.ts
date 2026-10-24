import type { AnyNode, PigmaFile, UserGuide } from './types';
import { absoluteBounds, findNode, updateNode } from './tree';

/**
 * Ruler guides (Figma's guides). A guide lives on a container: the page, or a frame. A frame's guides are in the
 * frame's own coordinates, so they move with it. Pure edits: each returns a new file. The store wraps them in an undo
 * step. A guide is kept by index, so moving or removing one names the position it has in its container's list.
 */

/** The guides of a container (a page or a frame), in the container's coordinates. */
export function guidesOf(file: PigmaFile, containerId: string): UserGuide[] {
  const node = findNode(file.document, containerId) as AnyNode | null;
  return (node as { guides?: UserGuide[] } | null)?.guides ?? [];
}

/**
 * The container the guide tools act on: the selected frame when exactly one frame is selected, otherwise the page.
 * Only this container's guides are shown and snapped to (frame guides).
 */
export function activeGuideContainer(file: PigmaFile, pageId: string, selection: readonly string[]): string {
  const [only] = selection;
  if (selection.length !== 1 || !only) return pageId;
  const node = findNode(file.document, only);
  return node?.type === 'FRAME' ? only : pageId;
}

function setGuides(file: PigmaFile, containerId: string, guides: UserGuide[]): PigmaFile {
  return {
    ...file,
    lastModified: Date.now(),
    document: updateNode(file.document, containerId, (node) => ({ ...node, guides })) as PigmaFile['document'],
  };
}

export function addGuide(file: PigmaFile, containerId: string, guide: UserGuide): PigmaFile {
  return setGuides(file, containerId, [...guidesOf(file, containerId), guide]);
}

export function moveGuide(file: PigmaFile, containerId: string, index: number, offset: number): PigmaFile {
  const guides = guidesOf(file, containerId);
  if (index < 0 || index >= guides.length) return file;
  return setGuides(file, containerId, guides.map((guide, position) => (position === index ? { ...guide, offset } : guide)));
}

export function removeGuide(file: PigmaFile, containerId: string, index: number): PigmaFile {
  const guides = guidesOf(file, containerId);
  if (index < 0 || index >= guides.length) return file;
  return setGuides(file, containerId, guides.filter((_, position) => position !== index));
}

/** The offsets of a container's guides on one axis, in the container's coordinates, for snapping. */
export function guideOffsets(file: PigmaFile, containerId: string, axis: 'x' | 'y'): number[] {
  return guidesOf(file, containerId)
    .filter((guide) => guide.axis === axis)
    .map((guide) => guide.offset);
}

/** Where a container's own coordinates start on the page: a frame's top-left, or the page's origin. */
export function guideOriginOf(file: PigmaFile, containerId: string): { x: number; y: number } {
  if (findNode(file.document, containerId)?.type !== 'FRAME') return { x: 0, y: 0 };
  const bounds = absoluteBounds(file.document, containerId);
  return bounds ? { x: bounds.x, y: bounds.y } : { x: 0, y: 0 };
}
