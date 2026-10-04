/**
 * The divergence inventory: enumerate our divergences from the wire, mechanically.
 *
 * §0 says "prefer Figma's shape; if we diverge, record the reason" - but the
 * divergences were all found BY HAND, one at a time, by accident. This enumerates
 * them instead of remembering them.
 *
 * It reads the REAL schema out of a `.fig` fixture (nothing is hardcoded), encodes
 * a document that exercises every node type, and diffs the field names we WRITE
 * against the field names the schema DEFINES.
 *
 * Run:  npx vite-node scripts/divergence-inventory.ts
 *
 * It reports and does NOT fix anything - the point is the count.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSeedSchema } from '../src/figma/native/export';
import { nodeDecompressors } from '../src/figma/native/node';
import { pigmaToFigMessage, type ModelExportOptions } from '../src/figma/native/modelExport';
import { emptyFile } from '../src/model/validate';
import {
  createComponentNode, createEllipseNode, createFrameNode, createLineNode, createRectNode,
  createStarNode, createTextNode, createPolygonNode,
} from '../src/model/factory';
import type { ContainerNode, PigmaFile, SceneNode } from '../src/model/types';

const fixturePath = fileURLToPath(new URL('../tests/figma/fixtures/circle.fig', import.meta.url));
const schema = readSeedSchema(new Uint8Array(readFileSync(fixturePath)), nodeDecompressors).schema;

/** Every field name the schema defines anywhere - the flat wire is mostly `NodeChange`. */
const wireFieldNames = new Set<string>();
/** The wide node message: Figma's `.fig` is flat, so this is the node vocabulary. */
const nodeChange = schema.definitions.find((d) => d.name === 'NodeChange');
for (const d of schema.definitions) for (const f of d.fields) wireFieldNames.add(f.name);
const nodeFields = new Set((nodeChange?.fields ?? []).map((f) => f.name));

/** A document exercising every node type we can create. */
function richFile(): PigmaFile {
  const file = emptyFile('Divergence');
  const page = file.document.children[0] as unknown as ContainerNode;
  const frame = createFrameNode(file.document, 0, 0, 400, 300);
  frame.name = 'Frame';
  const rect = createRectNode(file.document, 10, 10, 80, 60);
  const ellipse = createEllipseNode(file.document, 100, 10, 80, 60);
  const line = createLineNode(file.document, 10, 90, 80, 0);
  const polygon = createPolygonNode(file.document, 100, 90, 80, 60);
  const star = createStarNode(file.document, 10, 160, 80, 60);
  const text = createTextNode(file.document, 100, 160, 'Hello', { fontFamily: 'Inter', fontSize: 18 });
  const component = createComponentNode(file.document, createRectNode(file.document, 10, 240, 60, 40) as SceneNode);
  // Exercise the paths that have repeatedly gone wrong, so kind 1 is not empty
  // merely because the document is too plain.
  const carrier = rect as unknown as Record<string, unknown>;
  carrier.boundVariables = { fill: 'v-brand', cornerRadius: 'v-radius' };
  carrier.styles = { fill: 'style:1', text: 'style:2', effect: 'style:3' };
  carrier.layoutGrids = [{ pattern: 'COLUMNS', count: 4, gutterSize: 12, alignment: 'STRETCH', sectionSize: 80 }];
  carrier.minWidth = 40;
  carrier.maxWidth = 200;
  carrier.layoutAlign = 'STRETCH';
  carrier.layoutGrow = 1;
  carrier.constraints = { horizontal: 'MIN', vertical: 'MIN' };
  (text as unknown as Record<string, unknown>).textAutoResize = 'HEIGHT';
  (polygon as unknown as Record<string, unknown>).isMask = true;
  (star as unknown as Record<string, unknown>).windingRule = 'EVENODD';
  (line as unknown as Record<string, unknown>).dashPattern = [4, 2];
  (frame as unknown as Record<string, unknown>).interactions = [
    { trigger: 'ON_CLICK', actions: [{ type: 'NODE', destinationId: 'n1', navigation: 'SWAP_STATE' }] },
  ];
  (component as unknown as Record<string, unknown>).componentPropertyDefinitions = { 'Show icon': { type: 'BOOLEAN', defaultValue: true } };
  (frame as unknown as { children: SceneNode[] }).children = [rect, ellipse, line, polygon, star, text];
  page.children = [frame, component] as unknown as SceneNode[];
  return file;
}

const options: ModelExportOptions = {
  schemaFrom: new Uint8Array(readFileSync(fixturePath)),
  decompress: nodeDecompressors,
};

const { message } = pigmaToFigMessage(richFile(), options);

/** Every key our exporter writes, anywhere in the message. */
const written = new Map<string, string>();
const walk = (value: unknown, path: string): void => {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (!written.has(k)) written.set(k, path);
      walk(v, `${path}.${k}`);
    }
  }
};
walk(message, 'message');

const silentDrop = [...written.keys()].filter((k) => !nodeFields.has(k) && !wireFieldNames.has(k)).sort();
const knownElsewhere = [...written.keys()].filter((k) => !nodeFields.has(k) && wireFieldNames.has(k)).sort();
const capabilityGap = [...nodeFields.keys()].length;

console.log(`schema: ${schema.definitions.length} definitions, NodeChange has ${nodeFields.size} fields`);
console.log(`we write ${written.size} distinct field names\n`);

console.log(`--- KIND 1: WE WRITE A NAME THE SCHEMA DOES NOT DEFINE (${silentDrop.length}) ---`);
console.log(silentDrop.length ? silentDrop.map((k) => `${k}  (at ${written.get(k)})`).join('\n') : '(none)');

console.log(`\n--- KIND 2: WIRE HAS A FIELD WE NEVER WRITE (capability gap) ---`);
console.log(`NodeChange defines ${capabilityGap} fields; we write ${[...written.keys()].filter((k) => nodeFields.has(k)).length} of them`);

console.log(`\n--- KIND 3: same name, defined on a DIFFERENT message (${knownElsewhere.length}) ---`);
console.log(knownElsewhere.join(', ') || '(none)');
