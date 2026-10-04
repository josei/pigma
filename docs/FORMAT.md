# The native Pigma format

This document specifies the format Pigma reads and writes natively: the document
schema, the persistence envelope, how serialization is made deterministic, how
validation behaves, where documents live, and how the native format relates to
the interchange formats.

Source of truth, by section:

| Topic | Code |
| --- | --- |
| Document types | `src/model/types.ts` |
| Validation | `src/model/validate.ts` |
| Deterministic serialization | `src/model/serialize.ts` |
| Persistence envelope, crash marker | `src/store/persistence.ts` |
| Document library | `src/store/documentLibrary.ts` |
| Endpoint/config overrides | `src/config/endpoints.ts` |

---

## 1. Two tags, two jobs

Pigma uses two distinct tags and they are not interchangeable:

- **`pigma/1`** — the *document* schema. This is the `PigmaFile` object, and it is
  what "Export JSON" / "Import JSON" move around. Declared in
  `src/model/types.ts` as `PigmaFile.schema`.
- **`pigma/persist/1`** — the *persistence envelope*. This wraps a document with
  the metadata the browser needs in order to restore it: when it was saved and
  which page was open. Declared in `src/store/persistence.ts` as
  `PersistedDocument`.

```ts
interface PersistedDocument {
  schema: 'pigma/persist/1';
  savedAt: number;   // epoch ms; drives "is this newer than the library copy?"
  file: PigmaFile;   // the document itself, with schema 'pigma/1'
  pageId: string;    // the page that was open
}
```

The split exists because `savedAt` is bookkeeping, not design data: it must not
appear in an exported document, and a document must be valid without it.

## 2. The document tree

A `PigmaFile` is a tree with exactly three levels of structure:

```
DOCUMENT                     one per file
└── CANVAS  (a page)         1..n; each page is an independent canvas
    └── scene nodes          frames, groups, shapes, text, instances, …
        └── children         containers nest arbitrarily
```

`DocumentNode.children` is `CanvasNode[]`; pages are `CANVAS` nodes. Scene nodes
are every other type: `FRAME`, `GROUP`, `SECTION`, `RECTANGLE`, `ELLIPSE`,
`LINE`, `POLYGON`, `STAR`, `VECTOR`, `TEXT`, `COMPONENT`, `COMPONENT_SET`,
`INSTANCE`, `BOOLEAN_OPERATION`, `SLICE`.

Three properties of the tree are worth stating explicitly, because everything
else follows from them:

- **Transforms are relative, not absolute.** `BaseNode.transform` is a 2×3 matrix
  in the *parent's* coordinate space, matching Figma's `relativeTransform`
  (`[[a, c, tx], [b, d, ty]]`). A node's world position is a product down the
  path, not a stored value. Moving a parent therefore moves its children.
- **Every node type shares one base.** `BaseNode` carries `id`, `name`, `type`,
  `visible`, `locked`, `opacity`, `transform`, `width`, `height`, `fills`,
  `strokes`, stroke styling, `effects`, `constraints`, auto-layout participation,
  `interactions`, and `raw`.
- **Containers add children and layout.** `ContainerNode` adds `children`,
  `autoLayout`, and `clipsContent`. `ComponentNode` adds
  `componentPropertyDefinitions`; `InstanceNode` adds `componentId`,
  `componentProperties`, `overrides`, and `componentSnapshot`.

Paints are a tagged union (`SOLID`, the four gradients, `IMAGE`, `VIDEO`,
`PATTERN`, and an `UnsupportedPaint` fallback). Effects are `DROP_SHADOW`,
`INNER_SHADOW`, `LAYER_BLUR`, `BACKGROUND_BLUR`, again with an unsupported
fallback. Text carries a `TextStyle` (family, style, size, weight, line height,
letter spacing, horizontal/vertical alignment, case, decoration, auto-resize).

## 3. Deterministic serialization

`src/model/serialize.ts` implements `stableStringify`, which sorts object keys
recursively before calling `JSON.stringify`. Arrays keep their order; keys are
emitted in lexical order; `undefined` values are dropped.

The consequence is the property the format is designed around:

> Serializing the same document twice produces **byte-identical** output.

That is what makes exports diffable in review, cacheable, and assertable in
tests — a document that has not changed does not produce a changed file. It is
also why an export is safe to hash: any byte difference means a semantic
difference.

