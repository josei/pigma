/** Byte helpers for image assets (base64/data URLs/hex). Isomorphic, no deps. */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64_ALPHABET.charAt(b0 >> 2);
    out += BASE64_ALPHABET.charAt(((b0 & 3) << 4) | ((b1 ?? 0) >> 4));
    out += b1 === undefined ? '=' : BASE64_ALPHABET.charAt(((b1 & 15) << 2) | ((b2 ?? 0) >> 6));
    out += b2 === undefined ? '=' : BASE64_ALPHABET.charAt(b2 & 63);
  }
  return out;
}

/** Lowercase hex, matching Figma's image hash filenames. */
export function bytesToHex(bytes: Uint8Array | string | undefined): string | undefined {
  if (typeof bytes === 'string') return bytes;
  if (!bytes) return undefined;
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) break;
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex.length > 0 ? hex : undefined;
}

/** Detect the image MIME type from magic bytes. */
export function sniffImageMime(bytes: Uint8Array): string {
  const at = (i: number): number => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'image/gif';
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

export function bytesToDataUrl(bytes: Uint8Array): string {
  return `data:${sniffImageMime(bytes)};base64,${bytesToBase64(bytes)}`;
}
