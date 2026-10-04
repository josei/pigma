import { test, expect } from '@playwright/test';
import { encodeCommandsBlob, pigmaToFigMessage, type ModelExportOptions } from '../../src/figma/native/modelExport';
import { decodeCommandsBlob } from '../../src/figma/native/vector';
import { emptyFile } from '../../src/model/validate';
import { createRectNode } from '../../src/model/factory';
import type { ContainerNode, SceneNode } from '../../src/model/types';

/**
 * The two rows docs/FIGMA_COMPAT.md marked as DOCUMENTED-FROM-CODE, tested
 * against the real code: float32 precision and path-data command loss.
 *
 * Runs in Node against the exported functions - no app, no browser.
 */
function exportOptions(extra: Partial<ModelExportOptions> = {}): ModelExportOptions {
  return {
    schemaFrom: new Uint8Array([1, 2, 3]),
    decompress: { inflateRaw: (bytes) => bytes, zstd: (bytes) => bytes },
    ...extra,
  };
}

/** A real round trip through the commands-blob codec: SVG path -> bytes -> commands. */
function throughBlob(pathData: string) {
  const bytes = encodeCommandsBlob(pathData);
  return bytes === null ? null : decodeCommandsBlob(bytes);
}

test('B43a a high-precision coordinate comes back at float32 precision, not verbatim', () => {
  // 0.1 is not representable in binary floating point at any width; float32
  // rounds it further than float64 does.
  const precise = 0.1;
  expect(Math.fround(precise), 'float32 should actually differ from float64 here').not.toBe(precise);

  const commands = throughBlob(`M ${precise} 0 L 10 10`);
  expect(commands, 'the path was rejected').not.toBeNull();

  const move = commands![0]!;
  expect(move.type).toBe('moveTo');
  const x = (move as { x: number }).x;

  // The wire is float32: the value is the float32 rounding of the input, exactly.
  expect(x, 'the coordinate did not survive at float32 precision').toBe(Math.fround(precise));
  expect(x, 'the float64 value was written verbatim - no truncation happened').not.toBe(precise);
  // And the error is bounded by float32 epsilon, not unbounded.
  expect(Math.abs(x - precise)).toBeLessThan(1e-7);
});

test('B43b a high-precision COLOUR passes the message layer untouched', () => {
  const file = emptyFile('Colour');
  const page = file.document.children[0] as unknown as ContainerNode;
  const rect = createRectNode(null, 0, 0, 10, 10) as unknown as SceneNode & {
    fills: Array<Record<string, unknown>>;
  };
  // A colour no real design would use, but exactly representable in float64 and
  // NOT in float32 - so any truncation downstream is visible.
  rect.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.3, b: 0.7, a: 0.5 } }];
  page.children = [rect];

  const { message } = pigmaToFigMessage(file, exportOptions());
  const changes = message.nodeChanges as Array<Record<string, unknown>>;
  // The exporter names this key `fillPaints`, not `fills`.
  const emitted = changes.find((change) => change.name === rect.name) as
    | { fillPaints?: Array<{ color: { r: number; a: number } }> }
    | undefined;

  expect(emitted?.fillPaints, 'the fill did not reach the message').toBeDefined();
  // The mapper does NOT round: it hands the float64 value to the wire, and the
  // float32 truncation happens in the binary codec (kiwi.ts), which needs a real
  // `.fig` schema + compressors to drive - that part is documented-from-code.
  expect(emitted!.fillPaints![0]!.color.r, 'the message layer rounded a colour').toBe(0.1);
  expect(Math.fround(0.1)).not.toBe(0.1);

  // A separate documented approximation, asserted here because it sits next to
  // the colour: a solid fill's alpha is written as 1 regardless of the source.
  expect(emitted!.fillPaints![0]!.color.a, 'alpha was expected to be forced to 1').toBe(1);
});

test('B43c move/line/cubic/close survive the commands-blob round trip', () => {
  const commands = throughBlob('M 0 0 L 10 0 C 12 0 14 2 14 5 Z');
  expect(commands).not.toBeNull();
  expect(commands!.map((c) => c.type)).toEqual(['moveTo', 'lineTo', 'cubicTo', 'close']);
});

test('B43d horizontal and vertical lines are normalised to lineTo, not preserved', () => {
  // The encoder writes H/V as lineTo opcodes (0x02). The geometry is right, but
  // the command spelling is an approximation - worth stating, not hiding.
  const commands = throughBlob('M 0 0 H 10 V 20');
  expect(commands).not.toBeNull();
  expect(commands!.map((c) => c.type)).toEqual(['moveTo', 'lineTo', 'lineTo']);

  const vertical = commands![2] as { x: number; y: number };
  expect(vertical.x, 'the vertical line lost its x position').toBe(10);
  expect(vertical.y).toBe(20);
});

test('B43e smooth/quadratic/arc commands are rejected, omitting the geometry', () => {
  // S, Q, T and A have no opcode: the encoder returns null for the whole path.
  for (const [name, d] of [
    ['smooth cubic (S)', 'M 0 0 C 1 1 2 2 3 3 S 4 4 5 5'],
    ['quadratic (Q)', 'M 0 0 Q 5 5 10 0'],
    ['smooth quadratic (T)', 'M 0 0 Q 5 5 10 0 T 20 0'],
    ['arc (A)', 'M 0 0 A 5 5 0 0 1 10 10'],
  ] as Array<[string, string]>) {
    expect(encodeCommandsBlob(d), `${name} should be reported as unsupported`).toBeNull();
  }
});

test('B43f one unsupported command discards the WHOLE path, not just that segment', () => {
  // The documented behaviour is "geometry is omitted"; the precise behaviour is
  // all-or-nothing: a path whose first segments are perfectly representable is
  // still dropped entirely once any command is unsupported.
  expect(encodeCommandsBlob('M 0 0 L 10 0')).not.toBeNull();
  expect(
    encodeCommandsBlob('M 0 0 L 10 0 A 5 5 0 0 1 10 10'),
    'a partly-representable path was not discarded',
  ).toBeNull();
});