## 4. Validation is lenient, and says so

`validatePigmaFile` in `src/model/validate.ts` returns
`{ ok, file, errors, warnings }`. Its stated contract is *"lenient but
strict-where-it-matters"*:

- **Errors — the file is rejected.** The root is not an object; `document` is
  missing or not an object; `document.type` is not `DOCUMENT`;
  `document.children` is not an array; after normalization there are no `CANVAS`
  pages. Import fails loudly rather than producing a half-document.
- **Warnings — the file loads, with notes.** A node that is not an object or has
  no `type` is skipped; a node without an `id` is given a generated one; an
  `INSTANCE` without a `componentId` is noted; unrecognized fields are counted
  and reported (`preserved N unrecognized field(s) in raw`).

Warnings are surfaced to the user through the import report rather than being
swallowed. A caller that ignores `warnings` still gets a usable document; a
caller that shows them gets an honest account of what was dropped or invented.

## 5. Raw passthrough

Unknown fields are **not** discarded. `collectExtras` gathers every property the
model does not recognize onto the node's `raw` map, and the exporter writes them
back out.

This is deliberate: Pigma implements a subset of Figma's model, and a
round-tripped file must not silently lose the parts it does not understand.
Preserving them verbatim means a document can pass through Pigma — import, edit
elsewhere, export — without the unknown corners being destroyed. The import
report counts them so the user knows they exist, even though they survive.

## 6. Where documents live

There is no Pigma server and no account. A document lives in one of three
places, and the tiers are ordered by durability:

1. **`localStorage` crash marker** — a synchronous copy of the open document,
   written under `pigma:document:v1` as a `pigma/persist/1` envelope. It exists
   so an unexpected tab close does not lose work. It is an *optimisation*, not
   the store of record: a blocked `localStorage` costs the recovery nicety and
   nothing else.
2. **IndexedDB document library** — the store of record in the browser, database
   name `pigma` (`DOCUMENT_DB_NAME`). Holds named documents, versions, and
   libraries.
3. **File System Access files** — a document the user opens and saves through the
   OS file picker. This is the only tier that survives clearing browser storage.

**The crash marker never wins over newer work.** On boot the marker is replayed
only when it is *strictly newer* than the library record for the same document;
a marker written by an older build is dropped instead of replayed. A document
with no marker at all is adopted as a new library document rather than being
discarded. This ordering is what makes "Recovered…" trustworthy — and why a
clean boot shows no such message at all.

## 7. Interchange formats

The native format is the hub; everything else is a spoke.

| Format | Direction | Notes |
| --- | --- | --- |
| Pigma JSON (`pigma/1`) | in / out | Lossless. The native format, stored as `.pigma` (`application/vnd.pigma+json`) |
| Figma REST JSON | in | `src/figma/rest` |
| Figma `.fig` (native binary) | in / out | `src/figma/native`. Lossy — see [FIGMA_COMPAT.md](FIGMA_COMPAT.md) |
| SVG | out | `src/render/svgExport.ts`; also selection-scoped |
| PNG (1x / 2x / 3x) | out | Rasterised, scale-exact |
| PDF | out | Vector |

Every import path produces an `ImportReport` (`src/figma/convert/report.ts`)
listing what could not be represented. Imports are read-only against the source
file: they never write back over the input.

## 8. A minimal document

The smallest valid document: one page, one rectangle, one solid fill.

```jsonc
{
  "schema": "pigma/1",              // document schema tag
  "name": "Example",
  "lastModified": 1767225600000,
  "document": {
    "id": "0:0",
    "name": "Document",
    "type": "DOCUMENT",
    "visible": true,
    "locked": false,
    "opacity": 1,
    "transform": { "x": 0, "y": 0, "rotation": 0, "scaleX": 1, "scaleY": 1 },
    "width": 0,
    "height": 0,
    "fills": [],
    "strokes": [],
    "children": [
      {
        "id": "0:1",
        "name": "Page 1",
        "type": "CANVAS",          // a page
        "visible": true,
        "locked": false,
        "opacity": 1,
        "transform": { "x": 0, "y": 0, "rotation": 0, "scaleX": 1, "scaleY": 1 },
        "width": 0,
        "height": 0,
        "fills": [],
        "strokes": [],
        "children": [
          {
            "id": "0:2",
            "name": "Rectangle 1",
            "type": "RECTANGLE",
            "visible": true,
            "locked": false,
            "opacity": 1,
            // RELATIVE to the page; world position is the product down the path
            "transform": { "x": 100, "y": 80, "rotation": 0, "scaleX": 1, "scaleY": 1 },
            "width": 160,
            "height": 120,
            "fills": [
              { "type": "SOLID", "color": { "r": 0.85, "g": 0.85, "b": 0.85, "a": 1 } }
            ],
            "strokes": []
          }
        ]
      }
    ]
  }
}
```

