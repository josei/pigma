/**
 * Decoders for Figma's native geometry blobs.
 *
 * `.fig` VECTOR nodes reference two binary payloads by index into
 * `message.blobs`: `fillGeometry[].commandsBlob` (renderable path commands,
 * already in node-size space) and `vectorData.vectorNetworkBlob` (editable
 * vertex/segment/region network in normalized space). Both layouts are
 * documented in openfig-core's `docs/vector.md` (MIT).
 */
import { FigmaImportError } from '../errors';

export type VectorPathCommand =
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'lineTo'; x: number; y: number }
  | { type: 'cubicTo'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | { type: 'close' };

export interface VectorNetworkVertex {
  styleId: number;
  x: number;
  y: number;
}

export interface VectorNetworkSegment {
  word0: number;
  startVertex: number;
  endVertex: number;
  tangentStartX: number;
  tangentStartY: number;
  tangentEndX: number;
  tangentEndY: number;
  isStraight: boolean;
}

export interface VectorNetworkRegion {
  windingRule: 'NONZERO' | 'EVENODD';
  styleId: number;
  loops: number[][];
}

export interface VectorNetwork {
  vertices: VectorNetworkVertex[];
  segments: VectorNetworkSegment[];
  regions: VectorNetworkRegion[];
  bytesConsumed: number;
}

function floatAt(view: DataView, offset: number): number {
  return view.getFloat32(offset, true);
}

/** Decode a `fillGeometry`/`strokeGeometry` `commandsBlob` into path commands. */
export function decodeCommandsBlob(bytes: Uint8Array): VectorPathCommand[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const commands: VectorPathCommand[] = [];
  let offset = 0;
  const need = (n: number, what: string): void => {
    if (offset + n > bytes.byteLength) {
      throw new FigmaImportError('INVALID_BINARY', `Truncated geometry blob: ${what} needs ${n} bytes at offset ${offset}`);
    }
  };
  while (offset < bytes.byteLength) {
    const opcode = bytes[offset];
    if (opcode === undefined) break;
    offset += 1;
    switch (opcode) {
      case 0x00:
        commands.push({ type: 'close' });
        break;
      case 0x01:
        need(8, 'moveTo');
        commands.push({ type: 'moveTo', x: floatAt(view, offset), y: floatAt(view, offset + 4) });
        offset += 8;
        break;
      case 0x02:
        need(8, 'lineTo');
        commands.push({ type: 'lineTo', x: floatAt(view, offset), y: floatAt(view, offset + 4) });
        offset += 8;
        break;
      case 0x04:
        need(24, 'cubicTo');
        commands.push({
          type: 'cubicTo',
          c1x: floatAt(view, offset),
          c1y: floatAt(view, offset + 4),
          c2x: floatAt(view, offset + 8),
          c2y: floatAt(view, offset + 12),
          x: floatAt(view, offset + 16),
          y: floatAt(view, offset + 20),
        });
        offset += 24;
        break;
      default:
        throw new FigmaImportError('INVALID_BINARY', `Unknown geometry opcode 0x${opcode.toString(16)} at offset ${offset - 1}`);
    }
  }
  return commands;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

/** Serialize decoded path commands to an SVG `d` attribute. */
export function commandsToSvgPath(commands: VectorPathCommand[]): string {
  const parts: string[] = [];
  for (const command of commands) {
    switch (command.type) {
      case 'moveTo':
        parts.push(`M${formatNumber(command.x)} ${formatNumber(command.y)}`);
        break;
      case 'lineTo':
        parts.push(`L${formatNumber(command.x)} ${formatNumber(command.y)}`);
        break;
      case 'cubicTo':
        parts.push(
          `C${formatNumber(command.c1x)} ${formatNumber(command.c1y)} ${formatNumber(command.c2x)} ${formatNumber(command.c2y)} ${formatNumber(command.x)} ${formatNumber(command.y)}`,
        );
        break;
      case 'close':
        parts.push('Z');
        break;
    }
  }
  return parts.join(' ');
}

/** Decode a `vectorData.vectorNetworkBlob` into structured geometry. */
export function parseVectorNetworkBlob(bytes: Uint8Array): VectorNetwork {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number): number => view.getUint32(offset, true);
  const fail = (message: string): never => {
    throw new FigmaImportError('INVALID_BINARY', `Invalid vector network blob: ${message}`);
  };

  if (bytes.byteLength < 12) fail(`header needs 12 bytes, got ${bytes.byteLength}`);
  const vertexCount = u32(0);
  const segmentCount = u32(4);
  const regionCount = u32(8);

  let offset = 12;
  const vertexBytes = vertexCount * 12;
  const segmentBytes = segmentCount * 28;
  if (offset + vertexBytes + segmentBytes > bytes.byteLength) {
    fail(`declared ${vertexCount} vertices and ${segmentCount} segments exceed ${bytes.byteLength} bytes`);
  }

  const vertices: VectorNetworkVertex[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    vertices[i] = { styleId: u32(offset), x: floatAt(view, offset + 4), y: floatAt(view, offset + 8) };
    offset += 12;
  }

  const segments: VectorNetworkSegment[] = new Array(segmentCount);
  for (let i = 0; i < segmentCount; i++) {
    const startVertex = u32(offset + 4);
    const endVertex = u32(offset + 16);
    const tangentStartX = floatAt(view, offset + 8);
    const tangentStartY = floatAt(view, offset + 12);
    const tangentEndX = floatAt(view, offset + 20);
    const tangentEndY = floatAt(view, offset + 24);
    if (startVertex >= vertexCount || endVertex >= vertexCount) {
      fail(`segment ${i} references vertex ${startVertex}→${endVertex} but only ${vertexCount} exist`);
    }
    segments[i] = {
      word0: u32(offset),
      startVertex,
      endVertex,
      tangentStartX,
      tangentStartY,
      tangentEndX,
      tangentEndY,
      isStraight: tangentStartX === 0 && tangentStartY === 0 && tangentEndX === 0 && tangentEndY === 0,
    };
    offset += 28;
  }

  const regions: VectorNetworkRegion[] = new Array(regionCount);
  for (let i = 0; i < regionCount; i++) {
    if (offset + 8 > bytes.byteLength) fail(`region ${i} header runs past the end`);
    const packed = u32(offset);
    const loopCount = u32(offset + 4);
    offset += 8;
    const loops: number[][] = new Array(loopCount);
    for (let l = 0; l < loopCount; l++) {
      if (offset + 4 > bytes.byteLength) fail(`region ${i} loop ${l} header runs past the end`);
      const segCount = u32(offset);
      offset += 4;
      if (offset + segCount * 4 > bytes.byteLength) fail(`region ${i} loop ${l} declares ${segCount} segments past the end`);
      const loop: number[] = new Array(segCount);
      for (let s = 0; s < segCount; s++) {
        const index = u32(offset);
        if (index >= segmentCount) fail(`region ${i} loop ${l} references segment ${index} but only ${segmentCount} exist`);
        loop[s] = index;
        offset += 4;
      }
      loops[l] = loop;
    }
    regions[i] = { windingRule: packed & 1 ? 'NONZERO' : 'EVENODD', styleId: packed >> 1, loops };
  }

  if (offset !== bytes.byteLength) fail(`${bytes.byteLength - offset} trailing byte(s)`);
  return { vertices, segments, regions, bytesConsumed: offset };
}

/**
 * Convert a vector network into an SVG `d` string in network (normalized)
 * coordinates. Loops are walked segment-by-segment, reversing segments that are
 * stored end-to-start.
 */
export function vectorNetworkToSvgPath(network: VectorNetwork, scaleX = 1, scaleY = 1): string {
  const { vertices, segments, regions } = network;
  const parts: string[] = [];
  for (const region of regions) {
    for (const loop of region.loops) {
      if (loop.length === 0) continue;
      const first = segments[loop[0] as number];
      if (!first) continue;
      let current = first.startVertex;
      const start = vertices[current];
      if (!start) continue;
      parts.push(`M${formatNumber(start.x * scaleX)} ${formatNumber(start.y * scaleY)}`);
      for (const segmentIndex of loop) {
        const segment = segments[segmentIndex];
        if (!segment) continue;
        let from: VectorNetworkVertex | undefined;
        let to: VectorNetworkVertex | undefined;
        let tangentStartX: number;
        let tangentStartY: number;
        let tangentEndX: number;
        let tangentEndY: number;
        if (segment.startVertex === current) {
          from = vertices[segment.startVertex];
          to = vertices[segment.endVertex];
          tangentStartX = segment.tangentStartX;
          tangentStartY = segment.tangentStartY;
          tangentEndX = segment.tangentEndX;
          tangentEndY = segment.tangentEndY;
        } else if (segment.endVertex === current) {
          from = vertices[segment.endVertex];
          to = vertices[segment.startVertex];
          tangentStartX = segment.tangentEndX;
          tangentStartY = segment.tangentEndY;
          tangentEndX = segment.tangentStartX;
          tangentEndY = segment.tangentStartY;
        } else {
          throw new FigmaImportError(
            'INVALID_BINARY',
            `Vector network loop is disconnected at segment ${segmentIndex}`,
          );
        }
        if (!from || !to) continue;
        if (segment.isStraight) {
          parts.push(`L${formatNumber(to.x * scaleX)} ${formatNumber(to.y * scaleY)}`);
        } else {
          parts.push(
            `C${formatNumber((from.x + tangentStartX) * scaleX)} ${formatNumber((from.y + tangentStartY) * scaleY)} ${formatNumber((to.x + tangentEndX) * scaleX)} ${formatNumber((to.y + tangentEndY) * scaleY)} ${formatNumber(to.x * scaleX)} ${formatNumber(to.y * scaleY)}`,
          );
        }
        current = segment.startVertex === current ? segment.endVertex : segment.startVertex;
      }
      parts.push('Z');
    }
  }
  return parts.join(' ');
}
