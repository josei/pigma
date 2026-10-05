/**
 * Parser for the native Figma binary format (`canvas.fig`, and the `.fig` /
 * `.deck` / `.jam` ZIP archives that contain it).
 *
 * Layout (openfig-core `docs/archive.md`, MIT):
 *
 *   [8B prelude "fig-kiwi"][u32 version]
 *   [u32 len][deflate-raw Kiwi binary schema]
 *   [u32 len][zstd or deflate-raw Kiwi message]   ← `nodeChanges`, `blobs`, …
 *   [u32 len][chunk 2+]                            ← opaque, passed through
 *
 * The message is decoded with our own Kiwi interpreter (`./kiwi`), so no
 * runtime dependency is required. Compression is injected via
 * {@link Decompressors}: Node callers use `./node`, browser callers pass
 * `fflate` / `fzstd`.
 */
import { FigmaImportError } from '../errors';
import { compileSchema, decodeBinarySchema, KiwiReader, type CompiledSchema, type KiwiSchema } from './kiwi';
import { readZipEntries, type Decompressors } from './zip';

/** A decoded Kiwi node. Field names match the `.fig` wire schema verbatim. */
export interface FigNode {
  guid?: { sessionID: number; localID: number };
  type?: string;
  name?: string;
  phase?: string;
  visible?: boolean;
  opacity?: number;
  size?: { x: number; y: number };
  transform?: { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number };
  parentIndex?: { guid: { sessionID: number; localID: number }; position: string };
  fillPaints?: FigPaint[];
  strokePaints?: FigPaint[];
  strokeWeight?: number;
  strokeAlign?: string;
  strokeCap?: string;
  strokeJoin?: string;
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  effects?: FigEffect[];
  fillGeometry?: FigGeometry[];
  strokeGeometry?: FigGeometry[];
  vectorData?: { vectorNetworkBlob?: number; normalizedSize?: { x: number; y: number }; styleOverrideTable?: unknown[] };
  textData?: { characters?: string };
  fontSize?: number;
  fontName?: { family?: string; style?: string; postScriptName?: string };
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  lineHeight?: { value?: number; units?: string };
  letterSpacing?: { value?: number; units?: string };
  textCase?: string;
  textDecoration?: string;
  textAutoResize?: string;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  characterStyleOverrides?: number[];
  styleOverrideTable?: unknown[];
  backgroundColor?: { r: number; g: number; b: number; a: number };
  backgroundEnabled?: boolean;
  clipsContent?: boolean;
  frameMaskDisabled?: boolean;
  resizeToFit?: boolean;
  locked?: boolean;
  stackMode?: string;
  stackSpacing?: number;
  stackPadding?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  stackPrimarySizing?: string;
  stackCounterSizing?: string;
  stackPrimaryAlignItems?: string;
  stackCounterAlignItems?: string;
  [key: string]: unknown;
}

export interface FigColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigPaint {
  type?: string;
  color?: FigColor;
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
  stops?: Array<{ color?: FigColor; position?: number }>;
  transform?: { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number };
  image?: { hash?: Uint8Array | string };
  imageRef?: string;
  scaleMode?: string;
  [key: string]: unknown;
}

export interface FigEffect {
  type?: string;
  color?: FigColor;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
  visible?: boolean;
  blendMode?: string;
  [key: string]: unknown;
}

export interface FigGeometry {
  windingRule?: string;
  commandsBlob?: number;
  styleID?: number;
}

export interface FigBlob {
  bytes?: Uint8Array;
}

/** Fully decoded native document. `raw` data is retained for round-tripping. */
export interface FigDocument {
  header: { prelude: string; version: number };
  /** Every node in `nodeChanges`, including `REMOVED` ones. */
  nodes: FigNode[];
  nodeMap: Map<string, FigNode>;
  childrenMap: Map<string, FigNode[]>;
  schema: KiwiSchema;
  compiledSchema: CompiledSchema;
  rawChunks: Uint8Array[];
  /** Chunks beyond the schema and the message; decoded nowhere, reported loudly. */
  extraChunks: number;
  message: Record<string, unknown>;
  blobs: FigBlob[];
  meta?: Record<string, unknown>;
  thumbnail?: Uint8Array;
  images: Map<string, Uint8Array>;
}

export function figNodeId(node: FigNode): string | null {
  if (!node.guid) return null;
  return `${node.guid.sessionID}:${node.guid.localID}`;
}

function figParentId(node: FigNode): string | null {
  if (!node.parentIndex?.guid) return null;
  return `${node.parentIndex.guid.sessionID}:${node.parentIndex.guid.localID}`;
}

