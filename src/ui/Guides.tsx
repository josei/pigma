import { useRef, useState } from 'react';
import type { UserGuide } from '../model/types';
import type { Viewport } from '../store/editorStore';
import { useEditor } from '../store/editorStore';

/** The ruler strip width, as the rulers draw it. A guide released over a strip is removed. */
const STRIP = 20;
/** Pixels a press must travel before it counts as a drag, so a click on a guide moves nothing. */
const DRAG_THRESHOLD = 2;

interface GuidesProps {
  viewport: Viewport;
  width: number;
  height: number;
  guides: UserGuide[];
  /** The strips to drag guides out of are only there while the rulers show. */
  rulers: boolean;
}

interface Drag {
  axis: 'x' | 'y';
  /** The guide being moved, or null for a new one from a ruler. */
  index: number | null;
  /** Pointer position on the drag axis, relative to the layer. */
  screen: number;
  moved: boolean;
  startClient: number;
}

/**
 * Ruler guides (Figma's guides). Drag from the top ruler for a horizontal guide, or from the left ruler for a
 * vertical one; drag a guide to move it, and drag it back onto a ruler to remove it.
 */
export function Guides({ viewport, width, height, guides, rulers }: GuidesProps) {
  const layerRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const addGuide = useEditor((state) => state.addGuide);
  const moveGuide = useEditor((state) => state.moveGuide);
  const removeGuide = useEditor((state) => state.removeGuide);
  const selectedGuide = useEditor((state) => state.selectedGuide);
  const selectGuide = useEditor((state) => state.selectGuide);

  const toScreen = (axis: 'x' | 'y', world: number) => (axis === 'x' ? world * viewport.zoom + viewport.x : world * viewport.zoom + viewport.y);
  const toWorld = (axis: 'x' | 'y', screen: number) => (axis === 'x' ? (screen - viewport.x) / viewport.zoom : (screen - viewport.y) / viewport.zoom);

  const begin = (axis: 'x' | 'y', index: number | null, event: React.PointerEvent) => {
    event.preventDefault();
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startClient = axis === 'x' ? event.clientX : event.clientY;
    const origin = axis === 'x' ? rect.left : rect.top;
    const start: Drag = { axis, index, screen: startClient - origin, moved: false, startClient };
    setDrag(start);
    // Pressing a guide selects it, so Delete can remove it (Figma: select the guide, then Delete).
    if (index !== null) selectGuide(index);

    const onMove = (move: PointerEvent) => {
      const client = axis === 'x' ? move.clientX : move.clientY;
      setDrag((current) => current && {
        ...current,
        screen: client - origin,
        moved: current.moved || Math.abs(client - start.startClient) > DRAG_THRESHOLD,
      });
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      const client = axis === 'x' ? up.clientX : up.clientY;
      const overStrip = client - origin < STRIP;
      const moved = Math.abs(client - start.startClient) > DRAG_THRESHOLD;
      if (index !== null) {
        if (overStrip) removeGuide(index);
        else if (moved) moveGuide(index, toWorld(axis, client - origin));
        return;
      }
      if (!overStrip && moved) addGuide(axis, toWorld(axis, client - origin));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const stripStyle = { pointerEvents: 'auto' as const };

  return (
    <svg
      ref={layerRef}
      className="canvas__guides"
      width={width}
      height={height}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}
      aria-hidden="true"
    >
      {rulers ? (
        <>
          <rect
            data-testid="ruler-drag-y"
            x={STRIP}
            y={0}
            width={Math.max(0, width - STRIP)}
            height={STRIP}
            fill="transparent"
            style={{ ...stripStyle, cursor: 'row-resize' }}
            onPointerDown={(event) => begin('y', null, event)}
          />
          <rect
            data-testid="ruler-drag-x"
            x={0}
            y={STRIP}
            width={STRIP}
            height={Math.max(0, height - STRIP)}
            fill="transparent"
            style={{ ...stripStyle, cursor: 'col-resize' }}
            onPointerDown={(event) => begin('x', null, event)}
          />
        </>
      ) : null}
      {guides.map((guide, index) => {
        const moving = drag?.index === index;
        const selected = selectedGuide === index;
        const position = moving && drag.moved ? drag.screen : toScreen(guide.axis, guide.offset);
        // A guide being dragged is drawn where the pointer is, and the original is hidden until the drop.
        if (moving && drag.moved) return <GuideLine key={index} axis={guide.axis} at={position} width={width} height={height} selected />;
        return (
          <g key={index}>
            <GuideLine axis={guide.axis} at={toScreen(guide.axis, guide.offset)} width={width} height={height} selected={selected} />
            <line
              data-testid="guide-hit"
              x1={guide.axis === 'x' ? toScreen('x', guide.offset) : 0}
              x2={guide.axis === 'x' ? toScreen('x', guide.offset) : width}
              y1={guide.axis === 'y' ? toScreen('y', guide.offset) : 0}
              y2={guide.axis === 'y' ? toScreen('y', guide.offset) : height}
              stroke="transparent"
              strokeWidth={8}
              style={{ pointerEvents: 'stroke', cursor: guide.axis === 'x' ? 'col-resize' : 'row-resize' }}
              onPointerDown={(event) => begin(guide.axis, index, event)}
              // Figma's guide menu has one item, Remove guide: a right-click removes the guide directly.
              onContextMenu={(event) => {
                event.preventDefault();
                removeGuide(index);
              }}
            />
          </g>
        );
      })}
      {drag && drag.index === null && drag.moved ? <GuideLine axis={drag.axis} at={drag.screen} width={width} height={height} /> : null}
    </svg>
  );
}

function GuideLine({ axis, at, width, height, selected = false }: { axis: 'x' | 'y'; at: number; width: number; height: number; selected?: boolean }) {
  return (
    <line
      data-testid="guide-line"
      x1={axis === 'x' ? at : 0}
      x2={axis === 'x' ? at : width}
      y1={axis === 'y' ? at : 0}
      y2={axis === 'y' ? at : height}
      data-selected={selected ? 'true' : undefined}
      stroke="var(--figma-brand, #0d99ff)"
      strokeWidth={selected ? 2 : 1}
    />
  );
}
