import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nodeDecompressors } from '../../src/figma/native/node';
import { exportFigBinary, readCanvasChunks, zipArchive } from '../../src/figma/native/export';
import { nodeExportCompressors } from '../../src/figma/native/export.node';
import { figNodeId, parseFigArchive, parseFigBinary } from '../../src/figma/native/parse';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

const summarize = (doc: ReturnType<typeof parseFigBinary>) =>
  doc.nodes.map((node) => ({
    id: figNodeId(node),
    type: node.type,
    name: node.name,
    width: node.size?.x ?? null,
    fill: node.fillPaints?.[0]?.type ?? null,
  }));

describe('native .fig export', () => {
  it('round-trips a decoded document back to canvas.fig', async () => {
    const source = fixture('circle.fig');
    const doc = parseFigArchive(source, nodeDecompressors);

    const exported = await exportFigBinary(doc.message, {
      schemaFrom: source,
      decompress: nodeDecompressors,
      compress: nodeExportCompressors,
    });

    const header = readCanvasChunks(exported);
    expect(header.prelude).toBe('fig-kiwi');
    expect(header.version).toBe(doc.header.version);
    expect(header.chunks.length).toBeGreaterThanOrEqual(2);
    // Chunk 1 must be zstd (Figma rejects deflateRaw on write).
    const chunk1 = header.chunks[1] as Uint8Array;
    expect([chunk1[0], chunk1[1], chunk1[2], chunk1[3]]).toEqual([0x28, 0xb5, 0x2f, 0xfd]);

    const reparsed = parseFigBinary(exported, nodeDecompressors);
    expect(summarize(reparsed)).toEqual(summarize(doc));
  });

  it('exports a complete .fig archive that parses again', async () => {
    const source = fixture('circle.fig');
    const doc = parseFigArchive(source, nodeDecompressors);
    const canvas = await exportFigBinary(doc.message, {
      schemaFrom: source,
      decompress: nodeDecompressors,
      compress: nodeExportCompressors,
    });
    const archive = zipArchive([
      ['canvas.fig', canvas],
      ['meta.json', new TextEncoder().encode(JSON.stringify({ file_name: 'Exported', version: '1' }))],
    ]);

    const reparsed = parseFigArchive(archive, nodeDecompressors);
    expect(reparsed.meta).toMatchObject({ file_name: 'Exported' });
    expect(summarize(reparsed)).toEqual(summarize(doc));
  });

  it('refuses to write without a zstd compressor', async () => {
    const source = fixture('circle.fig');
    const doc = parseFigArchive(source, nodeDecompressors);
    await expect(
      exportFigBinary(doc.message, { schemaFrom: source, decompress: nodeDecompressors }),
    ).rejects.toThrow(/zstd compressor/);
  });

  it('carries edits made to the decoded message', async () => {
    const source = fixture('circle.fig');
    const doc = parseFigArchive(source, nodeDecompressors);
    const ellipse = doc.nodes.find((node) => node.type === 'ELLIPSE');
    expect(ellipse).toBeDefined();
    ellipse!.name = 'Renamed Ellipse';

    const exported = await exportFigBinary(doc.message, {
      schemaFrom: source,
      decompress: nodeDecompressors,
      compress: nodeExportCompressors,
    });
    const reparsed = parseFigBinary(exported, nodeDecompressors);
    expect(reparsed.nodes.find((node) => node.type === 'ELLIPSE')?.name).toBe('Renamed Ellipse');
  });
});
