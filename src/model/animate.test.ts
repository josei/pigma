import { describe, expect, it } from 'vitest';
import { SMART_ANIMATE_DEFAULT, contentSize, matrixChanged, planSmartAnimate } from './animate';
import { createFrameNode, createRectNode } from './factory';
import { emptyFile } from './validate';
import { parseFile, serializeFile } from './serialize';
import type { SceneNode } from './types';

function setup() {
  const file = emptyFile('Animate');
  const page = file.document.children[0]!;
  const home = createFrameNode(null, 0, 0, 400, 300, { name: 'Home' });
  const hero = createRectNode(null, 20, 20, 120, 80);
  hero.name = 'Hero';
  const extra = createRectNode(null, 200, 20, 60, 60);
  extra.name = 'Only here';
  home.children = [hero, extra];

  const details = createFrameNode(null, 500, 0, 400, 300, { name: 'Details' });
  const heroMoved = createRectNode(null, 180, 140, 200, 120);
  heroMoved.name = 'Hero';
  details.children = [heroMoved];
  page.children = [home, details];
  return { file, homeId: home.id, detailsId: details.id, heroId: hero.id, movedHeroId: heroMoved.id };
}

describe('smart animate', () => {
  it('only matches the frames direct children', () => {
    const { file, homeId, detailsId } = setup();
    const details = file.document.children[0]!.children[1] as SceneNode;
    const nested = createRectNode(null, 5, 5, 10, 10);
    nested.name = 'Hero';
    ((details as SceneNode & { children: SceneNode[] }).children[0] as SceneNode & { children: SceneNode[] }).children = [nested];
    const plan = planSmartAnimate(file, homeId, detailsId);
    expect(plan.matches.map((m) => m.toId)).not.toContain(nested.id);
  });

  it('matches layers by name and type across frames', () => {
    const { file, homeId, detailsId, heroId, movedHeroId } = setup();
    const plan = planSmartAnimate(file, homeId, detailsId);
    expect(plan.matches).toHaveLength(1);
    const match = plan.matches[0]!;
    expect(match.fromId).toBe(heroId);
    expect(match.toId).toBe(movedHeroId);
    // Absolute positions come from the document, relative ones from the frames.
    expect(match.fromMatrix.tx).toBe(20);
    expect(match.toMatrix.tx).toBe(680);
    // Both are expressed inside the destination frame (which sits at x=500).
    expect(match.fromRelative.tx).toBe(-480);
    expect(match.toRelative.tx).toBe(180);
    expect(plan.duration).toBe(SMART_ANIMATE_DEFAULT.duration);
  });

  it('honours a custom duration and easing', () => {
    const { file, homeId, detailsId } = setup();
    const plan = planSmartAnimate(file, homeId, detailsId, { duration: 500, easing: 'linear' });
    expect(plan).toMatchObject({ duration: 500, easing: 'linear' });
  });

  it('ignores frames that are the same or missing', () => {
    const { file, homeId } = setup();
    expect(planSmartAnimate(file, homeId, homeId).matches).toEqual([]);
    expect(planSmartAnimate(file, homeId, 'nope').matches).toEqual([]);
  });

  it('detects whether a matrix actually changed', () => {
    const { file, homeId, detailsId } = setup();
    const match = planSmartAnimate(file, homeId, detailsId).matches[0]!;
    expect(matrixChanged(match.fromMatrix, match.toMatrix)).toBe(true);
    expect(matrixChanged(match.toMatrix, match.toMatrix)).toBe(false);
  });

  it('measures the scrollable content size of a frame', () => {
    const { file, homeId } = setup();
    const frame = file.document.children[0]!.children[0] as SceneNode;
    // The child at (200,20) 60x60 stays inside the 400x300 frame, so the frame wins.
    expect(contentSize(frame)).toEqual({ width: 400, height: 300 });

    const tall = createFrameNode(null, 0, 0, 200, 200, { name: 'Tall' });
    const long = createRectNode(null, 0, 0, 200, 900);
    tall.children = [long];
    expect(contentSize(tall)).toEqual({ width: 200, height: 900 });
    void homeId;
  });

  it('keeps the scroll setting and the transition through JSON', () => {
    const { file, homeId } = setup();
    const page = file.document.children[0]!;
    const scroller: SceneNode = { ...(page.children[0] as SceneNode), overflowDirection: 'VERTICAL_SCROLLING' } as SceneNode;
    const linked: SceneNode = {
      ...(page.children[0] as SceneNode),
      interactions: [
        { trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: page.children[1]!.id, transition: { type: 'SMART_ANIMATE', duration: 250 } }] },
      ],
    };
    page.children = [scroller, linked];
    const restored = parseFile(serializeFile(file));
    expect(restored.ok).toBe(true);
    const first = restored.file!.document.children[0]!.children[0] as SceneNode & { overflowDirection?: string };
    expect(first.overflowDirection).toBe('VERTICAL_SCROLLING');
    const second = restored.file!.document.children[0]!.children[1] as SceneNode;
    expect(second.interactions?.[0]?.actions[0]?.transition).toMatchObject({ type: 'SMART_ANIMATE', duration: 250 });
    void homeId;
  });
});
