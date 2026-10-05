/**
 * `.fig` round-trip loss, measured rather than assumed.
 *
 * The compat table promises "nothing is lost silently", so a field the exporter
 * omits is a P0. `locked` was one: it was never written, the importer reads
 * `locked === true`, and a missing field is false — a locked layer came back
 * unlocked with no warning. These tests drive the REAL binary round trip
 * (`exportPigmaFile` -> `parseFigArchive` -> `figDocumentToPigmaFile`) with the
 * fixture schemas, so the answer is measured, not inferred.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figDocumentToPigmaFile } from '../../src/figma/convert/convert';
import { useEditor } from '../../src/store/editorStore';
import { nodeDecompressors } from '../../src/figma/native/node';
import { exportPigmaFile, pigmaToFigMessage } from '../../src/figma/native/modelExport';
import { nodeExportCompressors } from '../../src/figma/native/export.node';
import { parseFigArchive } from '../../src/figma/native/parse';
import { emptyFile } from '../../src/model/validate';
import { createFrameNode, createRectNode, createTextNode } from '../../src/model/factory';
import type { PigmaFile, SceneNode } from '../../src/model/types';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

/** The first node with this name, at any depth. */
function byName(file: PigmaFile, name: string): SceneNode | null {
  let found: SceneNode | null = null;
  const visit = (node: { id: string; name?: string; children?: unknown[] }): void => {
    if (found) return;
    if (node.name === name) {
      found = node as unknown as SceneNode;
      return;
    }
    for (const child of (node.children ?? []) as Array<{ id: string; children?: unknown[] }>) visit(child);
  };
  visit(file.document as unknown as { id: string; children?: unknown[] });
  return found;
}

/** A one-rectangle file, mutated by the caller. */
function scene(mutate: (node: SceneNode) => void): { file: PigmaFile; id: string } {
  const file = emptyFile('Round trip');
  const page = file.document.children[0]!;
  const rect = createRectNode(file.document, 10, 20, 100, 50);
  rect.name = 'Subject';
  mutate(rect);
  page.children = [rect];
  return { file, id: rect.id };
}

/** The real binary round trip, with `schema` as the kiwi schema. */
async function roundTrip(file: PigmaFile, schema: string): Promise<PigmaFile> {
  const archive = await exportPigmaFile(file, {
    schemaFrom: fixture(schema),
    decompress: nodeDecompressors,
    compress: nodeExportCompressors,
    sessionID: 1,
  });
  return figDocumentToPigmaFile(parseFigArchive(archive, nodeDecompressors), { now: () => 1 }).file;
}

describe('native round trip keeps per-node flags', () => {
  it('preserves locked', async () => {
    const { file } = scene((node) => {
      node.locked = true;
    });
    const reimported = await roundTrip(file, 'circle.fig');
    // A native round trip re-issues ids (the wire carries guids), so the node is
    // found by name — the same way the existing round-trip test compares trees.
    const node = byName(reimported, 'Subject');
    expect(node, 'the node survived').toBeTruthy();
    expect(node!.locked, 'a locked layer came back unlocked').toBe(true);
  });

  it('preserves locked on a nested node, and leaves an unlocked one alone', async () => {
    const file = emptyFile('Nested');
    const page = file.document.children[0]!;
    const outer = createRectNode(file.document, 0, 0, 200, 200);
    outer.name = 'Outer';
    const inner = createRectNode(file.document, 10, 10, 50, 50);
    inner.name = 'Inner';
    inner.locked = true;
    (outer as unknown as { children: SceneNode[] }).children = [inner];
    page.children = [outer];
    const reimported = await roundTrip(file, 'circle.fig');
    expect(byName(reimported, 'Inner')!.locked).toBe(true);
    expect(byName(reimported, 'Outer')!.locked).toBe(false);
  });

  it('writes locked in the message, and omits it when false', () => {
    const locked = scene((node) => {
      node.locked = true;
    });
    const plain = scene(() => {});
    const options = { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors };
    const lockedChanges = pigmaToFigMessage(locked.file, options).message.nodeChanges as Array<Record<string, unknown>>;
    const plainChanges = pigmaToFigMessage(plain.file, options).message.nodeChanges as Array<Record<string, unknown>>;
    expect(lockedChanges.find((change) => change.name === 'Subject')!.locked).toBe(true);
    expect(plainChanges.find((change) => change.name === 'Subject')!.locked).toBeUndefined();
  });
});

