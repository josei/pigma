import { describe, expect, it } from 'vitest';
import { pigmaToFigMessage, wireFontStyle } from './modelExport';
import { emptyFile } from '../../model/validate';
import { createFrameNode, createRectNode, createTextNode, defaultTextStyle } from '../../model/factory';
import { booleanNodes } from '../../model/boolean';
import { mapNativeTextStyle } from '../convert/mappers';
import { ReportBuilder } from '../convert/report';
import type { ContainerNode, SceneNode } from '../../model/types';
import type { ModelExportOptions } from './modelExport';

/** `pigmaToFigMessage` only needs the schema/decompressors to encode the file. */
function exportOptions(extra: Partial<ModelExportOptions> = {}): ModelExportOptions {
  return {
    schemaFrom: new Uint8Array([1, 2, 3]),
    decompress: { inflateRaw: (bytes) => bytes, zstd: (bytes) => bytes },
    ...extra,
  };
}

describe('native export of prototype/variable metadata', () => {
  it('writes the boolean operation, scrolling and variable bindings', () => {
    const file = emptyFile('Export');
    const page = file.document.children[0]!;
    const a = createRectNode(null, 0, 0, 100, 100);
    const b = createRectNode(null, 50, 50, 100, 100);
    const frame = createFrameNode(null, 300, 0, 200, 200, { name: 'Scroller' });
    (frame as SceneNode & { overflowDirection?: string }).overflowDirection = 'VERTICAL_SCROLLING';
    const bound = createRectNode(null, 320, 20, 100, 100);
    bound.name = 'Bound rect';
    (bound as SceneNode & { boundVariables?: Record<string, string> }).boundVariables = { fill: 'v-brand', cornerRadius: 'v-radius' };
    frame.children = [bound];
    page.children = [a, b, frame];

    const union = booleanNodes(file, [a.id, b.id], 'SUBTRACT');
    const withBoolean = union.file;
    const boolean = withBoolean.document.children[0]!.children[0] as ContainerNode;

    const { message, warnings } = pigmaToFigMessage(withBoolean, exportOptions({ sessionID: 7 }));
    const changes = message.nodeChanges as Array<Record<string, unknown>>;
    const byName = (name: string) => changes.find((change) => change.name === name)!;

    expect(byName(boolean.name).booleanOperation).toBe('SUBTRACT');
    expect(byName('Scroller').overflowDirection).toBe('VERTICAL_SCROLLING');
    expect(byName('Scroller').frameMaskDisabled).toBe(false);
    expect(byName('Bound rect').variableBindings).toEqual({
      fills: { type: 'VARIABLE_ALIAS', id: 'v-brand' },
      cornerRadius: { type: 'VARIABLE_ALIAS', id: 'v-radius' },
    });
    expect(warnings).toEqual([]);
  });

  it('omits the fields when the model has nothing to say', () => {
    const file = emptyFile('Plain');
    const page = file.document.children[0]!;
    page.children = [createRectNode(null, 0, 0, 10, 10)];
    const { message } = pigmaToFigMessage(file, exportOptions());
    const changes = message.nodeChanges as Array<Record<string, unknown>>;
    const rect = changes.find((change) => change.type === 'RECTANGLE')!;
    expect(rect.booleanOperation).toBeUndefined();
    expect(rect.overflowDirection).toBeUndefined();
    expect(rect.variableBindings).toBeUndefined();
  });
});