function decompressChunk(chunk: Uint8Array, decompress: Decompressors): Uint8Array {
  const isZstd = chunk[0] === 0x28 && chunk[1] === 0xb5 && chunk[2] === 0x2f && chunk[3] === 0xfd;
  if (isZstd) {
    if (!decompress.zstd) {
      throw new FigmaImportError(
        'UNSUPPORTED_COMPRESSION',
        'This .fig message chunk is Zstandard-compressed but no zstd decompressor was provided',
      );
    }
    return decompress.zstd(chunk);
  }
  return decompress.inflateRaw(chunk);
}

/** Parse raw `canvas.fig` bytes (the blob inside the archive). */
export function parseFigBinary(data: Uint8Array, decompress: Decompressors): FigDocument {
  if (data.byteLength < 12) {
    throw new FigmaImportError('TRUNCATED', `canvas.fig is ${data.byteLength} bytes; at least 12 are required`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const prelude = new TextDecoder('latin1').decode(data.subarray(0, 8));
  if (!prelude.startsWith('fig-')) {
    throw new FigmaImportError('INVALID_BINARY', `Unknown .fig prelude ${JSON.stringify(prelude)}`);
  }
  const version = view.getUint32(8, true);

  const rawChunks: Uint8Array[] = [];
  let offset = 12;
  while (offset < data.byteLength) {
    if (offset + 4 > data.byteLength) {
      throw new FigmaImportError(
        'TRUNCATED',
        `Truncated canvas.fig: ${data.byteLength - offset} byte(s) left at offset ${offset}, expected a chunk length`,
      );
    }
    const length = view.getUint32(offset, true);
    offset += 4;
    if (offset + length > data.byteLength) {
      throw new FigmaImportError(
        'TRUNCATED',
        `Truncated canvas.fig: chunk ${rawChunks.length} declares ${length} bytes but only ${data.byteLength - offset} remain`,
      );
    }
    rawChunks.push(data.subarray(offset, offset + length));
    offset += length;
  }
  if (rawChunks.length < 2) {
    throw new FigmaImportError('INVALID_BINARY', `Expected at least 2 chunks, found ${rawChunks.length}`);
  }
  // ONLY rawChunks[1] is decoded. Every real file has exactly two chunks, so this
  // is correct today — but a file carrying a third would be SILENTLY truncated.
  // Record the extras so the converter can report them; a silent truncation is
  // exactly the class of loss this run exists to kill.
  const extraChunks = rawChunks.length - 2;

  let schema: KiwiSchema;
  try {
    schema = decodeBinarySchema(decompress.inflateRaw(rawChunks[0] as Uint8Array));
  } catch (cause) {
    throw new FigmaImportError('INVALID_BINARY', 'Failed to decode the embedded Kiwi schema', { cause });
  }
  const compiledSchema = compileSchema(schema);

  const decodeMessage = compiledSchema.decoders.decodeMessage;
  if (!decodeMessage) {
    throw new FigmaImportError('INVALID_BINARY', 'Kiwi schema has no root `Message` definition');
  }
  let message: Record<string, unknown>;
  try {
    message = decodeMessage(new KiwiReader(decompressChunk(rawChunks[1] as Uint8Array, decompress))) as Record<string, unknown>;
  } catch (cause) {
    if (cause instanceof FigmaImportError) throw cause;
    throw new FigmaImportError('INVALID_BINARY', 'Failed to decode the Kiwi message', { cause });
  }

  const rawNodes = message.nodeChanges;
  if (!Array.isArray(rawNodes)) {
    throw new FigmaImportError('MISSING_FIELD', 'Decoded message has no `nodeChanges` array');
  }
  const nodes = rawNodes as FigNode[];

  const { nodeMap, childrenMap } = indexNativeNodes(nodes);

  const blobs = Array.isArray(message.blobs) ? (message.blobs as FigBlob[]) : [];
  return {
    header: { prelude: prelude.trim(), version },
    nodes,
    nodeMap,
    childrenMap,
    schema,
    compiledSchema,
    rawChunks,
    extraChunks,
    message,
    blobs,
    images: new Map(),
  };
}

/**
 * Build the id/children index for a native `nodeChanges` array and reject
 * malformed hierarchies: missing guids, duplicate ids, dangling parents, and
 * `parentIndex` cycles.
 *
 * Exported as a seam so hierarchy validation is testable without a binary.
 */
export function indexNativeNodes(nodes: FigNode[]): {
  nodeMap: Map<string, FigNode>;
  childrenMap: Map<string, FigNode[]>;
} {
  const nodeMap = new Map<string, FigNode>();
  const childrenMap = new Map<string, FigNode[]>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as FigNode;
    const id = figNodeId(node);
    if (!id) {
      throw new FigmaImportError('MISSING_FIELD', `nodeChanges[${i}] has no guid`, { path: `nodeChanges.${i}` });
    }
    if (nodeMap.has(id)) {
      throw new FigmaImportError('DUPLICATE_ID', `Duplicate node id ${id} in nodeChanges`, { path: `nodeChanges.${i}` });
    }
    nodeMap.set(id, node);
  }
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as FigNode;
    const parentId = figParentId(node);
    if (!parentId) continue;
    if (!nodeMap.has(parentId)) {
      throw new FigmaImportError('INVALID_DOCUMENT', `Node ${figNodeId(node)} references missing parent ${parentId}`, {
        path: `nodeChanges.${i}.parentIndex`,
      });
    }
    const siblings = childrenMap.get(parentId);
    if (siblings) siblings.push(node);
    else childrenMap.set(parentId, [node]);
  }
  assertAcyclic(nodes, nodeMap, childrenMap);
  return { nodeMap, childrenMap };
}