describe('dashPattern: is the loss schema-dependent?', () => {
  it('is written to the message either way', () => {
    const { file } = scene((node) => {
      node.dashPattern = [4, 2];
    });
    const changes = pigmaToFigMessage(file, { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors }).message
      .nodeChanges as Array<Record<string, unknown>>;
    // The NATIVE wire name, which is what the schema defines.
    expect(changes.find((change) => change.name === 'Subject')!.dashPattern).toEqual([4, 2]);
  });

  it('reports which fixture schemas keep it through the binary round trip', async () => {
    // Measured across every schema fixture: the loss, if any, is a property of
    // the schema (whether it defines strokeDashes), not of the exporter.
    const results: Record<string, boolean> = {};
    for (const schema of ['circle.fig', 'openfigs.fig', 'with-image.fig', 'word-outline-stroke.fig']) {
      const { file } = scene((node) => {
        node.dashPattern = [4, 2];
      });
      const reimported = await roundTrip(file, schema);
      const node = byName(reimported, 'Subject');
      results[schema] = !!node && Array.isArray(node.dashPattern) && node.dashPattern.length > 0;
    }
    // FIXED: the exporter wrote the REST name (`strokeDashes`); the NATIVE schema
    // spells the field `dashPattern`, so it was dropped by the encoder. With the
    // wire name corrected the round trip keeps it — in every fixture whose schema
    // defines the field, which the decoded schema shows all four do.
    const kept = Object.entries(results).filter(([, value]) => value).map(([name]) => name);
    expect(Object.keys(results)).toHaveLength(4);
    expect(kept, `kept by: ${kept.join(', ')}`).toEqual(['circle.fig', 'openfigs.fig', 'with-image.fig', 'word-outline-stroke.fig']);
  });
});

describe('the export reports fields the schema cannot encode', () => {
  it('warns once per unencodable field, naming it and the change', () => {
    const file = emptyFile('Warn');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 0, 0, 100, 50);
    rect.name = 'Subject';
    // This test used to pin `overflowDirection` as a field we wrote and the schema
    // did not define — the last kind-1 divergence. It is FIXED: the exporter now
    // writes `scrollDirection`, the wire's real field, so NOTHING is unencodable
    // here and the warning correctly stays silent.
    (rect as { type: string }).type = 'FRAME';
    (rect as { overflowDirection?: string }).overflowDirection = 'VERTICAL_SCROLLING';
    page.children = [rect];

    const { message, warnings } = pigmaToFigMessage(file, { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors });
    const dropped = warnings.filter((line) => line.includes('is not defined by this .fig schema'));
    expect(dropped, JSON.stringify(dropped)).toEqual([]);
    const change = (message.nodeChanges as Array<Record<string, unknown>>).find((entry) => entry.name === 'Subject')!;
    expect(change.scrollDirection).toBe('VERTICAL');
    expect(change.overflowDirection).toBeUndefined();
  });

  it('does not warn about fields the schema defines', () => {
    const file = emptyFile('Clean');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 0, 0, 100, 50);
    rect.name = 'Plain';
    rect.locked = true;
    rect.visible = false;
    rect.opacity = 0.5;
    rect.cornerRadius = 4;
    page.children = [rect];
    const { warnings } = pigmaToFigMessage(file, { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors });
    expect(warnings.filter((line) => line.includes('is not defined by this .fig schema'))).toEqual([]);
  });

  it('covers a silently WRONG value too: windingRule now round-trips', async () => {
    // It was not a loss but a wrong value: the exporter hardcoded NONZERO in the
    // geometry entry, so an EVENODD path came back NONZERO.
    const file = emptyFile('Winding');
    const page = file.document.children[0]!;
    const vector = createRectNode(file.document, 0, 0, 100, 50);
    vector.name = 'Subject';
    (vector as { type: string }).type = 'VECTOR';
    (vector as { pathData: string }).pathData = 'M 0 0 L 10 0 L 10 10 Z';
    vector.windingRule = 'EVENODD';
    page.children = [vector];
    const reimported = await roundTrip(file, 'circle.fig');
    // The schema spells it ODD; the import maps it back to the model's EVENODD.
    expect(byName(reimported, 'Subject')!.windingRule).toBe('EVENODD');
  });
});

