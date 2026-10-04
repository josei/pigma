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
import { actionOfKind, planActions } from './prototype';
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
