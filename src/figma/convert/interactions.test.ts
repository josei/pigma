/**
 * Prototype navigation, imported and played.
 *
 * Figma sends five navigation members. Playback honours three — NAVIGATE pushes
 * the frame, SWAP replaces it in place, OVERLAY opens it over the current one —
 * and the other two (SCROLL_TO, CHANGE_TO) have no expressible target here: a
 * scroll offset, and a variant property set. They are NOT members of the model's
 * union, and the importer REPORTS them and drops the action, because mapping them
 * onto a frame navigation would play something else without saying so.
 *
 * This file pins both halves: what import does with each member, and that SWAP's
 * playback really differs from NAVIGATE's (the stack, not the frame).
 */
import { describe, expect, it } from 'vitest';
import { mapRestInteractions } from './mappers';
import { ReportBuilder } from './report';
import { useEditor } from '../../store/editorStore';
import { emptyFile } from '../../model/validate';

/** One Figma interaction with a single NODE action carrying `navigation`. */
function interaction(navigation: string | undefined, destinationId = 'dest:1') {
  return [
    {
      trigger: { type: 'ON_CLICK' },
      actions: [{ type: 'NODE', destinationId, ...(navigation === undefined ? {} : { navigation }) }],
    },
  ] as never;
}

function mapped(navigation: string | undefined) {
  const report = new ReportBuilder();
  const interactions = mapRestInteractions(interaction(navigation), { report, nodeId: 'n:1', path: 'page/0' });
  return { interactions: interactions ?? [], report };
}

describe('prototype navigation on import', () => {
  it('keeps the three members playback honours, and sets overlay for OVERLAY', () => {
    for (const navigation of ['NAVIGATE', 'SWAP', 'OVERLAY'] as const) {
      const { interactions, report } = mapped(navigation);
      expect(interactions, `${navigation} must be kept`).toHaveLength(1);
      const action = interactions[0]!.actions[0]!;
      expect(action.navigation).toBe(navigation);
      expect(action.destinationId).toBe('dest:1');
      // Playback branches on `overlay`, so an imported OVERLAY must set it or the
      // action would navigate instead of overlaying.
      expect(action.overlay === true, `${navigation} overlay flag`).toBe(navigation === 'OVERLAY');
      expect(report.unsupported, `${navigation} must not be reported`).toEqual([]);
    }
  });

  it('reports SCROLL_TO and drops the action, instead of navigating', () => {
    const { interactions, report } = mapped('SCROLL_TO');
    expect(report.unsupported.map((item) => item.feature)).toEqual(['navigation:SCROLL_TO']);
    // The action is gone: nothing plays in its place.
    expect(interactions, 'a withdrawn member must not become a navigation').toEqual([]);
  });

  it('reports CHANGE_TO and drops the action', () => {
    const { interactions, report } = mapped('CHANGE_TO');
    expect(report.unsupported.map((item) => item.feature)).toEqual(['navigation:CHANGE_TO']);
    expect(interactions).toEqual([]);
  });

  it('keeps the other actions of a sequence whose middle member was withdrawn', () => {
    // A trigger with three actions, the middle one unsupported: the two that ARE
    // supported survive, in order, and the unsupported one is reported — it does
    // not silently become a frame navigation in the middle of the sequence.
    const report = new ReportBuilder();
    const interactions = mapRestInteractions(
      [
        {
          trigger: { type: 'ON_CLICK' },
          actions: [
            { type: 'NODE', destinationId: 'dest:1', navigation: 'NAVIGATE' },
            { type: 'NODE', destinationId: 'dest:2', navigation: 'CHANGE_TO' },
            { type: 'URL', url: 'https://example.com' },
          ],
        },
      ] as never,
      { report, nodeId: 'n:1', path: 'page/0' },
    )!;
    expect(interactions[0]!.actions.map((action) => action.type)).toEqual(['NODE', 'URL']);
    expect(interactions[0]!.actions[0]!.destinationId).toBe('dest:1');
    expect(report.unsupported.map((item) => item.feature)).toEqual(['navigation:CHANGE_TO']);
  });

  it('keeps an action whose navigation is absent', () => {
    const { interactions, report } = mapped(undefined);
    expect(interactions).toHaveLength(1);
    expect(interactions[0]!.actions[0]!.navigation).toBeUndefined();
    expect(report.unsupported).toEqual([]);
  });
});

describe('SWAP playback differs from NAVIGATE', () => {
  const store = () => useEditor.getState();

  it('replaces the presented frame instead of pushing it', () => {
    store().loadFile(emptyFile('Swap'));
    const page = store().file.document.children[0]!;
    store().setPresentation(true, page.id);
    // Start on A, navigate to B: the stack remembers A.
    store().navigatePrototype('frame-b');
    expect(store().presentationFrameId).toBe('frame-b');
    expect(store().presentationStack).toEqual([page.id]);

    // SWAP to C: C is presented, and the stack does NOT grow — so Back returns to
    // A, skipping B, which is what Figma's SWAP means.
    store().swapPrototype('frame-c');
    expect(store().presentationFrameId).toBe('frame-c');
    expect(store().presentationStack, 'SWAP must not push the frame it replaced').toEqual([page.id]);

    store().prototypeBack();
    expect(store().presentationFrameId).toBe(page.id);

    // NAVIGATE from A to B pushes, for contrast.
    store().navigatePrototype('frame-b');
    expect(store().presentationStack).toEqual([page.id]);
    store().navigatePrototype('frame-c');
    expect(store().presentationStack, 'NAVIGATE pushes').toEqual([page.id, 'frame-b']);
  });
});