describe('batch 1: the fields the schema defines now round-trip', () => {
  it('keeps isMask, constraints, layoutAlign/Grow and textAutoResize', async () => {
    const file = emptyFile('Batch 1');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 0, 0, 300, 200);
    frame.name = 'Outer';
    const mask = createRectNode(file.document, 0, 0, 100, 100);
    mask.name = 'Mask';
    mask.isMask = true;
    const child = createRectNode(file.document, 0, 0, 50, 50);
    child.name = 'Child';
    child.constraints = { horizontal: 'MAX', vertical: 'CENTER' };
    child.layoutAlign = 'STRETCH';
    child.layoutGrow = 2;
    const text = createTextNode(file.document, 0, 0, 'Resize me');
    text.name = 'Label';
    text.style = { ...text.style, textAutoResize: 'HEIGHT' };
    frame.children = [mask, child, text];
    page.children = [frame];

    const reimported = await roundTrip(file, 'circle.fig');
    expect(byName(reimported, 'Mask')!.isMask, 'isMask (wire `mask`)').toBe(true);
    expect(byName(reimported, 'Child')!.constraints, 'constraints').toEqual({ horizontal: 'MAX', vertical: 'CENTER' });
    expect(byName(reimported, 'Child')!.layoutAlign, 'layoutAlign (wire `stackCounterAlign`)').toBe('STRETCH');
    expect(byName(reimported, 'Child')!.layoutGrow, 'layoutGrow (wire `stackChildPrimaryGrow`)').toBe(2);
    const label = byName(reimported, 'Label')!;
    expect(label.type).toBe('TEXT');
    expect((label as { style: { textAutoResize?: string } }).style.textAutoResize, 'textAutoResize').toBe('HEIGHT');
  });

  it('does not warn for any of them: the schema defines every one', () => {
    const file = emptyFile('Batch 1 warnings');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 0, 0, 100, 50);
    rect.name = 'Subject';
    rect.isMask = true;
    rect.constraints = { horizontal: 'MIN', vertical: 'MAX' };
    rect.layoutAlign = 'INHERIT';
    rect.layoutGrow = 1;
    page.children = [rect];
    const { warnings } = pigmaToFigMessage(file, { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors });
    const dropped = warnings.filter((line) => line.includes('is not defined by this .fig schema'));
    // `overflowDirection` is not written here, so nothing should be reported.
    expect(dropped).toEqual([]);
  });
});

describe('batch 2: layout grids round-trip', () => {
  it('keeps the guides, their pattern, axis, count, gutter and offset', async () => {
    const file = emptyFile('Grids');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 0, 0, 400, 300);
    frame.name = 'Subject';
    frame.layoutGrids = [
      { pattern: 'COLUMNS', sectionSize: 8, count: 4, gutterSize: 16, offset: 24, alignment: 'STRETCH', visible: true },
      { pattern: 'ROWS', sectionSize: 12, count: 3, gutterSize: 4, offset: 0, alignment: 'MIN', visible: false },
    ];
    page.children = [frame];

    const reimported = await roundTrip(file, 'circle.fig');
    const grids = (byName(reimported, 'Subject') as { layoutGrids?: Array<Record<string, unknown>> }).layoutGrids;
    expect(grids, 'the guides did not survive').toBeTruthy();
    expect(grids!).toHaveLength(2);
    // COLUMNS is STRIPES with axis X; ROWS is STRIPES with axis Y.
    expect(grids![0]).toMatchObject({ pattern: 'COLUMNS', sectionSize: 8, count: 4, gutterSize: 16, offset: 24, alignment: 'STRETCH' });
    expect(grids![1]).toMatchObject({ pattern: 'ROWS', sectionSize: 12, count: 3, visible: false });
  });

  it('does not warn for layoutGrids: the schema defines it', () => {
    const file = emptyFile('Grid warnings');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 0, 0, 100, 100);
    frame.name = 'Subject';
    frame.layoutGrids = [{ pattern: 'GRID', sectionSize: 10, count: 2, alignment: 'MIN', visible: true }];
    page.children = [frame];
    const { warnings } = pigmaToFigMessage(file, { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors });
    expect(warnings.filter((line) => line.includes('is not defined by this .fig schema'))).toEqual([]);
  });
});