/** Reject documents whose `parentIndex` chain contains a cycle. */
function assertAcyclic(nodes: FigNode[], nodeMap: Map<string, FigNode>, childrenMap: Map<string, FigNode[]>): void {
  const state = new Map<string, 0 | 1 | 2>();
  for (const node of nodes) {
    const start = figNodeId(node);
    if (!start || state.get(start) === 2) continue;
    const chain: string[] = [];
    let current: string | null = start;
    while (current && state.get(current) !== 2) {
      if (state.get(current) === 1) {
        const cycle = [...chain.slice(chain.indexOf(current)), current].join(' -> ');
        throw new FigmaImportError('CYCLE', `Cyclic node hierarchy detected: ${cycle}`);
      }
      state.set(current, 1);
      chain.push(current);
      const parentNode = nodeMap.get(current);
      const parent = parentNode ? figParentId(parentNode) : null;
      current = parent && nodeMap.has(parent) ? parent : null;
    }
    for (const id of chain) state.set(id, 2);
  }
  for (const [parentId, children] of childrenMap) {
    if (children.some((child) => figNodeId(child) === parentId)) {
      throw new FigmaImportError('CYCLE', `Node ${parentId} is its own parent`);
    }
  }
}

/** Parse a complete `.fig`/`.deck`/`.jam` ZIP archive. */
export function parseFigArchive(data: Uint8Array, decompress: Decompressors): FigDocument {
  if (data.byteLength < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new FigmaImportError('UNSUPPORTED_ARCHIVE', 'Not a .fig archive (missing ZIP signature)');
  }
  const entries = readZipEntries(data, decompress);
  let canvasKey: string | undefined;
  for (const key of entries.keys()) {
    if (key === 'canvas.fig' || key.endsWith('/canvas.fig')) {
      canvasKey = key;
      break;
    }
  }
  if (!canvasKey) {
    throw new FigmaImportError('UNSUPPORTED_ARCHIVE', 'Archive contains no canvas.fig');
  }

  const doc = parseFigBinary(entries.get(canvasKey) as Uint8Array, decompress);

  for (const [key, value] of entries) {
    if (key === 'meta.json' || key.endsWith('/meta.json')) {
      try {
        doc.meta = JSON.parse(new TextDecoder().decode(value)) as Record<string, unknown>;
      } catch {
        // A malformed meta.json is not fatal — the document itself is intact.
      }
    } else if (key === 'thumbnail.png' || key.endsWith('/thumbnail.png')) {
      doc.thumbnail = value;
    } else if (key.includes('images/') && !key.endsWith('/')) {
      const name = key.slice(key.lastIndexOf('/') + 1);
      doc.images.set(name, value);
    }
  }

  return doc;
}

/**
 * Parse any native Figma payload: a `.fig` ZIP archive or a bare `canvas.fig`
 * binary. Format is detected from the leading bytes.
 */
export function parseFigFile(data: Uint8Array, decompress: Decompressors): FigDocument {
  if (data.byteLength >= 2 && data[0] === 0x50 && data[1] === 0x4b) {
    return parseFigArchive(data, decompress);
  }
  return parseFigBinary(data, decompress);
}

/** Resolve a `message.blobs` index to its bytes. */
export function resolveBlob(doc: FigDocument, index: number | undefined): Uint8Array | null {
  if (index === undefined || index === null || index < 0 || index >= doc.blobs.length) return null;
  const blob = doc.blobs[index];
  return blob?.bytes ?? null;
}
