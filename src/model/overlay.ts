import type { OverlayPosition, PrototypeAction } from './types';

/**
 * Prototype overlay placement (M12).
 *
 * A presentation overlay is anchored inside the presenting frame: centered by
 * default, snapped to a corner, or at manual x/y offsets. The maths is pure so
 * the panel, the presentation view and the tests all agree on one definition.
 */

export const OVERLAY_POSITIONS: Array<{ value: OverlayPosition; label: string }> = [
  { value: 'CENTER', label: 'Center' },
  { value: 'TOP_LEFT', label: 'Top left' },
  { value: 'TOP_RIGHT', label: 'Top right' },
  { value: 'BOTTOM_LEFT', label: 'Bottom left' },
  { value: 'BOTTOM_RIGHT', label: 'Bottom right' },
  { value: 'CUSTOM', label: 'Custom' },
];

export interface OverlayBox {
  x: number;
  y: number;
}

/** Margin used when an overlay is snapped to a corner, in scene units. */
export const OVERLAY_MARGIN = 16;

/**
 * Top-left corner of an overlay inside a frame of `frameWidth` × `frameHeight`.
 * Sizes are the overlay's own bounds; the result is in the frame's local space.
 */
export function overlayBox(action: PrototypeAction, frame: { width: number; height: number }, overlay: { width: number; height: number }): OverlayBox {
  const position: OverlayPosition = action.overlayPosition ?? 'CENTER';
  const maxX = frame.width - overlay.width;
  const maxY = frame.height - overlay.height;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  switch (position) {
    case 'TOP_LEFT':
      return { x: clamp(OVERLAY_MARGIN, maxX), y: clamp(OVERLAY_MARGIN, maxY) };
    case 'TOP_RIGHT':
      return { x: clamp(maxX - OVERLAY_MARGIN, maxX), y: clamp(OVERLAY_MARGIN, maxY) };
    case 'BOTTOM_LEFT':
      return { x: clamp(OVERLAY_MARGIN, maxX), y: clamp(maxY - OVERLAY_MARGIN, maxY) };
    case 'BOTTOM_RIGHT':
      return { x: clamp(maxX - OVERLAY_MARGIN, maxX), y: clamp(maxY - OVERLAY_MARGIN, maxY) };
    case 'CUSTOM':
      return { x: clamp(action.overlayX ?? 0, maxX), y: clamp(action.overlayY ?? 0, maxY) };
    default:
      return { x: Math.round(maxX / 2), y: Math.round(maxY / 2) };
  }
}

/** Whether the frame behind the overlay is dimmed (default true). */
export function overlayDims(action: PrototypeAction): boolean {
  return action.overlayDim !== false;
}