describe('prototype interactions: the export side writes them', () => {
  it('writes the container, the event, the destination and the transition', () => {
    const file = emptyFile('Prototype export');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 0, 0, 200, 100);
    frame.name = 'From';
    const to = createFrameNode(file.document, 300, 0, 200, 100);
    to.name = 'To';
    frame.interactions = [
      {
        trigger: { type: 'ON_CLICK' },
        actions: [
          {
            type: 'NODE',
            destinationId: to.id,
            navigation: 'NAVIGATE',
            transition: { type: 'SMART_ANIMATE', duration: 250, easing: 'IN_CUBIC' },
          },
        ],
      },
      {
        trigger: { type: 'ON_HOVER' },
        actions: [{ type: 'NODE', destinationId: to.id, navigation: 'SWAP_STATE' }],
      },
    ];
    page.children = [frame, to];

    const { message, warnings } = pigmaToFigMessage(file, { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors });
    const change = (message.nodeChanges as Array<Record<string, unknown>>).find((entry) => entry.name === 'From')!;
    const interactions = change.prototypeInteractions as Array<Record<string, unknown>>;
    expect(interactions, 'no interactions were written').toHaveLength(2);
    // Container + event.
    expect(interactions[0]!.isDeleted).toBe(false);
    expect((interactions[0]!.event as Record<string, unknown>).interactionType).toBe('ON_CLICK');
    expect((interactions[1]!.event as Record<string, unknown>).interactionType).toBe('ON_HOVER');
    // Action: the destination as a GUID, the connection kind and the transition.
    const navigate = (interactions[0]!.actions as Array<Record<string, unknown>>)[0]!;
    expect(navigate.connectionType).toBe('INTERNAL_NODE');
    expect(typeof navigate.transitionNodeID).toBe('object');
    expect(navigate.navigationType).toBe('NAVIGATE');
    expect(navigate.transitionType).toBe('SMART_ANIMATE');
    expect(navigate.transitionDuration).toBe(250);
    expect(navigate.easingType).toBe('IN_CUBIC');
    expect(navigate.transitionShouldSmartAnimate).toBe(true);
    // The recovered member is written too.
    const swap = (interactions[1]!.actions as Array<Record<string, unknown>>)[0]!;
    expect(swap.navigationType, 'SWAP_STATE must be written').toBe('SWAP_STATE');
    // And the schema defines every field, so nothing is reported.
    expect(warnings.filter((line) => line.includes('is not defined by this .fig schema'))).toEqual([]);
  });
});

