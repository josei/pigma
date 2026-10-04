import { useRef } from 'react';
import { useEditor, PANEL_WIDTH_DEFAULT, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX } from '../store/editorStore';

/**
 * Draggable divider between a side panel and the canvas (M9).
 *
 * Widths are clamped to a usable range, kept in the store so both dividers agree,
 * and persisted with the document. Keyboard accessible: focus the divider and use
 * the arrow keys (Home resets to the default width).
 */
export function PanelResizer({ side }: { side: 'left' | 'right' }) {
  const width = useEditor((state) => state.panelWidths[side]);
  const setPanelWidth = useEditor((state) => state.setPanelWidth);
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Pointer already gone; dragging simply continues without capture.
    }
    dragging.current = { startX: event.clientX, startWidth: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    setPanelWidth(side, drag.startWidth + (side === 'left' ? delta : -delta));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = null;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  return (
    <div
      className={`panel-resizer panel-resizer--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize left panel' : 'Resize right panel'}
      aria-valuenow={width}
      aria-valuemin={PANEL_WIDTH_MIN}
      aria-valuemax={PANEL_WIDTH_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => setPanelWidth(side, PANEL_WIDTH_DEFAULT)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 8;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          setPanelWidth(side, width + (side === 'left' ? -step : step));
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          setPanelWidth(side, width + (side === 'left' ? step : -step));
        } else if (event.key === 'Home') {
          event.preventDefault();
          setPanelWidth(side, PANEL_WIDTH_DEFAULT);
        }
      }}
    />
  );
}
