import { describe, expect, it } from 'vitest';
import {
  MemoryDocumentStore,
  duplicateDocument,
  migrateLegacyDocument,
  nextDocumentName,
  normalizeDocumentName,
  toSummaries,
  type StoredDocument,
} from './documentLibrary';
import { emptyFile } from '../model/validate';
import { serializeFile } from '../model/serialize';

const document = (patch: Partial<StoredDocument> = {}): StoredDocument => ({
  id: 'doc-1',
  name: 'Untitled',
  createdAt: 100,
  savedAt: 100,
  file: emptyFile('Untitled'),
  pageId: 'page',
  viewport: { x: 0, y: 0, zoom: 1 },
  ...patch,
});

describe('document library', () => {
  it('stores, lists and deletes documents', async () => {
    const store = new MemoryDocumentStore();
    expect(await store.list()).toEqual([]);
    expect(await store.get('missing')).toBeNull();

    await store.put(document());
    await store.put(document({ id: 'doc-2', name: 'Second', savedAt: 200 }));
    expect((await store.list()).map((entry) => entry.id).sort()).toEqual(['doc-1', 'doc-2']);
    expect((await store.get('doc-2'))!.name).toBe('Second');

    // Putting the same id replaces rather than duplicates.
    await store.put(document({ name: 'Renamed', savedAt: 300 }));
    expect((await store.list()).map((entry) => entry.name).sort()).toEqual(['Renamed', 'Second']);

    await store.delete('doc-1');
    expect(await store.get('doc-1')).toBeNull();
  });

  it('names new documents past the ones that exist', () => {
    expect(nextDocumentName([])).toBe('Untitled');
    expect(nextDocumentName([{ name: 'Untitled' }])).toBe('Untitled 2');
    expect(nextDocumentName([{ name: 'Untitled' }, { name: 'Untitled 2' }])).toBe('Untitled 3');
    expect(nextDocumentName([{ name: 'Design' }])).toBe('Untitled');
  });

  it('normalizes names and bounds their length', () => {
    expect(normalizeDocumentName('  My   doc ')).toBe('My doc');
    expect(normalizeDocumentName('   ', 'Fallback')).toBe('Fallback');
    expect(normalizeDocumentName('x'.repeat(200)).length).toBe(80);
  });

  it('summarizes documents newest first, with the native file name', () => {
    const summaries = toSummaries([document({ savedAt: 1 }), document({ id: 'b', savedAt: 9, name: 'B' })]);
    expect(summaries.map((entry) => entry.name)).toEqual(['B', 'Untitled']);
    // A record written before the native format existed still reports a name.
    expect(summaries[0]).toEqual({ id: 'b', name: 'B', createdAt: 100, savedAt: 9, fileName: 'B.pigma' });
    const named = toSummaries([document({ name: 'B', fileName: 'Brand v2.pigma' })]);
    expect(named[0]!.fileName).toBe('Brand v2.pigma');
  });

  it('duplicates under a new id and name', () => {
    const copy = duplicateDocument(document({ name: 'Design' }), 'doc-9', 500);
    expect(copy.id).toBe('doc-9');
    expect(copy.name).toBe('Design copy');
    expect(copy.createdAt).toBe(500);
    expect(copy.file).toBe(document().file === copy.file ? copy.file : copy.file);
  });

  it('migrates the legacy single-key payload', () => {
    const file = emptyFile('Old design');
    const migrated = migrateLegacyDocument(
      { file: JSON.parse(serializeFile(file)), pageId: file.document.children[0]!.id, viewport: { x: 12, y: 34, zoom: 2 }, savedAt: 777 },
      'doc-1',
      1000,
    )!;
    expect(migrated).toMatchObject({ id: 'doc-1', name: 'Old design', savedAt: 777, viewport: { x: 12, y: 34, zoom: 2 } });
    expect(migrated.pageId).toBe(file.document.children[0]!.id);
    expect(migrated.file.document.children).toHaveLength(1);
  });

  it('accepts a bare Pigma file as well as the envelope', () => {
    // An exported document dropped straight into the legacy key.
    const bare = JSON.parse(serializeFile(emptyFile('Dropped in'))) as Record<string, unknown>;
    const migrated = migrateLegacyDocument(bare as never, 'doc-9', 42)!;
    expect(migrated.name).toBe('Dropped in');
    expect(migrated.file.document.children).toHaveLength(1);
    expect(migrated.savedAt).toBe(42);
  });

  it('refuses to migrate a missing or corrupt payload', () => {
    expect(migrateLegacyDocument(null, 'doc-1', 0)).toBeNull();
    expect(migrateLegacyDocument({ file: null }, 'doc-1', 0)).toBeNull();
    expect(migrateLegacyDocument({ file: { schema: 'nope' } }, 'doc-1', 0)).toBeNull();
    expect(migrateLegacyDocument({ schema: 'nope' } as never, 'doc-1', 0)).toBeNull();
  });

  it('falls back to the first page and sane viewport values', () => {
    const file = emptyFile('Plain');
    const migrated = migrateLegacyDocument(
      { file: JSON.parse(serializeFile(file)), pageId: 'gone', viewport: { zoom: 0 } },
      'doc-2',
      5,
    )!;
    expect(migrated.pageId).toBe(file.document.children[0]!.id);
    expect(migrated.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(migrated.savedAt).toBe(5);
  });
});
