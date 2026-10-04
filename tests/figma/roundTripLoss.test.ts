/**
 * `.fig` round-trip loss, measured rather than assumed.
 *
 * The compat table promises "nothing is lost silently", so a field the exporter
 * omits is a P0. `locked` was one: it was never written, the importer reads
 * `locked === true`, and a missing field is false — a locked layer came back
 * unlocked with no warning. These tests drive the REAL binary round trip
 * (`exportPigmaFile` -> `parseFigArchive` -> `figDocumentToPigmaFile`) with the
 * fixture schemas, so the answer is measured, not inferred.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figDocumentToPigmaFile } from '../../src/figma/convert/convert';
import { nodeDecompressors } from '../../src/figma/native/node';
import { exportPigmaFile, pigmaToFigMessage } from '../../src/figma/native/modelExport';
import { nodeExportCompressors } from '../../src/figma/native/export.node';
import { parseFigArchive } from '../../src/figma/native/parse';
import { emptyFile } from '../../src/model/validate';
import { createRectNode } from '../../src/model/factory';
import type { PigmaFile, SceneNode } from '../../src/model/types';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

/** The first node with this name, at any depth. */
function byName(file: PigmaFile, name: string): SceneNode | null {
  let found: SceneNode | null = null;
  const visit = (node: { id: string; name?: string; children?: unknown[] }): void => {
    if (found) return;
    if (node.name === name) {
      found = node as unknown as SceneNode;
      return;
    }
    for (const child of (node.children ?? []) as Array<{ id: string; children?: unknown[] }>) visit(child);
  };
  visit(file.document as unknown as { id: string; children?: unknown[] });
  return found;
}

/** A one-rectangle file, mutated by the caller. */
function scene(mutate: (node: SceneNode) => void): { file: PigmaFile; id: string } {
  const file = emptyFile('Round trip');
  const page = file.document.children[0]!;
  const rect = createRectNode(file.document, 10, 20, 100, 50);
  rect.name = 'Subject';
  mutate(rect);
  page.children = [rect];
  return { file, id: rect.id };
}

/** The real binary round trip, with `schema` as the kiwi schema. */
async function roundTrip(file: PigmaFile, schema: string): Promise<PigmaFile> {
  const archive = await exportPigmaFile(file, {
    schemaFrom: fixture(schema),
    decompress: nodeDecompressors,
    compress: nodeExportCompressors,
    sessionID: 1,
  });
  return figDocumentToPigmaFile(parseFigArchive(archive, nodeDecompressors), { now: () => 1 }).file;
}

describe('native round trip keeps per-node flags', () => {
  it('preserves locked', async () => {
    const { file } = scene((node) => {
      node.locked = true;
    });
    const reimported = await roundTrip(file, 'circle.fig');
    // A native round trip re-issues ids (the wire carries guids), so the node is
    // found by name — the same way the existing round-trip test compares trees.
    const node = byName(reimported, 'Subject');
    expect(node, 'the node survived').toBeTruthy();
    expect(node!.locked, 'a locked layer came back unlocked').toBe(true);
  });

  it('preserves locked on a nested node, and leaves an unlocked one alone', async () => {
    const file = emptyFile('Nested');
    const page = file.document.children[0]!;
    const outer = createRectNode(file.document, 0, 0, 200, 200);
    outer.name = 'Outer';
    const inner = createRectNode(file.document, 10, 10, 50, 50);
    inner.name = 'Inner';
    inner.locked = true;
    (outer as unknown as { children: SceneNode[] }).children = [inner];
    page.children = [outer];
    const reimported = await roundTrip(file, 'circle.fig');
    expect(byName(reimported, 'Inner')!.locked).toBe(true);
    expect(byName(reimported, 'Outer')!.locked).toBe(false);
  });

  it('writes locked in the message, and omits it when false', () => {
    const locked = scene((node) => {
      node.locked = true;
    });
    const plain = scene(() => {});
    const options = { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors };
    const lockedChanges = pigmaToFigMessage(locked.file, options).message.nodeChanges as Array<Record<string, unknown>>;
    const plainChanges = pigmaToFigMessage(plain.file, options).message.nodeChanges as Array<Record<string, unknown>>;
    expect(lockedChanges.find((change) => change.name === 'Subject')!.locked).toBe(true);
    expect(plainChanges.find((change) => change.name === 'Subject')!.locked).toBeUndefined();
  });
});

