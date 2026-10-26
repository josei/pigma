import { describe, expect, it } from 'vitest';
import { OVERLAY_MARGIN, OVERLAY_POSITIONS, overlayBox, overlayDims } from './overlay';
import type { PrototypeAction } from './types';

const frame = { width: 400, height: 300 };
const overlay = { width: 200, height: 100 };
const action = (patch: Partial<PrototypeAction> = {}): PrototypeAction => ({ type: 'NODE', destinationId: 'x', overlay: true, ...patch });

describe('overlay placement', () => {
  it('centres by default', () => {
    expect(overlayBox(action(), frame, overlay)).toEqual({ x: 100, y: 100 });
    expect(overlayBox(action({ overlayPosition: 'CENTER' }), frame, overlay)).toEqual({ x: 100, y: 100 });
  });

  it('snaps to each corner with a margin', () => {
    expect(overlayBox(action({ overlayPosition: 'TOP_LEFT' }), frame, overlay)).toEqual({ x: OVERLAY_MARGIN, y: OVERLAY_MARGIN });
    expect(overlayBox(action({ overlayPosition: 'TOP_RIGHT' }), frame, overlay)).toEqual({ x: 200 - OVERLAY_MARGIN, y: OVERLAY_MARGIN });
    expect(overlayBox(action({ overlayPosition: 'BOTTOM_LEFT' }), frame, overlay)).toEqual({ x: OVERLAY_MARGIN, y: 200 - OVERLAY_MARGIN });
    expect(overlayBox(action({ overlayPosition: 'BOTTOM_RIGHT' }), frame, overlay)).toEqual({ x: 200 - OVERLAY_MARGIN, y: 200 - OVERLAY_MARGIN });
  });

  it('uses manual offsets for a custom position and keeps the overlay inside', () => {
    expect(overlayBox(action({ overlayPosition: 'CUSTOM', overlayX: 30, overlayY: 40 }), frame, overlay)).toEqual({ x: 30, y: 40 });
    expect(overlayBox(action({ overlayPosition: 'CUSTOM', overlayX: 900, overlayY: -50 }), frame, overlay)).toEqual({ x: 200, y: 0 });
  });

  it('keeps the overlay anchored when it is larger than the frame', () => {
    // Bigger overlays overflow, but the anchor never leaves the frame's origin.
    expect(overlayBox(action({ overlayPosition: 'BOTTOM_RIGHT' }), { width: 100, height: 80 }, { width: 200, height: 100 })).toEqual({
      x: 0,
      y: 0,
    });
    // Only the overflowing axis is clamped.
    expect(overlayBox(action({ overlayPosition: 'TOP_RIGHT' }), { width: 400, height: 80 }, { width: 200, height: 100 })).toEqual({
      x: 400 - 200 - OVERLAY_MARGIN,
      y: 0,
    });
  });

  it('dims by default and honours an explicit opt-out', () => {
    expect(overlayDims(action())).toBe(true);
    expect(overlayDims(action({ overlayDim: true }))).toBe(true);
    expect(overlayDims(action({ overlayDim: false }))).toBe(false);
  });

  it('offers every Figma position in the panel list', () => {
    expect(OVERLAY_POSITIONS.map((entry) => entry.value)).toEqual([
      'CENTER',
      'TOP_LEFT',
      'TOP_RIGHT',
      'BOTTOM_LEFT',
      'BOTTOM_RIGHT',
      'CUSTOM',
    ]);
  });
});
