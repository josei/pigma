import { describe, expect, it } from 'vitest';
import { addPageGuide, guideOffsets, movePageGuide, pageGuides, removePageGuide } from './guides';
import { emptyFile, validatePigmaFile } from './validate';

function fileWithPage() {
  const file = emptyFile('Guides');
  return { file, pageId: file.document.children[0]!.id };
}

describe('page guides', () => {
  it('adds a guide to a page, with its axis and offset', () => {
    const { file, pageId } = fileWithPage();
    const next = addPageGuide(file, pageId, { axis: 'x', offset: 120 });
    expect(pageGuides(next, pageId)).toEqual([{ axis: 'x', offset: 120 }]);
  });

  it('moves and removes a guide by its index, and ignores an index that is not there', () => {
    const { file, pageId } = fileWithPage();
    let next = addPageGuide(file, pageId, { axis: 'x', offset: 10 });
    next = addPageGuide(next, pageId, { axis: 'y', offset: 20 });
    next = movePageGuide(next, pageId, 1, 35);
    expect(pageGuides(next, pageId)).toEqual([{ axis: 'x', offset: 10 }, { axis: 'y', offset: 35 }]);
    expect(movePageGuide(next, pageId, 5, 1)).toBe(next);
    next = removePageGuide(next, pageId, 0);
    expect(pageGuides(next, pageId)).toEqual([{ axis: 'y', offset: 35 }]);
    expect(removePageGuide(next, pageId, 9)).toBe(next);
  });

  it('lists the offsets on one axis for snapping', () => {
    const { file, pageId } = fileWithPage();
    let next = addPageGuide(file, pageId, { axis: 'x', offset: 10 });
    next = addPageGuide(next, pageId, { axis: 'y', offset: 20 });
    next = addPageGuide(next, pageId, { axis: 'x', offset: 90 });
    expect(guideOffsets(next, pageId, 'x')).toEqual([10, 90]);
    expect(guideOffsets(next, pageId, 'y')).toEqual([20]);
  });

  it('keeps guides when a file is validated and reloaded, and drops a non-finite offset to 0', () => {
    const { file, pageId } = fileWithPage();
    const next = addPageGuide(file, pageId, { axis: 'y', offset: 44 });
    const reloaded = validatePigmaFile(JSON.parse(JSON.stringify(next)));
    expect(pageGuides(reloaded.file!, pageId)).toEqual([{ axis: 'y', offset: 44 }]);
    const broken = JSON.parse(JSON.stringify(next));
    broken.document.children[0].guides = [{ axis: 'x', offset: 'far' }];
    expect(pageGuides(validatePigmaFile(broken).file!, pageId)).toEqual([{ axis: 'x', offset: 0 }]);
  });
});
