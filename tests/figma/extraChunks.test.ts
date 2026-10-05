/**
 * The parser decodes only `rawChunks[1]`. Every real file has exactly two chunks,
 * so that is correct today — but a file carrying a third would be SILENTLY
 * truncated, which is the failure mode this run exists to kill. The extra chunk is
 * recorded and reported; a normal file reports nothing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFigBinary, type FigDocument } from '../../src/figma/native/parse';
import { figDocumentToPigmaFile } from '../../src/figma/convert/convert';
import { nodeDecompressors } from '../../src/figma/native/node';
import { readZipEntries } from '../../src/figma/native/zip';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

/** The raw `canvas.fig` bytes from inside a fixture archive. */
function canvasBytes(): Uint8Array {
  const entries = readZipEntries(fixture('circle.fig'), nodeDecompressors);
  const entry = entries.get('canvas.fig');
  if (!entry) throw new Error(`no canvas.fig in the fixture: ${[...entries.keys()].join(', ')}`);
  return entry;
}

/** Append a length-prefixed third chunk to a canvas.fig. */
function withExtraChunk(bytes: Uint8Array): Uint8Array {
  const extra = new TextEncoder().encode('an extra chunk');
  const out = new Uint8Array(bytes.byteLength + 4 + extra.byteLength);
  out.set(bytes, 0);
  new DataView(out.buffer).setUint32(bytes.byteLength, extra.byteLength, true);
  out.set(extra, bytes.byteLength + 4);
  return out;
}

describe('the parser reports chunks it does not decode', () => {
  it('records the extra chunk and the converter reports it', async () => {
    const parsed = parseFigBinary(withExtraChunk(canvasBytes()), nodeDecompressors) as FigDocument;
    expect(parsed.extraChunks).toBe(1);
    const { report } = figDocumentToPigmaFile(parsed, { now: () => 1 });
    const chunks = report.unsupported.filter((entry) => entry.feature === 'chunk');
    expect(chunks, JSON.stringify(report.unsupported.slice(0, 3))).toHaveLength(1);
    expect(chunks[0]?.detail).toContain('not decoded');
  });

  it('reports nothing for a normal two-chunk file', async () => {
    const parsed = parseFigBinary(canvasBytes(), nodeDecompressors) as FigDocument;
    expect(parsed.extraChunks).toBe(0);
    const { report } = figDocumentToPigmaFile(parsed, { now: () => 1 });
    expect(report.unsupported.filter((entry) => entry.feature === 'chunk')).toEqual([]);
  });
});
