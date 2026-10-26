import { formatMeasure, redlinesFor, type RedlineGap } from '../model/redlines';
import type { PigmaFile } from '../model/types';

const RED = '#f24822';

/** Small filled label, sized from the text length (no DOM measurement needed). */
function Label({ x, y, text, scale }: { x: number; y: number; text: string; scale: number }) {
  const padding = 3 * scale;
  const fontSize = 10 * scale;
  const width = text.length * fontSize * 0.62 + padding * 2;
  const height = fontSize + padding * 1.4;
  return (
    <g>
      <rect x={x - width / 2} y={y - height / 2} width={width} height={height} rx={2 * scale} fill={RED} />
      <text
        x={x}
        y={y + fontSize * 0.36}
        textAnchor="middle"
        fontSize={fontSize}
        fill="#ffffff"
        style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}
      >
        {text}
      </text>
    </g>
  );
}

function gapLine(gap: RedlineGap, axis: 'x' | 'y', at: number, scale: number): JSX.Element {
  const strokeWidth = 1 * scale;
  const tick = 4 * scale;
  if (axis === 'x') {
    return (
      <g key={`x-${gap.from}-${gap.to}-${at}`}>
        <line x1={gap.from} y1={at} x2={gap.to} y2={at} stroke={RED} strokeWidth={strokeWidth} />
        <line x1={gap.from} y1={at - tick} x2={gap.from} y2={at + tick} stroke={RED} strokeWidth={strokeWidth} />
        <line x1={gap.to} y1={at - tick} x2={gap.to} y2={at + tick} stroke={RED} strokeWidth={strokeWidth} />
      </g>
    );
  }
  return (
    <g key={`y-${gap.from}-${gap.to}-${at}`}>
      <line x1={at} y1={gap.from} x2={at} y2={gap.to} stroke={RED} strokeWidth={strokeWidth} />
      <line x1={at - tick} y1={gap.from} x2={at + tick} y2={gap.from} stroke={RED} strokeWidth={strokeWidth} />
      <line x1={at - tick} y1={gap.to} x2={at + tick} y2={gap.to} stroke={RED} strokeWidth={strokeWidth} />
    </g>
  );
}

/**
 * Dev-mode measurement overlay (M14): the selected (or hovered) node's size, its
 * spacing to the parent's inner edges, and the clear distance to the nearest
 * sibling on each side. Canvas only — the exporter renders `SceneSvg`, so nothing
 * here can reach an export.
 */
export function RedlineOverlay({ file, id, zoom }: { file: PigmaFile; id: string; zoom: number }) {
  const red = redlinesFor(file, id);
  if (!red) return null;
  const scale = 1 / Math.max(zoom, 0.02);
  const { bounds } = red;
  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;
  const inside = red.parent
    ? {
        // Parent lines sit just outside the node so they stay readable.
        left: red.parent.left && red.parent.left.distance > 0 ? { gap: red.parent.left, at: midY + bounds.height / 4 } : null,
        right: red.parent.right && red.parent.right.distance > 0 ? { gap: red.parent.right, at: midY + bounds.height / 4 } : null,
        top: red.parent.top && red.parent.top.distance > 0 ? { gap: red.parent.top, at: midX - bounds.width / 4 } : null,
        bottom: red.parent.bottom && red.parent.bottom.distance > 0 ? { gap: red.parent.bottom, at: midX - bounds.width / 4 } : null,
      }
    : null;

  return (
    <g className="canvas__redlines" data-testid="redlines">
      {/* Size badge under the node. */}
      <Label x={midX} y={bounds.y + bounds.height + 12 * scale} text={`${formatMeasure(red.width)} × ${formatMeasure(red.height)}`} scale={scale} />

      {inside?.left ? gapLine(inside.left.gap, 'x', inside.left.at, scale) : null}
      {inside?.left ? <Label x={(inside.left.gap.from + inside.left.gap.to) / 2} y={inside.left.at - 9 * scale} text={formatMeasure(inside.left.gap.distance)} scale={scale} /> : null}
      {inside?.right ? gapLine(inside.right.gap, 'x', inside.right.at, scale) : null}
      {inside?.right ? <Label x={(inside.right.gap.from + inside.right.gap.to) / 2} y={inside.right.at - 9 * scale} text={formatMeasure(inside.right.gap.distance)} scale={scale} /> : null}
      {inside?.top ? gapLine(inside.top.gap, 'y', inside.top.at, scale) : null}
      {inside?.top ? <Label x={inside.top.at - 12 * scale} y={(inside.top.gap.from + inside.top.gap.to) / 2} text={formatMeasure(inside.top.gap.distance)} scale={scale} /> : null}
      {inside?.bottom ? gapLine(inside.bottom.gap, 'y', inside.bottom.at, scale) : null}
      {inside?.bottom ? <Label x={inside.bottom.at - 12 * scale} y={(inside.bottom.gap.from + inside.bottom.gap.to) / 2} text={formatMeasure(inside.bottom.gap.distance)} scale={scale} /> : null}

      {red.siblings.map((sibling) => {
        const horizontal = sibling.side === 'left' || sibling.side === 'right';
        return (
          <g key={`${sibling.side}-${sibling.id}`}>
            {gapLine({ distance: sibling.distance, from: sibling.from, to: sibling.to }, horizontal ? 'x' : 'y', sibling.at, scale)}
            <Label
              x={horizontal ? (sibling.from + sibling.to) / 2 : sibling.at - 12 * scale}
              y={horizontal ? sibling.at - 9 * scale : (sibling.from + sibling.to) / 2}
              text={formatMeasure(sibling.distance)}
              scale={scale}
            />
          </g>
        );
      })}
    </g>
  );
}
