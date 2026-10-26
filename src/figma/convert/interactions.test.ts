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
import { actionOfKind, prototypeDestinations } from '../../model/prototype';
import { emptyFile } from '../../model/validate';
import { createFrameNode, createRectNode } from '../../model/factory';

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
    for (const navigation of ['NAVIGATE', 'SWAP', 'OVERLAY', 'SWAP_STATE'] as const) {
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

  it('maps the REST name CHANGE_TO onto the native SWAP_STATE', () => {
    // The round-74 withdrawal was made against the REST vocabulary; the native
    // wire calls this SWAP_STATE and carries the destination as a GUID, which is
    // what the model's destinationId holds. Recovered, not reported.
    const { interactions, report } = mapped('CHANGE_TO');
    expect(report.unsupported).toEqual([]);
    expect(interactions[0]!.actions[0]!.navigation).toBe('SWAP_STATE');
  });

  it('keeps the native SWAP_STATE name as-is', () => {
    const { interactions, report } = mapped('SWAP_STATE');
    expect(report.unsupported).toEqual([]);
    expect(interactions[0]!.actions[0]!.navigation).toBe('SWAP_STATE');
  });

  it('keeps a sequence whose middle action is a variant swap', () => {
    // A trigger with three actions, the middle one a variant swap: ALL THREE
    // survive, in order. Before the reversal the middle one was dropped, which
    // made a navigate-swap-open sequence play the first and last only.
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
    expect(interactions[0]!.actions.map((action) => action.type)).toEqual(['NODE', 'NODE', 'URL']);
    expect(interactions[0]!.actions[0]!.destinationId).toBe('dest:1');
    expect(interactions[0]!.actions[1]!.navigation).toBe('SWAP_STATE');
    expect(interactions[0]!.actions[1]!.destinationId).toBe('dest:2');
    expect(report.unsupported).toEqual([]);
  });

  it('keeps an action whose navigation is absent', () => {
    const { interactions, report } = mapped(undefined);
    expect(interactions).toHaveLength(1);
    expect(interactions[0]!.actions[0]!.navigation).toBeUndefined();
    expect(report.unsupported).toEqual([]);
  });
});

describe('SWAP_STATE playback swaps in place', () => {
  it('changes the instance variant without navigating', () => {
    const store = useEditor.getState();
    const file = emptyFile('Swap state');
    const page = file.document.children[0]!;
    // Two variant components and an instance of the first.
    const first = { ...createRectNode(file.document, 0, 0, 100, 50), type: 'COMPONENT' as const, name: 'State=Default' };
    const second = { ...createRectNode(file.document, 0, 0, 100, 50), type: 'COMPONENT' as const, name: 'State=Hover' };
    const instance = {
      id: 'inst:swap', name: 'Instance', type: 'INSTANCE' as const, visible: true, locked: false, opacity: 1,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, width: 100, height: 50, fills: [], strokes: [], children: [], componentId: first.id,
    };
    page.children = [first, second, instance] as never;
    store.loadFile({ ...file, document: { ...file.document, children: [page] } } as never);
    store.setPresentation(true, page.id);
    const stackBefore = useEditor.getState().presentationStack.length;
    const frameBefore = useEditor.getState().presentationFrameId;

    useEditor.getState().swapInstanceState('inst:swap', second.id);
    const instanceAfter = useEditor.getState().file.document.children[0]!.children.find((c) => c.id === 'inst:swap') as { componentId: string };
    expect(instanceAfter.componentId, 'the instance did not swap to the target variant').toBe(second.id);
    // In place: the presented frame and the stack are untouched, so Back still
    // returns to whatever preceded the frame holding the instance.
    expect(useEditor.getState().presentationFrameId).toBe(frameBefore);
    expect(useEditor.getState().presentationStack.length).toBe(stackBefore);
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

describe('the REST map lists the native vocabulary too', () => {
  it('maps DRAG, MOUSE_IN and MOUSE_OUT', () => {
    for (const [native, expected] of [['DRAG', 'ON_DRAG'], ['MOUSE_IN', 'MOUSE_ENTER'], ['MOUSE_OUT', 'MOUSE_LEAVE']] as const) {
      const report = new ReportBuilder();
      const interactions = mapRestInteractions(
        [{ trigger: { type: native }, actions: [{ type: 'NODE', destinationId: 'dest:1' }] }] as never,
        { report, nodeId: 'n:1', path: 'page/0' },
      )!;
      expect(interactions, `${native} must map`).toHaveLength(1);
      expect(interactions[0]!.trigger.type, `${native} -> ${expected}`).toBe(expected);
      expect(report.unsupported, `${native} must not be reported`).toEqual([]);
    }
  });

  it('maps the REST connectionType INTERNAL_NODE onto NODE', () => {
    const report = new ReportBuilder();
    const interactions = mapRestInteractions(
      [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', connectionType: 'INTERNAL_NODE', destinationId: 'dest:1' }] }] as never,
      { report, nodeId: 'n:1', path: 'page/0' },
    )!;
    expect(interactions[0]!.actions[0]!.type).toBe('NODE');
    expect(report.unsupported).toEqual([]);
  });
});

describe('a swap action can be AUTHORED, not only imported', () => {
  it('offers the kind, and builds an action that plays back in place', () => {
    // The kind exists in the model's own vocabulary now.
    const action = actionOfKind('SWAP_STATE', 'variant:2');
    expect(action.navigation).toBe('SWAP_STATE');
    expect(action.destinationId).toBe('variant:2');
    expect(action.overlay).toBeUndefined();
  });

  it('offers a component set’s variants as destinations, grouped by set', () => {
    const file = emptyFile('Picker');
    const page = file.document.children[0]!;
    const plain = createFrameNode(file.document, 0, 0, 100, 100);
    plain.name = 'Plain frame';
    const variantA = { ...createRectNode(file.document, 0, 0, 50, 50), type: 'COMPONENT' as const, name: 'State=Default' };
    const variantB = { ...createRectNode(file.document, 0, 0, 50, 50), type: 'COMPONENT' as const, name: 'State=Hover' };
    const set = { ...createRectNode(file.document, 0, 0, 50, 50), type: 'COMPONENT_SET' as const, name: 'Button', children: [variantA, variantB] };
    page.children = [plain, set] as never;
    const destinations = prototypeDestinations(file, page.id);
    expect(destinations.map((entry) => entry.id)).toContain(plain.id);
    // The variants are offered, grouped by the set's name.
    const variants = destinations.filter((entry) => entry.group === 'Button');
    expect(variants.map((entry) => entry.name).sort()).toEqual(['State=Default', 'State=Hover']);
    expect(variants.every((entry) => entry.group === 'Button')).toBe(true);
  });
});
