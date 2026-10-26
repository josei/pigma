import { describe, expect, it } from 'vitest';
import { parseFile, serializeFile } from './serialize';
import { emptyFile } from './validate';
import {
  JSON_MIME,
  PIGMA_ACCEPT,
  PIGMA_EXTENSION,
  PIGMA_FILE_TYPES,
  PIGMA_FORMAT,
  PIGMA_MIME,
  isNativePigmaFileName,
  isPigmaFileName,
  pigmaFileName,
} from './format';

describe('native document format', () => {
  it('names the format once: extension, media type, schema tag', () => {
    expect(PIGMA_EXTENSION).toBe('.pigma');
    expect(PIGMA_MIME).toBe('application/vnd.pigma+json');
    // The metadata tag is the same discriminator the file carries.
    expect(PIGMA_FORMAT).toBe(emptyFile('x').schema);
    // The pickers offer the native type first and the legacy one second.
    expect(PIGMA_FILE_TYPES[0]!.accept).toEqual({ [PIGMA_MIME]: [PIGMA_EXTENSION] });
    expect(PIGMA_FILE_TYPES[1]!.accept).toEqual({ [JSON_MIME]: ['.json'] });
    expect(PIGMA_ACCEPT).toBe('.pigma,application/json,.json');
  });

  it('suggests a native name and keeps one the user already chose', () => {
    expect(pigmaFileName('Homepage')).toBe('Homepage.pigma');
    expect(pigmaFileName('My design')).toBe('My-design.pigma');
    expect(pigmaFileName('Brand v2.json')).toBe('Brand-v2.json');
    expect(pigmaFileName('Brand v2.pigma')).toBe('Brand-v2.pigma');
    expect(pigmaFileName('   ')).toBe('pigma.pigma');
  });

  it('accepts both extensions, because the schema decides', () => {
    expect(isPigmaFileName('design.pigma')).toBe(true);
    expect(isPigmaFileName('design.json')).toBe(true);
    expect(isPigmaFileName('design.fig')).toBe(false);
    expect(isPigmaFileName('design')).toBe(false);
    expect(isNativePigmaFileName('design.pigma')).toBe(true);
    expect(isNativePigmaFileName('design.json')).toBe(false);
  });

  it('reads a document by its schema, never by its name', () => {
    // The same bytes are a document under either extension: nothing about the
    // file name decides what the importer does.
    const file = emptyFile('Legacy');
    const text = serializeFile(file);
    const parsed = parseFile(text);
    expect(parsed.file?.name).toBe('Legacy');
    expect((JSON.parse(text) as { schema: string }).schema).toBe(PIGMA_FORMAT);
    expect(isPigmaFileName('Legacy.pigma') && isPigmaFileName('Legacy.json')).toBe(true);

    // A JSON that is not a Pigma document is rejected on its shape, not its name.
    const notADocument = parseFile(JSON.stringify({ schema: PIGMA_FORMAT, hello: 'world' }));
    expect(notADocument.file).toBeNull();
    expect(notADocument.errors.join(' ')).toMatch(/document/i);
  });
});
