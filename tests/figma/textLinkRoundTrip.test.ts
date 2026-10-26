/**
 * A text link survives a real `.fig` round trip (`exportPigmaFile` -> `parseFigArchive` -> `figDocumentToPigmaFile`):
 * the link is written as a hyperlink box, and read back to the same characters. Figma's schema has no character range
 * for a link, so the match is by geometry (textLinkBoxes.ts); these tests measure that it holds.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figDocumentToPigmaFile } from '../../src/figma/convert/convert';
import { nodeDecompressors } from '../../src/figma/native/node';
import { exportPigmaFile } from '../../src/figma/native/modelExport';
import { nodeExportCompressors } from '../../src/figma/native/export.node';
import { parseFigArchive } from '../../src/figma/native/parse';
import { emptyFile } from '../../src/model/validate';
import { createTextNode } from '../../src/model/factory';
import { syncTextSizes } from '../../src/model/textSync';
import type { PigmaFile, SceneNode, TextNode } from '../../src/model/types';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

async function roundTrip(file: PigmaFile): Promise<PigmaFile> {
  const archive = await exportPigmaFile(file, {
    schemaFrom: fixture('circle.fig'),
    decompress: nodeDecompressors,
    compress: nodeExportCompressors,
    sessionID: 1,
  });
  return figDocumentToPigmaFile(parseFigArchive(archive, nodeDecompressors), { now: () => 1 }).file;
}

function textNamed(file: PigmaFile, name: string): TextNode | null {
  const pages = file.document.children as Array<{ children: SceneNode[] }>;
  for (const page of pages) {
    for (const node of page.children) {
      if (node.name === name && node.type === 'TEXT') return node;
    }
  }
  return null;
}

describe('text links through a .fig file', () => {
  it('a linked word comes back linked, to the same characters and the same URL', async () => {
    const file = emptyFile('Links');
    const page = file.document.children[0]!;
    const text = createTextNode(null, 0, 0, 'Read the docs and the code');
    text.name = 'Caption';
    text.textRanges = [
      { start: 9, end: 13, link: 'https://docs.example' },
      { start: 22, end: 26, link: 'https://code.example' },
    ];
    page.children = [text];
    const sized = syncTextSizes(file);
    const reimported = await roundTrip(sized);
    const caption = textNamed(reimported, 'Caption');
    expect(caption, 'the text layer survived').toBeTruthy();
    expect(caption!.characters).toBe('Read the docs and the code');
    expect(caption!.textRanges).toEqual([
      { start: 9, end: 13, link: 'https://docs.example' },
      { start: 22, end: 26, link: 'https://code.example' },
    ]);
  });

  it('a text with no links comes back with none', async () => {
    const file = emptyFile('Plain');
    const page = file.document.children[0]!;
    const text = createTextNode(null, 0, 0, 'No links here');
    text.name = 'Plain caption';
    page.children = [text];
    const reimported = await roundTrip(syncTextSizes(file));
    expect(textNamed(reimported, 'Plain caption')?.textRanges ?? []).toEqual([]);
  });
});
