import { test, expect } from '@playwright/test';
import { pigmaToFigMessage, type ModelExportOptions } from '../../src/figma/native/modelExport';
import { emptyFile } from '../../src/model/validate';
import { createComponentNode, createRectNode, createTextNode } from '../../src/model/factory';
import type { ComponentNode, ContainerNode, SceneNode } from '../../src/model/types';

/**
 * Backs the "test-backed" rows of docs/FIGMA_COMPAT.md.
 *
 * These exercise the real export path (`pigmaToFigMessage`) against the actual
 * model factories — no app, no browser — so a row of the compat matrix is
 * evidence rather than a reading of the source. They live here rather than in
 * src/ because tests/browser is the QA track's tree.
 */

function exportOptions(extra: Partial<ModelExportOptions> = {}): ModelExportOptions {
  return {
    schemaFrom: new Uint8Array([1, 2, 3]),
    decompress: { inflateRaw: (bytes) => bytes, zstd: (bytes) => bytes },
    ...extra,
  };
}

function changesFor(file: Parameters<typeof pigmaToFigMessage>[0]) {
  const { message } = pigmaToFigMessage(file, exportOptions());
  return message.nodeChanges as Array<Record<string, unknown>>;
}

test('B38a a COMPONENT_SET loses its type on export: it is written as SYMBOL', () => {
  const file = emptyFile('Lossy');
  const page = file.document.children[0] as unknown as ContainerNode;
  const master = createRectNode(null, 0, 0, 40, 40);
  page.children = [master];

  // Promote it to a component, then to a component set (variants).
  const component = createComponentNode(file.document, master) as ComponentNode;
  const set: ComponentNode = {
    ...component,
    type: 'COMPONENT_SET',
    id: `${component.id}-set`,
    name: 'Button',
    children: [{ ...component, id: `${component.id}-child`, parent: null } as SceneNode],
  };
  file.document.children[0] = { ...page, children: [set] } as unknown as typeof file.document.children[0];

  const changes = changesFor(file);
  const emitted = changes.find((change) => change.name === 'Button');
  expect(emitted, 'the component set was not exported at all').toBeDefined();

  // The documented loss: the wire format has no COMPONENT_SET, so it is written
  // as SYMBOL and reads back as a plain COMPONENT. Assert the loss, not a wish.
  expect(emitted!.type).toBe('SYMBOL');
  expect(emitted!.type).not.toBe('COMPONENT_SET');
});

test('B38b a bold weight exports a bold face, and a between-step weight snaps', () => {
  const file = emptyFile('Weights');
  const page = file.document.children[0] as unknown as ContainerNode;
  // Distinct names matter: `createTextNode(null, ...)` auto-names every node
  // "Text 1", so a name lookup would silently return the first one.
  const known = createTextNode(null, 0, 0, 'Regular', { fontFamily: 'Inter', fontWeight: 400 });
  known.name = 'Known weight';
  const bold = createTextNode(null, 0, 60, 'Bold', { fontFamily: 'Inter', fontWeight: 700 });
  bold.name = 'Bold weight';
  const italic = createTextNode(null, 0, 120, 'Italic', { fontFamily: 'Inter', fontWeight: 400, fontStyle: 'italic' });
  italic.name = 'Italic face';
  const boldItalic = createTextNode(null, 0, 180, 'Bold italic', { fontFamily: 'Inter', fontWeight: 700, fontStyle: 'italic' });
  boldItalic.name = 'Bold italic face';
  // 650 sits between 600 and 700; it must snap to a declared step.
  const between = createTextNode(null, 0, 240, 'In between', { fontFamily: 'Inter', fontWeight: 650 });
  between.name = 'Between-step weight';
  page.children = [known, bold, italic, boldItalic, between];

  const changes = changesFor(file);
  const fontName = (name: string) =>
    changes.find((change) => change.name === name)!.fontName as { family: string; style: string };

  // FIXED. This test previously pinned a defect: the export read
  //   style.fontStyle ?? WEIGHT_STYLES[style.fontWeight]
  // and `defaultTextStyle` always sets fontStyle, so the `??` never fell
  // through and a bold node exported as "Regular" (the weight table was dead
  // code). `wireFontStyle` now derives the face from the WEIGHT, treating
  // 'normal'/'Regular'/empty as generic.
  expect(fontName(bold.name).style, 'bold text must export as Bold').toBe('Bold');
  expect(fontName(known.name).style).toBe('Regular');
  expect(fontName(italic.name).style).toBe('Italic');
  expect(fontName(boldItalic.name).style).toBe('Bold Italic');

  // A between-step weight snaps to the nearest declared step instead of
  // vanishing to ''. 650 ties between 600 and 700; the reducer keeps the first
  // closest step, so the face is 'Semi Bold'.
  expect(fontName(between.name).style, 'a between-step weight must snap, not vanish').toBe('Semi Bold');
  expect(fontName(between.name).style).not.toBe('');
});
