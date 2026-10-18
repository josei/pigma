/**
 * Multi-action trigger sequences.
 *
 * The model stores an ARRAY of actions per trigger, and playback used to run only
 * the first — a navigate-then-open-overlay trigger did the first thing and
 * silently nothing else. These pin the ordering rule playback now follows:
 * actions run in order, and a navigate makes its destination current for the
 * actions after it, so a following overlay opens ON THE DESTINATION. The origin
 * is no longer on screen, which is why the other reading is not implementable.
 */
import { describe, expect, it } from 'vitest';
import { actionOfKind, planActions, setVariableFromAction } from './prototype';
import { createFrameNode } from './factory';
import { emptyFile } from './validate';
import { parseFile, serializeFile } from './serialize';
import type { PrototypeAction } from './types';

describe('prototype action sequences', () => {
  it('runs a supported multi-action sequence in order', () => {
    // The sequence the audit names: navigate, then open an overlay.
    const navigate = actionOfKind('NAVIGATE', 'frame-b');
    const overlay = actionOfKind('OVERLAY', 'overlay-c');
    const plan = planActions([navigate, overlay], 'frame-a');
    expect(plan).toHaveLength(2);
    expect(plan.map((step) => step.action.type)).toEqual(['NODE', 'NODE']);
    // The navigate resolves against the frame it starts from...
    expect(plan[0]!.frameId).toBe('frame-a');
    expect(plan[0]!.action.overlay).toBeUndefined();
    // ...and the overlay against the DESTINATION, not the origin.
    expect(plan[1]!.frameId).toBe('frame-b');
    expect(plan[1]!.action.overlay).toBe(true);
  });

  it('keeps the single-action case exactly as it was', () => {
    const plan = planActions([actionOfKind('NAVIGATE', 'frame-b')], 'frame-a');
    expect(plan).toHaveLength(1);
    expect(plan[0]!.frameId).toBe('frame-a');
  });

  it('runs a URL and a CLOSE alongside a navigate', () => {
    const url: PrototypeAction = { type: 'URL', url: 'https://example.com' };
    const plan = planActions([url, actionOfKind('NAVIGATE', 'frame-b'), actionOfKind('CLOSE')], 'frame-a');
    expect(plan.map((step) => step.action.type)).toEqual(['URL', 'NODE', 'CLOSE']);
    // CLOSE applies to the destination, because the navigate came first.
    expect(plan[2]!.frameId).toBe('frame-b');
  });

  it('leaves the frame unknown after a BACK, so later steps resolve at run time', () => {
    const plan = planActions([actionOfKind('NAVIGATE', 'frame-b'), actionOfKind('BACK'), actionOfKind('OVERLAY', 'overlay-c')], 'frame-a');
    expect(plan.map((step) => step.frameId)).toEqual(['frame-a', null, null]);
  });

  it('skips an action that has no destination', () => {
    const plan = planActions([actionOfKind('NAVIGATE', null), actionOfKind('OVERLAY', 'overlay-c')], 'frame-a');
    expect(plan).toHaveLength(1);
    expect(plan[0]!.action.overlay).toBe(true);
    expect(plan[0]!.frameId).toBe('frame-a');
  });

  it('runs an empty list as nothing', () => {
    expect(planActions([], 'frame-a')).toEqual([]);
  });
});

describe('SET_VARIABLE actions', () => {
  it('stores a boolean or a number, under the variable it names', () => {
    const set = (variableValue: boolean | number) => setVariableFromAction({}, { type: 'SET_VARIABLE', variableId: 'v1', variableValue });
    expect(set(true)).toEqual({ v1: true });
    expect(set(3)).toEqual({ v1: 3 });
  });

  it('keeps the earlier values, and replaces only the variable it sets', () => {
    const values = setVariableFromAction({ a: 1 }, { type: 'SET_VARIABLE', variableId: 'b', variableValue: false });
    expect(values).toEqual({ a: 1, b: false });
    expect(setVariableFromAction(values, { type: 'SET_VARIABLE', variableId: 'a', variableValue: 2 })).toEqual({ a: 2, b: false });
  });

  it('ignores an action that names no variable, a value that is not a boolean or number, or another action', () => {
    const values = { a: 1 };
    expect(setVariableFromAction(values, { type: 'SET_VARIABLE' })).toBe(values);
    expect(setVariableFromAction(values, { type: 'SET_VARIABLE', variableId: 'a', variableValue: 'text' as unknown as number })).toBe(values);
    expect(setVariableFromAction(values, { type: 'BACK' })).toBe(values);
  });

  it('keeps its place in the order of a trigger, and does not move the frame', () => {
    const set: PrototypeAction = { type: 'SET_VARIABLE', variableId: 'v', variableValue: true };
    const steps = planActions([set, { type: 'NODE', destinationId: 'next', navigation: 'NAVIGATE' }], 'start');
    expect(steps.map((step) => step.action.type)).toEqual(['SET_VARIABLE', 'NODE']);
    expect(steps[0]!.frameId).toBe('start');
  });

  it('round-trips through the file format with its value', () => {
    const file = emptyFile('Vars');
    const frame = createFrameNode(file.document, 0, 0, 100, 100, { name: 'Trigger' });
    frame.interactions = [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'SET_VARIABLE', variableId: 'v', variableValue: false }] }];
    file.document.children[0]!.children = [frame];
    const restored = parseFile(serializeFile(file));
    const kept = (restored.file!.document.children[0]!.children[0] as typeof frame).interactions![0]!.actions[0]!;
    expect(kept).toEqual({ type: 'SET_VARIABLE', variableId: 'v', variableValue: false });
  });
});