Note what is absent: no `savedAt` (that belongs to the persistence envelope), no
absolute coordinates, and no fields the model does not need. A file with extra
fields still loads — they land in `raw` and are written back on export.

## 9. Versioning and compatibility policy

- **`schema` is the compatibility gate.** `pigma/1` is the current document
  schema; `pigma/persist/1` the current envelope. A reader must reject a tag it
  does not know rather than guessing.
- **Unknown fields are preserved, so adding fields is safe.** A `pigma/1` file
  written by a newer build still loads in an older one; the new fields ride along
  in `raw` and are not lost on re-export.
- **A future `pigma/2` MUST preserve, at minimum:** the three-level
  document/page/node structure and the relative-transform semantics (both are
  observable in published behaviour); every node's `id` and `name` (referenced by
  history, selection, and prototypes); unknown-field passthrough (otherwise older
  files silently lose data on a v2 round trip); and the determinism guarantee —
  same document, same bytes.
- **A v2 may change:** the tag, the envelope's bookkeeping fields, and any field
  the migration explicitly rewrites. It must not repurpose an existing field name
  to mean something new; that is what passthrough cannot protect against.
- **Migration is not implicit.** A file is upgraded by an explicit migration
  path, never by guessing at a tag.

## 10. Share links

A share link points at a document; it does not contain one.

```
https://getpigma.com/#open=<percent-encoded url>&name=<optional label>
```

- `open` is the URL of the document file. It may be **absolute**
  (`https://files.example.com/home.pigma`) or **relative**
  (`/documents/home.pigma`), which is what lets a self-hosted instance serve its
  own documents from the same origin as the editor.
- `name` is a display hint only. It never becomes the document's identity.
- The fragment is used deliberately: it is never sent to a server, so a link
  reveals the document's URL to the people who hold the link and to nobody else.
  A room invite (`#room=…&key=…`) can share the same fragment.

### EMBEDDING IS DELIBERATELY NOT SUPPORTED

There is no `#design=<payload>` form, and adding one is not planned. A real
design does not fit in a URL: browsers cap URLs far below the size of a typical
document, images are orders of magnitude past that cap on their own, and a
fragment that long is unusable — it breaks in chat clients, mail clients and
anything that wraps text. A link that silently truncates a design is worse than
no link, so the format names a URL and lets the browser fetch it.

### How a link is opened

1. The app reads `#open=` and resolves it (absolute, or relative to its own
   origin). Only `http`/`https` are accepted: `javascript:`, `data:` and `file:`
   are refused before any request is made.
2. The browser fetches the URL. **The host must allow it** — the file needs CORS
   headers that let the app read it. When the fetch is refused (CORS, offline, a
   404), the app says so — *"that host does not allow the app to read the file —
   download it and open it instead"* — and keeps the editor usable rather than
   showing a blank screen.
3. The payload is treated **as data**: it is parsed as JSON and validated against
   `pigma/1`, exactly like any other import. Nothing from the network is ever
   executed, and a payload that fails the schema is refused rather than
   half-loaded. A legacy `.json` document is accepted, because the schema tag is
   the authority, not the extension.
4. The document loads **clean**: it is shown and is undoable, but it is *not* the
   user's local document. Nothing is written to the document library, and the
   crash marker is left alone, until the user edits it or chooses to keep it. The
   user's own open document, its library record and any file handle stay
   untouched — a link can never overwrite local work by being opened.

### "Copy link to this document"

The File menu's **Copy link to this document…** asks for the URL where the user
hosts the file (prefilled with the URL the document was opened from, when it came
from a link) and emits the `#open=` form above. Pigma never uploads anything: the
user hosts the file, and the link points at it.
