import type { Library } from '../model/library';
import type { PigmaFile } from '../model/types';
import { validatePigmaFile } from '../model/validate';
import { PIGMA_FORMAT, pigmaFileName } from '../model/format';
import type { PluginRecord } from '../plugins/registry';

/**
 * Local document library (P5).
 *
 * Pigma keeps many named documents in IndexedDB instead of one localStorage key.
 * The storage itself sits behind {@link DocumentStore} so the same logic runs
 * against IndexedDB in the browser and an in-memory map in tests.
 */

export interface StoredDocument {
  id: string;
  name: string;
  createdAt: number;
  savedAt: number;
  /** Serialized PigmaFile (schema-validated on read). */
  file: PigmaFile;
  /**
   * The format this record was written as. Always `pigma/1` for new records;
   * absent on records written before the native format existed, which is why
   * readers treat a missing value as the current format rather than rejecting it.
   */
  format?: typeof PIGMA_FORMAT;
  /** The file name this document exports under (native `.pigma`). */
  fileName?: string;
  pageId: string;
  viewport: { x: number; y: number; zoom: number };
  /** Published libraries, side panel widths and user plugins (M9/M11/M15). */
  libraries?: Library[];
  panelWidths?: { left: number; right: number };
  plugins?: PluginRecord[];
}

export interface DocumentSummary {
  id: string;
  name: string;
  createdAt: number;
  savedAt: number;
  /** Native file name for this document, when the record carries one. */
  fileName?: string;
}

/** The storage adapter. Implementations must never throw on a missing record. */
export interface DocumentStore {
  list(): Promise<StoredDocument[]>;
  get(id: string): Promise<StoredDocument | null>;
  put(document: StoredDocument): Promise<void>;
  delete(id: string): Promise<void>;
}

/** In-memory adapter: used by tests and as a last-resort fallback. */
export class MemoryDocumentStore implements DocumentStore {
  private readonly documents = new Map<string, StoredDocument>();

  async list(): Promise<StoredDocument[]> {
    return [...this.documents.values()];
  }

  async get(id: string): Promise<StoredDocument | null> {
    return this.documents.get(id) ?? null;
  }

  async put(document: StoredDocument): Promise<void> {
    this.documents.set(document.id, document);
  }

  async delete(id: string): Promise<void> {
    this.documents.delete(id);
  }
}

export const DOCUMENT_DB_NAME = 'pigma';
export const DOCUMENT_DB_VERSION = 1;
export const DOCUMENT_STORE = 'documents';

/** IndexedDB adapter. Opens lazily; a failed open degrades to memory. */
export class IndexedDbDocumentStore implements DocumentStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private fallback: MemoryDocumentStore | null = null;

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DOCUMENT_DB_NAME, DOCUMENT_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
          db.createObjectStore(DOCUMENT_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open the document database'));
    });
    return this.dbPromise;
  }

  private async withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    try {
      const db = await this.open();
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(DOCUMENT_STORE, mode);
        const request = run(transaction.objectStore(DOCUMENT_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Document store request failed'));
      });
    } catch {
      // A browser without usable IndexedDB (private mode, disabled storage) still
      // gets a working session: the library degrades to memory.
      this.fallback ??= new MemoryDocumentStore();
      return null;
    }
  }

  async list(): Promise<StoredDocument[]> {
    if (this.fallback) return this.fallback.list();
    const result = await this.withStore<StoredDocument[]>('readonly', (store) => store.getAll() as IDBRequest<StoredDocument[]>);
    if (result === null) return this.fallback!.list();
    return result.filter(isStoredDocument);
  }

  async get(id: string): Promise<StoredDocument | null> {
    if (this.fallback) return this.fallback.get(id);
    const result = await this.withStore<StoredDocument>('readonly', (store) => store.get(id) as IDBRequest<StoredDocument>);
    if (result === null) return this.fallback!.get(id);
    return isStoredDocument(result) ? result : null;
  }

  async put(document: StoredDocument): Promise<void> {
    if (this.fallback) return this.fallback.put(document);
    const result = await this.withStore<IDBValidKey>('readwrite', (store) => store.put(document));
    if (result === null) await this.fallback!.put(document);
  }

  async delete(id: string): Promise<void> {
    if (this.fallback) return this.fallback.delete(id);
    const result = await this.withStore<undefined>('readwrite', (store) => store.delete(id));
    if (result === null) await this.fallback!.delete(id);
  }
}