describe('dashPattern: is the loss schema-dependent?', () => {
  it('is written to the message either way', () => {
    const { file } = scene((node) => {
      node.dashPattern = [4, 2];
    });
    const changes = pigmaToFigMessage(file, { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors }).message
      .nodeChanges as Array<Record<string, unknown>>;
    // The NATIVE wire name, which is what the schema defines.
    expect(changes.find((change) => change.name === 'Subject')!.dashPattern).toEqual([4, 2]);
  });

  it('reports which fixture schemas keep it through the binary round trip', async () => {
    // Measured across every schema fixture: the loss, if any, is a property of
    // the schema (whether it defines strokeDashes), not of the exporter.
    const results: Record<string, boolean> = {};
    for (const schema of ['circle.fig', 'openfigs.fig', 'with-image.fig', 'word-outline-stroke.fig']) {
      const { file } = scene((node) => {
        node.dashPattern = [4, 2];
      });
      const reimported = await roundTrip(file, schema);
      const node = byName(reimported, 'Subject');
      results[schema] = !!node && Array.isArray(node.dashPattern) && node.dashPattern.length > 0;
    }
    // FIXED: the exporter wrote the REST name (`strokeDashes`); the NATIVE schema
    // spells the field `dashPattern`, so it was dropped by the encoder. With the
    // wire name corrected the round trip keeps it — in every fixture whose schema
    // defines the field, which the decoded schema shows all four do.
    const kept = Object.entries(results).filter(([, value]) => value).map(([name]) => name);
    expect(Object.keys(results)).toHaveLength(4);
    expect(kept, `kept by: ${kept.join(', ')}`).toEqual(['circle.fig', 'openfigs.fig', 'with-image.fig', 'word-outline-stroke.fig']);
  });
});

describe('the export reports fields the schema cannot encode', () => {
  it('warns once per unencodable field, naming it and the change', () => {
    const file = emptyFile('Warn');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 0, 0, 100, 50);
    rect.name = 'Subject';
    // `overflowDirection` is WRITTEN by the exporter but the schema does not
    // define it, which is exactly the class this check catches. A field the
    // exporter never writes is a missing write, not a dropped one, so it cannot
    // appear here.
    (rect as { type: string }).type = 'FRAME';
    (rect as { overflowDirection?: string }).overflowDirection = 'VERTICAL_SCROLLING';
    page.children = [rect];

    const { warnings } = pigmaToFigMessage(file, { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors });
    const dropped = warnings.filter((line) => line.includes('is not defined by this .fig schema'));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain('"overflowDirection"');
    // The change is named.
    expect(dropped[0]).toMatch(/FRAME "Subject"/);
  });

  it('does not warn about fields the schema defines', () => {
    const file = emptyFile('Clean');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 0, 0, 100, 50);
    rect.name = 'Plain';
    rect.locked = true;
    rect.visible = false;
    rect.opacity = 0.5;
    rect.cornerRadius = 4;
    page.children = [rect];
    const { warnings } = pigmaToFigMessage(file, { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors });
    expect(warnings.filter((line) => line.includes('is not defined by this .fig schema'))).toEqual([]);
  });

  it('covers a silently WRONG value too: windingRule now round-trips', async () => {
    // It was not a loss but a wrong value: the exporter hardcoded NONZERO in the
    // geometry entry, so an EVENODD path came back NONZERO.
    const file = emptyFile('Winding');
    const page = file.document.children[0]!;
    const vector = createRectNode(file.document, 0, 0, 100, 50);
    vector.name = 'Subject';
    (vector as { type: string }).type = 'VECTOR';
    (vector as { pathData: string }).pathData = 'M 0 0 L 10 0 L 10 10 Z';
    vector.windingRule = 'EVENODD';
    page.children = [vector];
    const reimported = await roundTrip(file, 'circle.fig');
    // The schema spells it ODD; the import maps it back to the model's EVENODD.
    expect(byName(reimported, 'Subject')!.windingRule).toBe('EVENODD');
  });
});
