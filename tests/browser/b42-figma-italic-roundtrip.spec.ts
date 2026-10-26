import { test, expect } from '@playwright/test';
import { mapNativeTextStyle, mapRestTextStyle } from '../../src/figma/convert/mappers';
import { wireFontStyle } from '../../src/figma/native/modelExport';
import { ReportBuilder } from '../../src/figma/convert/report';
import type { TextStyle } from '../../src/model/types';

/**
 * Italic face round-trip on BOTH import paths.
 *
 * The chain under test is the real one: an imported face name -> the mapper ->
 * the stored TextStyle -> the native exporter. A face that survives import but
 * is flattened on export is still a loss, so each case asserts BOTH halves: the
 * numeric weight that is read back, and the face name written on export.
 *
 * Runs in Node against the real modules - no app, no browser.
 */
const ctx = () => ({ report: new ReportBuilder(), nodeId: 'n', path: 'n' });

/** The full import -> store -> export chain for a native face name. */
function nativeRoundTrip(styleName: string): { weight: number | undefined; face: string } {
  const mapped = mapNativeTextStyle(
    { type: 'TEXT', name: 'n', fontName: { family: 'Inter', style: styleName } } as never,
    ctx(),
  );
  return { weight: mapped.fontWeight, face: wireFontStyle(mapped) };
}

/** The same chain for the REST payload shape. */
function restRoundTrip(style: Record<string, unknown>): { weight: number | undefined; face: string } {
  const mapped: TextStyle = mapRestTextStyle(style as never, ctx());
  return { weight: mapped.fontWeight, face: wireFontStyle(mapped) };
}

test('B42a native "Book Italic" round-trips as Book Italic, reading back at 400', () => {
  const result = nativeRoundTrip('Book Italic');
  expect(result.weight, '"Book Italic" did not read back as regular weight 400').toBe(400);
  expect(result.face, '"Book Italic" was flattened on export').toBe('Book Italic');
});

test('B42b native "Semi Bold Oblique" keeps its 600 weight', () => {
  const result = nativeRoundTrip('Semi Bold Oblique');
  // The required invariant here is the WEIGHT (600). The spelling is normalized
  // on export - "Oblique" is written as "Italic", which is the same face under
  // the other name Figma uses - so only the weight is asserted exactly.
  expect(result.weight, '"Semi Bold Oblique" lost its semi-bold weight').toBe(600);
  expect(result.face, 'the semi-bold slant was flattened away entirely').toMatch(/Italic|Oblique/);
  expect(result.face).toContain('Semi Bold');
});

test('B42c REST "Book Italic" round-trips as Book Italic, reading back at 400', () => {
  const result = restRoundTrip({ fontFamily: 'Inter', fontSize: 12, fontStyle: 'Book Italic' });
  // FIXED. This test previously pinned a defect: `mapRestTextStyle` set only
  // `fontStyle`, so the weight was `undefined` and the face could not be rebuilt.
  // It now reads the weight from the face name through the same table the native
  // path uses.
  expect(result.weight, 'REST "Book Italic" did not read back as weight 400').toBe(400);
  expect(result.face, 'REST "Book Italic" was flattened on export').toBe('Book Italic');
});

test('B42d REST "Semi Bold Oblique" keeps its 600 weight', () => {
  const result = restRoundTrip({ fontFamily: 'Inter', fontSize: 12, fontStyle: 'Semi Bold Oblique' });
  expect(result.weight, 'REST "Semi Bold Oblique" lost its semi-bold weight').toBe(600);
  // The required invariant is the WEIGHT (600). With the weight now known the
  // face is derived, and "Oblique" is written as "Italic" - the same face under
  // the other name the wire format uses - matching the native path in B42b.
  expect(result.face, 'the semi-bold slant was flattened away').toMatch(/Semi Bold (Italic|Oblique)/);
});

test('B42e REST derives the same face AND weight from a PostScript name', () => {
  const italic = restRoundTrip({ fontFamily: 'Inter', fontSize: 12, fontPostScriptName: 'Inter-BookItalic' });
  expect(italic.face, 'the PostScript face was not parsed').toBe('Book Italic');
  expect(italic.weight, 'a PostScript book italic did not read back as 400').toBe(400);

  const semi = restRoundTrip({ fontFamily: 'Inter', fontSize: 12, fontPostScriptName: 'Inter-SemiBoldOblique' });
  expect(semi.weight, 'a PostScript semi-bold oblique lost its weight').toBe(600);
  expect(semi.face, 'the PostScript semi-bold slant was flattened').toMatch(/Semi Bold (Italic|Oblique)/);
});

test('B42f an italic flag alone still marks the slant and reads back at 400', () => {
  const result = restRoundTrip({ fontFamily: 'Inter', fontSize: 12, italic: true });
  expect(result.weight).toBe(400);
  expect(result.face, 'an italic-flagged REST style imported as upright').toBe('Italic');
});
