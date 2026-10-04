import type { Rect } from '../model/types';
import type { Viewport } from '../store/editorStore';

/**
 * Figma-style rulers: 20px strips along the top and left edges with ticks in
 * document units, plus a highlight of the current selection extent.
 * Purely presentational — pointer events stay with the canvas underneath.
 */

const STRIP = 20;

/** Tick steps that keep labels at least ~64px apart at the current zoom. */
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

function tickStep(zoom: number): number {
  for (const step of STEPS) if (step * zoom >= 64) return step;
  return STEPS[STEPS.length - 1] as number;
}

interface RulersProps {
  viewport: Viewport;
  width: number;
  height: number;
  selection: Rect | null;
}

export function Rulers({ viewport, width, height, selection }: RulersProps) {
  const step = tickStep(viewport.zoom);
  const minor = step / 5;
  const worldLeft = -viewport.x / viewport.zoom;
  const worldTop = -viewport.y / viewport.zoom;
  const worldRight = worldLeft + width / viewport.zoom;
  const worldBottom = worldTop + height / viewport.zoom;

  const toScreenX = (world: number) => world * viewport.zoom + viewport.x;
  const toScreenY = (world: number) => world * viewport.zoom + viewport.y;

  const verticalTicks: Array<{ screen: number; world: number; major: boolean }> = [];
  const startX = Math.floor(worldLeft / minor) * minor;
  for (let world = startX; world <= worldRight; world += minor) {
    const major = Math.abs(world / step - Math.round(world / step)) < 1e-6;
    verticalTicks.push({ screen: toScreenX(world), world, major });
  }

  const horizontalTicks: Array<{ screen: number; world: number; major: boolean }> = [];
  const startY = Math.floor(worldTop / minor) * minor;
  for (let world = startY; world <= worldBottom; world += minor) {
    const major = Math.abs(world / step - Math.round(world / step)) < 1e-6;
    horizontalTicks.push({ screen: toScreenY(world), world, major });
  }

  const label = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

  return (
    <svg
      className="canvas__rulers"
      width={width}
      height={height}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}
      aria-hidden="true"
    >
      <rect x={0} y={0} width={width} height={STRIP} fill="var(--figma-bg)" />
      <rect x={0} y={0} width={STRIP} height={height} fill="var(--figma-bg)" />
      <rect x={0} y={0} width={STRIP} height={STRIP} fill="var(--figma-bg-secondary)" />
      <line x1={0} y1={STRIP} x2={width} y2={STRIP} stroke="var(--figma-border)" strokeWidth={1} />
      <line x1={STRIP} y1={0} x2={STRIP} y2={height} stroke="var(--figma-border)" strokeWidth={1} />

      {selection && selection.width > 0 ? (
        <rect
          x={Math.max(STRIP, toScreenX(selection.x))}
          y={2}
          width={Math.max(0, Math.min(width, toScreenX(selection.x + selection.width)) - Math.max(STRIP, toScreenX(selection.x)))}
          height={STRIP - 4}
          fill="var(--figma-brand)"
          opacity={0.18}
        />
      ) : null}
      {selection && selection.height > 0 ? (
        <rect
          y={Math.max(STRIP, toScreenY(selection.y))}
          x={2}
          height={Math.max(0, Math.min(height, toScreenY(selection.y + selection.height)) - Math.max(STRIP, toScreenY(selection.y)))}
          width={STRIP - 4}
          fill="var(--figma-brand)"
          opacity={0.18}
        />
      ) : null}

      {verticalTicks.map((tick, index) => (
        <g key={`v${index}`}>
          <line
            x1={tick.screen}
            y1={tick.major ? STRIP - 8 : STRIP - 4}
            x2={tick.screen}
            y2={STRIP}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={1}
          />
          {tick.major && tick.screen > STRIP + 12 ? (
            <text x={tick.screen + 3} y={11} fontSize={9} fill="rgba(0,0,0,0.5)" style={{ fontFamily: 'Inter, sans-serif' }}>
              {label(tick.world)}
            </text>
          ) : null}
        </g>
      ))}
      {horizontalTicks.map((tick, index) => (
        <g key={`h${index}`}>
          <line
            x1={tick.major ? STRIP - 8 : STRIP - 4}
            y1={tick.screen}
            x2={STRIP}
            y2={tick.screen}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={1}
          />
          {tick.major && tick.screen > STRIP + 12 ? (
            <text
              x={STRIP - 11}
              y={tick.screen - 3}
              fontSize={9}
              fill="rgba(0,0,0,0.5)"
              textAnchor="end"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              {label(tick.world)}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
