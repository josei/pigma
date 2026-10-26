import { describe, expect, it } from 'vitest';
import { activeGuideContainer, addGuide, guideOffsets, guideOriginOf, moveGuide, guidesOf, removeGuide } from './guides';
import { emptyFile, validatePigmaFile } from './validate';
import { createFrameNode } from './factory';

function fileWithPage() {
  const file = emptyFile('Guides');
  return { file, pageId: file.document.children[0]!.id };
}

describe('page guides', () => {
  it('adds a guide to a page, with its axis and offset', () => {
    const { file, pageId } = fileWithPage();
    const next = addGuide(file, pageId, { axis: 'x', offset: 120 });
    expect(guidesOf(next, pageId)).toEqual([{ axis: 'x', offset: 120 }]);
  });

  it('moves and removes a guide by its index, and ignores an index that is not there', () => {
    const { file, pageId } = fileWithPage();
    let next = addGuide(file, pageId, { axis: 'x', offset: 10 });
    next = addGuide(next, pageId, { axis: 'y', offset: 20 });
    next = moveGuide(next, pageId, 1, 35);
    expect(guidesOf(next, pageId)).toEqual([{ axis: 'x', offset: 10 }, { axis: 'y', offset: 35 }]);
    expect(moveGuide(next, pageId, 5, 1)).toBe(next);
    next = removeGuide(next, pageId, 0);
    expect(guidesOf(next, pageId)).toEqual([{ axis: 'y', offset: 35 }]);
    expect(removeGuide(next, pageId, 9)).toBe(next);
  });

  it('lists the offsets on one axis for snapping', () => {
    const { file, pageId } = fileWithPage();
    let next = addGuide(file, pageId, { axis: 'x', offset: 10 });
    next = addGuide(next, pageId, { axis: 'y', offset: 20 });
    next = addGuide(next, pageId, { axis: 'x', offset: 90 });
    expect(guideOffsets(next, pageId, 'x')).toEqual([10, 90]);
    expect(guideOffsets(next, pageId, 'y')).toEqual([20]);
  });

  it('keeps guides when a file is validated and reloaded, and drops a non-finite offset to 0', () => {
    const { file, pageId } = fileWithPage();
    const next = addGuide(file, pageId, { axis: 'y', offset: 44 });
    const reloaded = validatePigmaFile(JSON.parse(JSON.stringify(next)));
    expect(guidesOf(reloaded.file!, pageId)).toEqual([{ axis: 'y', offset: 44 }]);
    const broken = JSON.parse(JSON.stringify(next));
    broken.document.children[0].guides = [{ axis: 'x', offset: 'far' }];
    expect(guidesOf(validatePigmaFile(broken).file!, pageId)).toEqual([{ axis: 'x', offset: 0 }]);
  });
});

describe('frame guides', () => {
  it('a frame guide is in the frame\'s coordinates, and the active container is the one selected frame', () => {
    const file = emptyFile('Frames');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 100, 50, 200, 120);
    page.children = [frame];
    expect(activeGuideContainer(file, page.id, [frame.id])).toBe(frame.id);
    expect(activeGuideContainer(file, page.id, [frame.id, 'other'])).toBe(page.id);
    expect(activeGuideContainer(file, page.id, [])).toBe(page.id);
    const next = addGuide(file, frame.id, { axis: 'y', offset: 30 });
    expect(guidesOf(next, frame.id)).toEqual([{ axis: 'y', offset: 30 }]);
    expect(guidesOf(next, page.id)).toEqual([]);
  });

  it('a frame\'s origin is its top-left on the page, and the page\'s origin is zero', () => {
    const file = emptyFile('Origin');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 100, 50, 200, 120);
    page.children = [frame];
    expect(guideOriginOf(file, frame.id)).toEqual({ x: 100, y: 50 });
    expect(guideOriginOf(file, page.id)).toEqual({ x: 0, y: 0 });
  });
});