describe('native export of text faces', () => {
  it('derives the face from the weight, not from a generic fontStyle', () => {
    // The editor always stores a fontStyle: the factory writes "Regular" and the
    // style controls write "normal" for bold. Neither describes the weight.
    expect(wireFontStyle(defaultTextStyle())).toBe('Regular');
    expect(wireFontStyle({ fontStyle: 'normal', fontWeight: 700 })).toBe('Bold');
    expect(wireFontStyle({ fontStyle: 'Regular', fontWeight: 700 })).toBe('Bold');
    expect(wireFontStyle({ fontStyle: 'normal', fontWeight: 400 })).toBe('Regular');
    expect(wireFontStyle({ fontStyle: 'italic', fontWeight: 400 })).toBe('Italic');
    expect(wireFontStyle({ fontStyle: 'italic', fontWeight: 700 })).toBe('Bold Italic');
    expect(wireFontStyle({ fontStyle: 'Italic', fontWeight: 600 })).toBe('Semi Bold Italic');
    // Weights between the documented steps snap to the nearest face.
    expect(wireFontStyle({ fontStyle: 'normal', fontWeight: 650 })).toBe('Semi Bold');
    expect(wireFontStyle({ fontWeight: 900 })).toBe('Black');
    // A descriptive name from an import is kept as it was written — including a
    // descriptive *italic* face, which must not be flattened to the weight's face.
    expect(wireFontStyle({ fontStyle: 'Semi Bold', fontWeight: 600 })).toBe('Semi Bold');
    expect(wireFontStyle({ fontStyle: 'Book', fontWeight: 400 })).toBe('Book');
    expect(wireFontStyle({ fontStyle: 'Book Italic', fontWeight: 400 })).toBe('Book Italic');
    expect(wireFontStyle({ fontStyle: 'Display Italic', fontWeight: 700 })).toBe('Display Italic');
    // ...while a face the derivation reproduces exactly is written as derived, so
    // the stored name never has to agree with the weight.
    expect(wireFontStyle({ fontStyle: 'Bold Italic', fontWeight: 700 })).toBe('Bold Italic');
    expect(wireFontStyle({ fontStyle: 'Semi Bold Italic', fontWeight: 600 })).toBe('Semi Bold Italic');
    // "Oblique" is the other spelling of the same slant: it is written back as the
    // format's own name for it, and the weight is still derived.
    expect(wireFontStyle({ fontStyle: 'Oblique', fontWeight: 400 })).toBe('Italic');
    expect(wireFontStyle({ fontStyle: 'Bold Oblique', fontWeight: 700 })).toBe('Bold Italic');
  });

  it('round-trips a descriptive italic face and an oblique one', () => {
    const ctx = { report: new ReportBuilder(), nodeId: 'n', path: 'n' };
    const readBack = (style: string) =>
      mapNativeTextStyle({ type: 'TEXT', fontName: { family: 'Inter', style } } as never, ctx).fontWeight;

    // "Book Italic" keeps both halves: the face survives the export, and the
    // weight still comes back (Book is a documented 400).
    expect(wireFontStyle({ fontStyle: 'Book Italic', fontWeight: 400 })).toBe('Book Italic');
    expect(readBack('Book Italic')).toBe(400);
    // "Semi Bold Oblique" keeps its 600: the importer strips the oblique suffix.
    expect(readBack('Semi Bold Oblique')).toBe(600);
    expect(readBack('Bold Oblique')).toBe(700);
    expect(readBack('Thin Oblique')).toBe(100);
  });

  it('exports a bold node with a bold face name, and it round-trips', () => {
    const file = emptyFile('Faces');
    const page = file.document.children[0]!;
    // Exactly what the style controls write: the weight carries the face, and
    // `fontStyle` only records the italic flag.
    const bold = { ...createTextNode(null, 0, 0, 'Bold text', { fontWeight: 700, fontStyle: 'normal' }), name: 'Bold text' };
    const italic = { ...createTextNode(null, 0, 60, 'Italic text', { fontWeight: 400, fontStyle: 'italic' }), name: 'Italic text' };
    const boldItalic = { ...createTextNode(null, 0, 120, 'Both', { fontWeight: 700, fontStyle: 'italic' }), name: 'Both' };
    page.children = [bold, italic, boldItalic];

    const { message } = pigmaToFigMessage(file, exportOptions());
    const changes = message.nodeChanges as Array<Record<string, unknown>>;
    const faceOf = (name: string) => (changes.find((change) => change.name === name)!.fontName as { style: string }).style;
    expect(faceOf('Bold text')).toBe('Bold');
    expect(faceOf('Italic text')).toBe('Italic');
    expect(faceOf('Both')).toBe('Bold Italic');

    // ...and the name round-trips: the importer reads the face back into the
    // weight it came from, which is the whole point of writing a real face name.
    const ctx = { report: new ReportBuilder(), nodeId: 'n', path: 'n' };
    const readBack = (style: string) =>
      mapNativeTextStyle({ type: 'TEXT', fontName: { family: 'Inter', style } } as never, ctx).fontWeight;
    expect(readBack('Bold')).toBe(700);
    // Italic is the slant, not the weight: it reads back as regular weight, so
    // the editor's face selector shows "Italic" and not "Bold Italic".
    expect(readBack('Italic')).toBe(400);
    expect(readBack('Bold Italic')).toBe(700);
    expect(readBack('Semi Bold')).toBe(600);
    expect(readBack('Black')).toBe(900);
    // Every documented face maps back to its own weight.
    for (const [weight, name] of Object.entries({
      100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular',
      500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black',
    })) {
      expect(wireFontStyle({ fontStyle: 'normal', fontWeight: Number(weight) })).toBe(name);
      expect(readBack(name)).toBe(Number(weight));
    }
  });
});
