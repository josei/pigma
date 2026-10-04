import { describe, expect, it } from 'vitest';
import {
  TRIGGERS,
  actionLabel,
  addFlow,
  addInteraction,
  defaultInteraction,
  flowsOf,
  interactionsOf,
  prototypeDestinations,
  reachableFrom,
  removeFlow,
  removeInteraction,
  renameFlow,
  triggerLabel,
  updateInteraction,
} from './prototype';
import { createFrameNode, createRectNode } from './factory';
import { emptyFile } from './validate';
import { findNode } from './tree';
import { parseFile, serializeFile } from './serialize';
import type { SceneNode } from './types';

function setup() {
  const file = emptyFile('Prototype');
  const page = file.document.children[0]!;
  const home = createFrameNode(null, 0, 0, 400, 300, { name: 'Home' });
  const details = createFrameNode(null, 500, 0, 400, 300, { name: 'Details' });
  const overlay = createFrameNode(null, 1000, 0, 200, 150, { name: 'Menu' });
  const button = createRectNode(null, 20, 20, 120, 40);
  home.children = [button];
  page.children = [home, details, overlay];
  return { file, pageId: page.id, homeId: home.id, detailsId: details.id, overlayId: overlay.id, buttonId: button.id };
}

describe('prototyping', () => {
  it('supports several interactions per node', () => {
    const { file, buttonId, detailsId, overlayId } = setup();
    let next = addInteraction(file, buttonId, defaultInteraction(detailsId));
    next = addInteraction(next, buttonId, {
      trigger: { type: 'ON_HOVER' },
      actions: [{ type: 'NODE', destinationId: overlayId, overlay: true }],
    });
    next = addInteraction(next, buttonId, { trigger: { type: 'ON_DRAG' }, actions: [{ type: 'BACK' }] });

    const list = interactionsOf(findNode(next.document, buttonId)!);
    expect(list).toHaveLength(3);
    expect(list.map((entry) => entry.trigger.type)).toEqual(['ON_CLICK', 'ON_HOVER', 'ON_DRAG']);
    expect(list[1]!.actions[0]).toMatchObject({ type: 'NODE', overlay: true });

    const updated = updateInteraction(next, buttonId, 0, { trigger: { type: 'ON_DRAG' } });
    expect(interactionsOf(findNode(updated.document, buttonId)!)[0]!.trigger.type).toBe('ON_DRAG');

    const removed = removeInteraction(updated, buttonId, 0);
    expect(interactionsOf(findNode(removed.document, buttonId)!)).toHaveLength(2);
    expect(TRIGGERS).toHaveLength(3);
    expect(triggerLabel('ON_HOVER')).toBe('On hover');
  });

  it('labels every action kind', () => {
    expect(actionLabel({ type: 'NODE', destinationId: 'x' })).toBe('Navigate to');
    expect(actionLabel({ type: 'NODE', destinationId: 'x', overlay: true })).toBe('Open overlay');
    expect(actionLabel({ type: 'BACK' })).toBe('Back');
    expect(actionLabel({ type: 'CLOSE' })).toBe('Close');
    expect(actionLabel({ type: 'URL', url: 'https://example.com' })).toBe('Open URL');
  });

  it('lists prototype destinations from the page', () => {
    const { file, pageId } = setup();
    expect(prototypeDestinations(file, pageId).map((entry) => entry.name)).toEqual(['Home', 'Details', 'Menu']);
  });

  it('manages per-page flows', () => {
    const { file, pageId, homeId, detailsId } = setup();
    const created = addFlow(file, pageId, homeId, 'Signup');
    expect(created.flowId).toBeTruthy();
    const page = created.file.document.children[0]!;
    expect(flowsOf(page)).toHaveLength(1);
    expect(flowsOf(page)[0]).toMatchObject({ name: 'Signup', startNodeId: homeId });

    // A second flow can start anywhere else.
    const second = addFlow(created.file, pageId, detailsId);
    expect(flowsOf(second.file.document.children[0]!).map((flow) => flow.name)).toEqual(['Signup', 'Flow 2']);

    const renamed = renameFlow(second.file, pageId, created.flowId!, 'Onboarding');
    expect(flowsOf(renamed.document.children[0]!)[0]!.name).toBe('Onboarding');
    expect(renameFlow(renamed, pageId, created.flowId!, '  ').document).toBe(renamed.document);

    const removed = removeFlow(renamed, pageId, created.flowId!);
    expect(flowsOf(removed.document.children[0]!)).toHaveLength(1);

    // Flows need a frame to start at.
    expect(addFlow(file, pageId, 'nope').flowId).toBeNull();
  });

  it('walks the reachable frames from a start frame', () => {
    const { file, homeId, detailsId, buttonId } = setup();
    const withLink = addInteraction(file, buttonId, defaultInteraction(detailsId));
    const reachable = reachableFrom(withLink, homeId);
    // Links live on nested layers, so the walk has to descend to find them; the
    // result is the set of reachable *frames*, not every descendant.
    expect(reachable).toContain(homeId);
    expect(reachable).toContain(detailsId);
    expect(reachable).not.toContain(buttonId);
    expect(reachable).toHaveLength(2);
  });

  it('round-trips interactions and flows through JSON', () => {
    const { file, pageId, homeId, detailsId, buttonId } = setup();
    const withFlow = addFlow(file, pageId, homeId, 'Main');
    const withLink = addInteraction(withFlow.file, buttonId, {
      trigger: { type: 'ON_HOVER' },
      actions: [{ type: 'NODE', destinationId: detailsId, overlay: true, navigation: 'OVERLAY' }],
    });
    const restored = parseFile(serializeFile(withLink));
    expect(restored.ok).toBe(true);
    const page = restored.file!.document.children[0]!;
    expect(flowsOf(page)).toHaveLength(1);
    const button = findNode(restored.file!.document, buttonId) as SceneNode;
    expect(interactionsOf(button)[0]).toMatchObject({ trigger: { type: 'ON_HOVER' } });
    expect(interactionsOf(button)[0]!.actions[0]).toMatchObject({ overlay: true });
  });
});

describe('defaultInteraction', () => {
  it('seeds a smart-animate transition when the quick link asks for one', () => {
    const plain = defaultInteraction('frame:2');
    expect(plain.actions[0]!.transition).toBeUndefined();

    const animated = defaultInteraction('frame:2', 'NAVIGATE', { type: 'SMART_ANIMATE', duration: 900 });
    expect(animated.trigger.type).toBe('ON_CLICK');
    expect(animated.actions[0]).toMatchObject({
      type: 'NODE',
      destinationId: 'frame:2',
      transition: { type: 'SMART_ANIMATE', duration: 900 },
    });
  });
});