function isStoredDocument(value: unknown): value is StoredDocument {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.name === 'string' && typeof record.file === 'object';
}

/** Name for a brand new document, numbered past the ones already stored. */
export function nextDocumentName(existing: Array<{ name: string }>): string {
  const used = new Set(existing.map((document) => document.name));
  if (!used.has('Untitled')) return 'Untitled';
  for (let index = 2; index < 1000; index += 1) {
    if (!used.has(`Untitled ${index}`)) return `Untitled ${index}`;
  }
  return `Untitled ${Date.now()}`;
}

/** Trim a document name, falling back to the file's own name. */
export function normalizeDocumentName(name: string, fallback = 'Untitled'): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  return trimmed === '' ? fallback : trimmed.slice(0, 80);
}

/** Summaries, most recently saved first. */
export function toSummaries(documents: StoredDocument[]): DocumentSummary[] {
  return documents
    .map(({ id, name, createdAt, savedAt, fileName }) => ({
      id,
      name,
      createdAt,
      savedAt,
      // Old records have no stored name: derive it from the document name.
      fileName: fileName ?? pigmaFileName(name),
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

/** Duplicate a document under a new id and name. */
export function duplicateDocument(source: StoredDocument, id: string, now: number): StoredDocument {
  return {
    ...source,
    id,
    name: normalizeDocumentName(`${source.name} copy`),
    createdAt: now,
    savedAt: now,
  };
}

/** What the legacy localStorage payload looked like (see persistence.ts). */
export interface LegacyPayload {
  file?: unknown;
  pageId?: unknown;
  viewport?: unknown;
  savedAt?: unknown;
}

/**
 * Turn the old single-key payload into a library document, or null when it is
 * missing/corrupt. The caller removes the legacy key only after this succeeds.
 *
 * Two shapes are accepted: the envelope the previous build wrote
 * (`{ schema: 'pigma/persist/1', savedAt, file, … }`) and a bare Pigma file —
 * both have been seen in that key (an exported document dropped in by hand, or
 * an older build). The validator is the only gate either way.
 */
export function migrateLegacyDocument(
  payload: LegacyPayload | null,
  id: string,
  now: number,
): StoredDocument | null {
  if (!payload || typeof payload !== 'object') return null;
  // The envelope the previous build wrote carries the file; a bare Pigma file
  // (an exported document dropped into the key by hand, or an older build) is
  // accepted too. The validator is the only gate either way.
  const candidate = typeof payload.file === 'object' && payload.file !== null ? payload.file : (payload as unknown);
  const result = validatePigmaFile(candidate);
  if (!result.ok || !result.file) return null;

  const viewport = payload.viewport as { x?: number; y?: number; zoom?: number } | undefined;
  const zoom = typeof viewport?.zoom === 'number' && viewport.zoom > 0 ? viewport.zoom : 1;
  const pageId =
    typeof payload.pageId === 'string' && result.file.document.children.some((page) => page.id === payload.pageId)
      ? payload.pageId
      : (result.file.document.children[0] as { id: string }).id;
  return {
    id,
    name: normalizeDocumentName(result.file.name, 'Recovered document'),
    createdAt: typeof payload.savedAt === 'number' ? payload.savedAt : now,
    savedAt: typeof payload.savedAt === 'number' ? payload.savedAt : now,
    file: result.file,
    pageId,
    viewport: { x: typeof viewport?.x === 'number' ? viewport.x : 0, y: typeof viewport?.y === 'number' ? viewport.y : 0, zoom },
  };
}
