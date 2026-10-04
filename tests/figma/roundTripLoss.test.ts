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
    expect(changes.find((change) => change.name === 'Subject')!.strokeDashes).toEqual([4, 2]);
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
    // MEASURED: no fixture schema keeps it, even though the exporter writes
    // `strokeDashes` into the message. So the loss is NOT schema-dependent — the
    // compat table's ✅ for "dash pattern" is FALSE and must be corrected. This
    // assertion pins the defect: fixing it flips this test.
    const kept = Object.entries(results).filter(([, value]) => value).map(([name]) => name);
    expect(Object.keys(results)).toHaveLength(4);
    expect(
      kept,
      `dashPattern now survives through: ${kept.join(', ')} — the loss is fixed, update this test and the compat row`,
    ).toEqual([]);
  });
});
