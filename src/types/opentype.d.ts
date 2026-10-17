/**
 * The slice of opentype.js (2.x) that Pigma uses: parse a font and read per-glyph
 * outlines. The package ships no typings, so this declares only what is called.
 */
declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'C' | 'Q' | 'Z';
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  export interface Path {
    commands: PathCommand[];
  }

  export interface Glyph {
    /** Glyph index in the font; 0 is the missing-glyph box, used when the font lacks a character. */
    index: number;
    advanceWidth: number;
    getPath(x: number, y: number, fontSize: number): Path;
  }

  export interface Font {
    unitsPerEm: number;
    /** Decoration metrics, in font units (negative underline position is below the baseline). */
    tables: {
      post: { underlinePosition: number; underlineThickness: number };
      os2: { yStrikeoutPosition: number; yStrikeoutSize: number };
    };
    charToGlyph(char: string): Glyph;
  }

  export function parse(buffer: ArrayBuffer): Font;
}