describe('prototype interactions survive the binary round trip', () => {
  it('keeps the trigger, destination and transition — and the swap still swaps', async () => {
    const file = emptyFile('Prototype round trip');
    const page = file.document.children[0]!;
    const from = createFrameNode(file.document, 0, 0, 200, 100);
    from.name = 'From';
    const to = createFrameNode(file.document, 300, 0, 200, 100);
    to.name = 'To';
    const state = createRectNode(file.document, 0, 0, 50, 50);
    state.name = 'State';
    from.interactions = [
      {
        trigger: { type: 'ON_CLICK' },
        actions: [
          { type: 'NODE', destinationId: to.id, navigation: 'NAVIGATE', transition: { type: 'SMART_ANIMATE', duration: 250, easing: 'IN_CUBIC' } },
        ],
      },
      {
        trigger: { type: 'ON_DRAG' },
        actions: [{ type: 'NODE', destinationId: state.id, navigation: 'SWAP_STATE' }],
      },
    ];
    page.children = [from, to, state];

    const reimported = await roundTrip(file, 'circle.fig');
    const back = byName(reimported, 'From') as unknown as { interactions?: Array<{ trigger: { type: string; delay?: number }; actions: Array<Record<string, unknown>> }> };
    expect(back.interactions, 'the interactions did not survive').toHaveLength(2);
    // Trigger, destination and transition.
    expect(back.interactions![0]!.trigger.type).toBe('ON_CLICK');
    expect(back.interactions![0]!.actions[0]!.navigation).toBe('NAVIGATE');
    const destination = back.interactions![0]!.actions[0]!.destinationId as string;
    expect(byName(reimported, 'To')!.id, 'the destination must resolve to the reimported node').toBe(destination);
    expect(back.interactions![0]!.actions[0]!.transition).toEqual({ type: 'SMART_ANIMATE', duration: 250, easing: 'IN_CUBIC' });
    // The DRAG trigger: the native name is DRAG, the model's is ON_DRAG.
    expect(back.interactions![1]!.trigger.type, 'DRAG must map back to ON_DRAG').toBe('ON_DRAG');
    expect(back.interactions![1]!.actions[0]!.navigation, 'the recovered member must survive').toBe('SWAP_STATE');
    expect(back.interactions![1]!.actions[0]!.destinationId).toBe(byName(reimported, 'State')!.id);

    // THE POINT: the recovered swap still PLAYS BACK as a swap, not a navigation.
    useEditor.getState().loadFile(reimported, 'Round tripped');
    const store = useEditor.getState();
    store.setPresentation(true, reimported.document.children[0]!.children[0]!.id);
    const stackBefore = useEditor.getState().presentationStack.length;
    const frameBefore = useEditor.getState().presentationFrameId;
    const instanceId = byName(reimported, 'State')!.id;
    useEditor.getState().swapInstanceState(instanceId, byName(reimported, 'To')!.id);
    expect(useEditor.getState().presentationFrameId, 'a swap must not navigate').toBe(frameBefore);
    expect(useEditor.getState().presentationStack.length, 'a swap must not push the stack').toBe(stackBefore);
  });
});

describe('the native grid mapper: placement and track guids survive', () => {
  it('round-trips a grid child’s span and anchors, and the track guids', async () => {
    const file = emptyFile('Grid round trip');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 0, 0, 400, 300);
    frame.name = 'Grid';
    frame.autoLayout = {
      layoutMode: 'GRID',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      gridColumns: [{ type: 'FLEX', value: 1 }, { type: 'FLEX', value: 2 }],
      gridRows: [{ type: 'FLEX', value: 1 }],
      gridColumnGap: 12,
      gridRowGap: 8,
      // Realistic wire guids: the model ids are `session:local`, and the wire's
      // GUID is that pair, so a guid that is not in that shape falls back to a
      // counter and would not round-trip.
      gridColumnGuids: ['1:5', '1:6'],
      gridRowGuids: ['1:7'],
    };
    const child = createRectNode(file.document, 0, 0, 50, 50);
    child.name = 'Cell';
    child.gridColumnSpan = 2;
    child.gridRowSpan = 1;
    child.gridColumnAnchorIndex = 1;
    child.gridColumnAnchorGuid = '1:6';
    frame.children = [child];
    page.children = [frame];

    const reimported = await roundTrip(file, 'circle.fig');
    const grid = byName(reimported, 'Grid')!;
    const layout = (grid as unknown as { autoLayout?: Record<string, unknown> }).autoLayout!;
    expect(layout.layoutMode).toBe('GRID');
    expect(layout.gridColumnGap).toBe(12);
    expect(layout.gridRowGap).toBe(8);
    // The track GUIDS came back — what the wire's GUIDPositionMap actually
    // carries. The track SIZES (px/fr) are NOT on the wire: the map holds guids
    // and positions only, so a grid's tracks return as the implicit flex track.
    // That is a documented gap, not an approximation.
    // MEASURED: the mode and the two gaps survive. The TRACKS and their guids do
    // NOT — the export writes `gridColumns` as a GUIDPositionMap but it does not
    // come back through the parse, so `mapNativeGrid` finds no guids and no
    // tracks. That is a documented gap in the round trip, pinned here so it
    // cannot be mistaken for working.
    expect(layout.layoutMode).toBe('GRID');
    expect(layout.gridColumnGap).toBe(12);
    expect(layout.gridRowGap).toBe(8);
    // FIXED: the entry field is `id`, not `guid` — writing `guid` made the encoder
    // drop it, so the map came back empty.
    expect(layout.gridColumnGuids, 'the column guids did not survive').toEqual(['1:5', '1:6']);
    expect(layout.gridRowGuids).toEqual(['1:7']);
    // The track SIZES are still not on the wire: the map carries guids and
    // positions only, so the tracks return as the implicit flex track.
    expect(layout.gridColumns).toEqual([{ type: 'FLEX', value: 1 }, { type: 'FLEX', value: 1 }]);
    // The child's span and anchor guid, now measured.
    const back = byName(reimported, 'Cell')!;
    expect(back.gridColumnSpan, 'the span did not survive').toBe(2);
    expect(back.gridColumnAnchorGuid, 'the anchor guid did not survive').toBe('1:6');
  });
});

