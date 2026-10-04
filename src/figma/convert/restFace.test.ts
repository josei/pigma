import { describe, expect, it } from 'vitest';
import { mapNativeTextStyle, mapRestTextStyle, restFaceName, weightFromFaceName } from './mappers';
import { ReportBuilder } from './report';
import { wireFontStyle } from '../native/modelExport';

const ctx = () => ({ report: new ReportBuilder(), nodeId: 'n', path: 'n' });

/**
 * The REST import path's face handling.
 *
 * The native path (src/figma/native/modelExport.ts + mappers.mapNativeTextStyle)
 * was fixed first; this covers the other half, so a REST-imported "Book Italic"
 * keeps its face and its weight and can round-trip through an export.
 */
describe('REST text faces', () => {
  it('keeps a named face, derives one from a PostScript name, and honours the italic flag', () => {
    expect(restFaceName({ fontStyle: 'Book Italic' })).toBe('Book Italic');
    expect(restFaceName({ fontPostScriptName: 'Inter-BookItalic' })).toBe('Book Italic');
    expect(restFaceName({ fontPostScriptName: 'Inter-SemiBold' })).toBe('Semi Bold');
    expect(restFaceName({ fontPostScriptName: 'Inter_ExtraLight' })).toBe('Extra Light');
    // A plain Regular adds nothing the weight does not already say.
    expect(restFaceName({ fontPostScriptName: 'Inter-Regular' })).toBeNull();
    expect(restFaceName({ italic: true })).toBe('Italic');
    expect(restFaceName({})).toBeNull();
  });

  it('derives the WEIGHT from the face name, not just the name', () => {
    // The name alone is not enough: the editor reads the weight to draw and
    // export the face, so a REST payload that carries no numeric weight must get
    // one from the same table the native path uses.
    expect(weightFromFaceName('Book Italic')).toBe(400);
    expect(weightFromFaceName('Semi Bold Oblique')).toBe(600);
    expect(weightFromFaceName('Bold Oblique')).toBe(700);
    expect(weightFromFaceName('Thin')).toBe(100);
    expect(weightFromFaceName('Italic')).toBe(400);
    expect(weightFromFaceName('Display')).toBeNull();
    expect(weightFromFaceName('')).toBeNull();

    // The pinned cases, through the REST mapping itself.
    const book = mapRestTextStyle({ fontFamily: 'Inter', fontStyle: 'Book Italic' }, ctx());
    expect(book.fontStyle).toBe('Book Italic');
    expect(book.fontWeight, 'a REST "Book Italic" imported without a weight').toBe(400);

    const oblique = mapRestTextStyle({ fontFamily: 'Inter', fontStyle: 'Semi Bold Oblique' }, ctx());
    expect(oblique.fontWeight, 'a REST "Semi Bold Oblique" lost its 600').toBe(600);

    const postScript = mapRestTextStyle({ fontFamily: 'Inter', fontPostScriptName: 'Inter-SemiBoldOblique' }, ctx());
    expect(postScript.fontStyle).toBe('Semi Bold Oblique');
    expect(postScript.fontWeight).toBe(600);

    const flag = mapRestTextStyle({ fontFamily: 'Inter', italic: true }, ctx());
    expect(flag.fontStyle).toBe('Italic');
    expect(flag.fontWeight).toBe(400);

    // A numeric weight in the payload still wins: it is the more precise answer.
    expect(mapRestTextStyle({ fontFamily: 'Inter', fontStyle: 'Book Italic', fontWeight: 500 }, ctx()).fontWeight).toBe(500);
  });

  it('round-trips a REST-imported "Book Italic" through the native export', () => {
    const style = mapRestTextStyle({ fontFamily: 'Inter', fontStyle: 'Book Italic', fontWeight: 400 }, ctx());
    expect(style.fontStyle).toBe('Book Italic');
    // The face survives the export, and the importer reads its weight back.
    expect(wireFontStyle(style)).toBe('Book Italic');
    const readBack = mapNativeTextStyle(
      { type: 'TEXT', fontName: { family: 'Inter', style: 'Book Italic' } } as never,
      ctx(),
    );
    expect(readBack.fontWeight).toBe(400);
  });

  it('does not lose a slant that arrives only as a flag', () => {
    const style = mapRestTextStyle({ fontFamily: 'Inter', italic: true }, ctx());
    expect(style.fontStyle).toBe('Italic');
    expect(wireFontStyle(style)).toBe('Italic');
    // A slant alone is not a weight.
    expect(style.fontWeight).toBe(400);
  });
});
