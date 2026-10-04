/**
 * Minimal ZIP reader for `.fig` / `.deck` / `.jam` archives.
 *
 * Figma archives are ZIP files (usually stored, sometimes deflated) holding
 * `canvas.fig`, `meta.json`, `thumbnail.png` and `images/*`. We read the
 * central directory (authoritative sizes, unlike streamed local headers that
 * may defer sizes to a data descriptor) and decompress only what is requested.
 */
import { FigmaImportError } from '../errors';

/** Compression primitives that cannot be implemented portably in-browser. */
export interface Decompressors {
  /** Raw DEFLATE (RFC 1951). Node: `zlib.inflateRawSync`; browser: `fflate.inflateSync`. */
  inflateRaw(bytes: Uint8Array): Uint8Array;
  /** Zstandard. Node: `zlib.zstdDecompressSync`; browser: `fzstd.decompress`. */
  zstd?(bytes: Uint8Array): Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

function findEndOfCentralDirectory(view: DataView): number {
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Extract every entry of a ZIP archive into a name → bytes map.
 * Directory entries are included with empty contents.
 */
export function readZipEntries(data: Uint8Array, decompress: Decompressors): Map<string, Uint8Array> {
  if (data.byteLength < 22) {
    throw new FigmaImportError('UNSUPPORTED_ARCHIVE', 'Archive is too small to be a ZIP file');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) {
    throw new FigmaImportError('UNSUPPORTED_ARCHIVE', 'Not a ZIP archive (no end-of-central-directory record)');
  }

  const entryCount = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new FigmaImportError('UNSUPPORTED_ARCHIVE', 'ZIP64 archives are not supported');
  }
  if (cdOffset + cdSize > data.byteLength) {
    throw new FigmaImportError('TRUNCATED', 'ZIP central directory runs past the end of the archive');
  }

  const entries = new Map<string, Uint8Array>();
  let offset = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > data.byteLength || view.getUint32(offset, true) !== CDH_SIG) {
      throw new FigmaImportError('TRUNCATED', `Malformed ZIP central directory entry ${i}`);
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLength));

    if (localOffset + 30 > data.byteLength || view.getUint32(localOffset, true) !== LFH_SIG) {
      throw new FigmaImportError('TRUNCATED', `Malformed ZIP local header for ${name}`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > data.byteLength) {
      throw new FigmaImportError('TRUNCATED', `ZIP entry ${name} runs past the end of the archive`);
    }
    const raw = data.subarray(start, end);

    if (method === 0) {
      entries.set(name, raw.slice());
    } else if (method === 8) {
      entries.set(name, decompress.inflateRaw(raw));
    } else {
      throw new FigmaImportError('UNSUPPORTED_ARCHIVE', `ZIP entry ${name} uses unsupported compression method ${method}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