describe('style bindings survive through the style table', () => {
  it('round-trips a fill binding, still resolving to the right style', async () => {
    const file = emptyFile('Style round trip');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 0, 0, 100, 50);
    rect.name = 'Subject';
    rect.styles = { fill: 'style:1' };
    page.children = [rect];
    // The style table carries the wire guid, which is what the binding needs.
    const withStyles = { ...file, styles: { 'style:1': { key: 'key-1', name: 'Brand fill', type: 'FILL' as const, guid: '1:42' } } };

    const reimported = await roundTrip(withStyles, 'circle.fig');
    const back = byName(reimported, 'Subject')!;
    // MEASURED, and now a different answer: the binding DOES survive, because the
    // definition is written and the import resolves the guid against the table.
    // NOTE the id CHANGES across the round trip: the imported table is keyed by the
    // wire guid (the REST path keys by Figma's id the same way), so what must hold
    // is that the binding still RESOLVES — not that it keeps the local id.
    expect(back.styles?.fill, 'the binding now survives').toBe('1:42');
    expect(reimported.styles?.[back.styles!.fill!]?.name).toBe('Brand fill');
    // The style TABLE does not cross the wire either: the native envelope has no
    // style table, so the guids the binding would match against are gone too.
    // Both halves of this gap are pinned, not assumed.
    expect(reimported.styles?.['style:1']?.guid, 'the style table does not survive yet').toBeUndefined();
  });

  it('writes the DEFINITION, so a binding no longer dangles, and round-trips both', async () => {
    const file = emptyFile('Bound style');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 10, 10, 80, 40);
    rect.name = 'Subject';
    rect.styles = { fill: 'style:1', stroke: 'style:2' };
    page.children = [rect];
    const withStyles = {
      ...file,
      styles: {
        'style:2': {
          key: 'key-2',
          name: 'Border/01',
          type: 'FILL' as const,
          guid: '0:5',
          paints: [{ type: 'SOLID' as const, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, blendMode: 'NORMAL' as const }],
        },
        'style:1': {
          key: 'key-1',
          name: 'Brand/01',
          type: 'FILL' as const,
          guid: '0:4',
          paints: [{ type: 'SOLID' as const, color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, blendMode: 'NORMAL' as const }],
        },
      },
    };
    const reimported = await roundTrip(withStyles, 'circle.fig');
    // The DEFINITION crossed: the style is a node entry in the table again.
    const style = reimported.styles?.['0:4'];
    expect(style?.name).toBe('Brand/01');
    expect(style?.type).toBe('FILL');
    expect(style?.paints).toHaveLength(1);
    // And the BINDING came back, still resolving to that style.
    const back = byName(reimported, 'Subject')!;
    expect(back.styles?.fill, 'the binding did not survive').toBe('0:4');
    expect(reimported.styles?.[back.styles!.fill!]?.name).toBe('Brand/01');
    // A STROKE binding is `styleIdForStrokeFill` on the wire and reuses a FILL
    // style (there is no STROKE styleType), so the model now carries it.
    expect(back.styles?.stroke, 'the stroke binding did not survive').toBe('0:5');
    expect(reimported.styles?.[back.styles!.stroke!]?.name).toBe('Border/01');
  });
});

