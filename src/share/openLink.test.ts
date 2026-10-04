import { describe, expect, it, vi } from 'vitest';
import {
  LINK_FORMAT_FAILURE,
  LINK_READ_FAILURE,
  buildDocumentLink,
  fetchLinkedDocument,
  isFetchableDocumentUrl,
  readDocumentLink,
  resolveDocumentUrl,
} from './openLink';
import { serializeFile } from '../model/serialize';
import { emptyFile } from '../model/validate';

const document = (name = 'Shared') => emptyFile(name);

/** A fetch stub that returns one response. */
const responding = (body: string, init: { ok?: boolean; status?: number } = {}) =>
  (async () =>
    ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      text: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;

describe('document links', () => {
  it('builds `#open=<url>&name=<optional>` and reads it back', () => {
    const link = buildDocumentLink({ base: 'https://getpigma.com', url: 'https://files.test/a.pigma', name: 'Homepage' });
    expect(link).toBe('https://getpigma.com/#open=https%3A%2F%2Ffiles.test%2Fa.pigma&name=Homepage');
    expect(readDocumentLink(link)).toEqual({ url: 'https://files.test/a.pigma', name: 'Homepage' });

    // The name is optional, and an empty one is not invented.
    const bare = buildDocumentLink({ base: 'https://getpigma.com', url: 'https://files.test/a.pigma', name: '  ' });
    expect(readDocumentLink(bare)).toEqual({ url: 'https://files.test/a.pigma', name: null });
    expect(readDocumentLink('#open=https://files.test/a.pigma')).toEqual({ url: 'https://files.test/a.pigma', name: null });
  });

  it('never carries the document itself', () => {
    // Embedding is deliberately unsupported: the fragment names a URL, nothing else.
    const link = buildDocumentLink({ base: 'https://getpigma.com', url: '/documents/home.pigma' });
    // No payload, no schema, no nodes: just the URL (percent-encoded).
    expect(link).toBe('https://getpigma.com/#open=%2Fdocuments%2Fhome.pigma');
    expect(link).not.toContain('schema');
    expect(link).not.toContain('{');
    expect(link.length).toBeLessThan(120);
  });

  it('ignores fragments that are not document links', () => {
    expect(readDocumentLink('')).toBeNull();
    expect(readDocumentLink('#')).toBeNull();
    expect(readDocumentLink('#room=studio&key=abc')).toBeNull();
    expect(readDocumentLink('#open=')).toBeNull();
    expect(readDocumentLink('#open=%20%20')).toBeNull();
    // A room link and a document link can share a fragment.
    expect(readDocumentLink('#room=studio&key=abc&open=%2Fdoc.pigma')).toEqual({ url: '/doc.pigma', name: null });
  });

  it('resolves relative paths against the page, and refuses other schemes', () => {
    expect(resolveDocumentUrl('/documents/home.pigma', 'https://studio.test/')).toBe('https://studio.test/documents/home.pigma');
    expect(resolveDocumentUrl('home.pigma', 'https://studio.test/app/')).toBe('https://studio.test/app/home.pigma');
    expect(resolveDocumentUrl('https://files.test/a.pigma', 'https://studio.test/')).toBe('https://files.test/a.pigma');
    // A document link may never be a script, a data URL or a local file.
    expect(resolveDocumentUrl('javascript:alert(1)', 'https://studio.test/')).toBeNull();
    expect(resolveDocumentUrl('data:application/json,{}', 'https://studio.test/')).toBeNull();
    expect(resolveDocumentUrl('file:///etc/passwd', 'https://studio.test/')).toBeNull();
    expect(resolveDocumentUrl('   ', 'https://studio.test/')).toBeNull();
    expect(isFetchableDocumentUrl('https://files.test/a.pigma')).toBe(true);
    expect(isFetchableDocumentUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('fetching a linked document', () => {
  it('loads a valid Pigma document', async () => {
    const text = serializeFile(document('From the web'));
    const result = await fetchLinkedDocument('https://files.test/a.pigma', responding(text));
    expect(result.error).toBeNull();
    expect(result.file?.name).toBe('From the web');
    expect(result.file?.schema).toBe('pigma/1');
  });

  it('accepts a legacy `.json` document, because the schema decides', async () => {
    const result = await fetchLinkedDocument('https://files.test/a.json', responding(serializeFile(document('Legacy'))));
    expect(result.file?.name).toBe('Legacy');
  });

  it('rejects anything that is not a Pigma document', async () => {
    const notJson = await fetchLinkedDocument('https://files.test/a.pigma', responding('<html>nope</html>'));
    expect(notJson.file).toBeNull();
    expect(notJson.error).toBeTruthy();

    const jsonButNotPigma = await fetchLinkedDocument('https://files.test/a.json', responding('{"hello":"world"}'));
    expect(jsonButNotPigma.file).toBeNull();
    expect(jsonButNotPigma.error).toMatch(/document/i);

    const empty = await fetchLinkedDocument('https://files.test/a.pigma', responding(''));
    expect(empty.file).toBeNull();
  });

  it('explains a CORS or network failure instead of failing silently', async () => {
    const refusing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const result = await fetchLinkedDocument('https://files.test/a.pigma', refusing);
    expect(result.file).toBeNull();
    expect(result.error).toBe(LINK_READ_FAILURE);
    expect(result.error).toMatch(/download it and open it/i);

    const notFound = await fetchLinkedDocument('https://files.test/a.pigma', responding('', { ok: false, status: 404 }));
    expect(notFound.error).toMatch(/404/);

    // A scheme that is not fetchable never reaches the network at all.
    const spy = vi.fn();
    const refused = await fetchLinkedDocument('javascript:alert(1)', spy as unknown as typeof fetch);
    expect(refused.file).toBeNull();
    expect(refused.error).toBe(LINK_FORMAT_FAILURE);
    expect(spy).not.toHaveBeenCalled();
  });

  it('treats the payload as data, never as code', async () => {
    // A document whose text contains a script tag is just a name: nothing runs.
    const file = document('<script>globalThis.__pwned = true</script>');
    const result = await fetchLinkedDocument('https://files.test/a.pigma', responding(serializeFile(file)));
    expect(result.file?.name).toContain('<script>');
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined();
  });
});
