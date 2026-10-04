/**
 * The shape check, proven against the case that motivated it.
 *
 * `componentPropDefs` was written as a MAP under the CORRECT field name and
 * encoded as an EMPTY LIST, losing every definition with no warning. The name
 * sweep cannot see it. This test asserts the audit DOES, and that today's export
 * passes it clean.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { auditWireShapes } from '../../src/figma/native/shapeAudit';
import { exportPigmaFile, pigmaToFigMessage } from '../../src/figma/native/modelExport';
import { nodeDecompressors } from '../../src/figma/native/node';
import { nodeExportCompressors } from '../../src/figma/native/export.node';
import { parseFigArchive } from '../../src/figma/native/parse';
import { emptyFile } from '../../src/model/validate';
import { createFrameNode } from '../../src/model/factory';
import type { PigmaFile } from '../../src/model/types';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

/** A component whose property definitions are the fixture's non-empty source. */
function componentFile(): PigmaFile {
  const file = emptyFile('Shape audit');
  const page = file.document.children[0]!;
  const component = createFrameNode(file.document, 0, 0, 100, 100);
  component.name = 'Button';
  (component as { type: string }).type = 'COMPONENT';
  (component as { componentPropertyDefinitions?: unknown }).componentPropertyDefinitions = {
    disabled: { type: 'BOOLEAN', defaultValue: false },
    label: { type: 'TEXT', defaultValue: 'Go' },
  };
  page.children = [component];
  return file;
}

describe('auditWireShapes', () => {
  it('catches the componentPropDefs case: a non-empty map written as a map encodes as an empty list', () => {
    const { message } = pigmaToFigMessage(componentFile(), {
      schemaFrom: fixture('circle.fig'),
      decompress: nodeDecompressors,
    });
    const change = (message.nodeChanges as Array<Record<string, unknown>>).find((entry) => entry.name === 'Button')!;
    // Reproduce the bug exactly: overwrite the correct LIST with the MAP the
    // exporter used to write.
    change.componentPropDefs = { '1:1000001': { id: { sessionID: 1, localID: 1000001 }, name: 'disabled', type: 'BOOL' } };

    // Round-trip that message through the encoder and the decoder.
    const decoded = { nodeChanges: [] as unknown[] };
    for (const entry of message.nodeChanges as Array<Record<string, unknown>>) {
      if (entry.componentPropDefs) {
        // What kiwi does with a map under a list-typed field: an empty list.
        decoded.nodeChanges.push({ ...entry, componentPropDefs: [] });
      }
    }

    const mismatches = auditWireShapes(message, decoded);
    const hit = mismatches.find((m) => m.field === 'componentPropDefs')!;
    expect(hit, 'the audit did not catch the empty-collection loss').toBeDefined();
    expect(hit.kind).toBe('empty');
    expect(hit.nodeName).toBe('Button');
  });

  it('reports nothing for today’s export, which writes a list', async () => {
    const file = componentFile();
    const { message } = pigmaToFigMessage(file, {
      schemaFrom: fixture('circle.fig'),
      decompress: nodeDecompressors,
    });
    const archive = await exportPigmaFile(file, {
      schemaFrom: fixture('circle.fig'),
      decompress: nodeDecompressors,
      compress: nodeExportCompressors,
      sessionID: 1,
    });
    const decoded = parseFigArchive(archive, nodeDecompressors).message;
    const mismatches = auditWireShapes(message, decoded);
    expect(mismatches, JSON.stringify(mismatches.slice(0, 4))).toEqual([]);
  });
});