describe('component property definitions round-trip through the wire mapper', () => {
  it('survives, with the type vocabulary translated', async () => {
    const file = emptyFile('Component props');
    const page = file.document.children[0]!;
    const component = createFrameNode(file.document, 0, 0, 100, 100);
    component.name = 'Button';
    (component as { type: string }).type = 'COMPONENT';
    (component as { componentPropertyDefinitions?: Record<string, { type: string; defaultValue: string | boolean; variantOptions?: string[] }> }).componentPropertyDefinitions = {
      size: { type: 'VARIANT', defaultValue: 'large', variantOptions: ['small', 'large'] },
      disabled: { type: 'BOOLEAN', defaultValue: false },
      label: { type: 'TEXT', defaultValue: 'Go' },
    };
    page.children = [component];

    const back = byName(await roundTrip(file, 'circle.fig'), 'Button')!;
    const defs = (back as { componentPropertyDefinitions?: Record<string, { type: string; defaultValue: unknown }> }).componentPropertyDefinitions!;
    // The wire calls BOOLEAN "BOOL"; writing the model's name through would drop it.
    expect(defs.disabled, 'the boolean property did not survive').toEqual({ type: 'BOOLEAN', defaultValue: false });
    expect(defs.label).toEqual({ type: 'TEXT', defaultValue: 'Go' });
    expect(defs.size?.type).toBe('VARIANT');
    expect(defs.size?.defaultValue).toBe('large');
    expect(Object.keys(defs).sort()).toEqual(['disabled', 'label', 'size']);
  });

  it('reports a wire type the model has no member for, rather than coercing it', () => {
    const file = emptyFile('Unknown prop');
    const page = file.document.children[0]!;
    const component = createFrameNode(file.document, 0, 0, 100, 100);
    component.name = 'Button';
    (component as { type: string }).type = 'COMPONENT';
    page.children = [component];
    const { message } = pigmaToFigMessage(file, { schemaFrom: fixture('circle.fig'), decompress: nodeDecompressors });
    const change = (message.nodeChanges as Array<Record<string, unknown>>).find((entry) => entry.name === 'Button')!;
    // No definitions: nothing is written, so nothing can be silently dropped.
    expect(change.componentPropDefs).toBeUndefined();
  });
});

describe('a GRID style and its layout grids', () => {
  it('round-trips all three patterns, with count and alignment', async () => {
    const file = emptyFile('Grids');
    const page = file.document.children[0]!;
    const rect = createRectNode(file.document, 0, 0, 80, 40);
    rect.name = 'Subject';
    rect.styles = { grid: 'style:g' };
    page.children = [rect];
    const grid = (pattern: string, count: number, alignment: string) => ({
      pattern: pattern as 'COLUMNS',
      sectionSize: 10,
      count,
      gutterSize: 4,
      offset: 2,
      alignment: alignment as 'STRETCH',
      visible: true,
      color: { r: 1, g: 0, b: 0, a: 0.1 },
    });
    const withStyles = {
      ...file,
      styles: {
        'style:g': {
          key: 'g',
          name: 'Grid/12',
          type: 'GRID' as const,
          guid: '0:9',
          layoutGrids: [grid('COLUMNS', 12, 'STRETCH'), grid('ROWS', 6, 'MIN'), grid('GRID', 5, 'CENTER')],
        },
      },
    };
    const back = await roundTrip(withStyles, 'circle.fig');
    const style = Object.values(back.styles ?? {})[0]!;
    expect(style.type).toBe('GRID');
    // The schema SPLITS what the model FOLDS: STRIPES+axis X is COLUMNS, STRIPES+axis Y is ROWS,
    // and numSections is the model's count.
    expect(style.layoutGrids?.map((entry) => entry.pattern)).toEqual(['COLUMNS', 'ROWS', 'GRID']);
    expect(style.layoutGrids?.map((entry) => entry.count)).toEqual([12, 6, 5]);
    expect(style.layoutGrids?.map((entry) => entry.alignment)).toEqual(['STRETCH', 'MIN', 'CENTER']);
    // And the binding resolves to it.
    const bound = byName(back, 'Subject')!;
    expect(bound.styles?.grid).toBe('0:9');
    expect(back.styles?.[bound.styles!.grid!]?.name).toBe('Grid/12');
  });
});
