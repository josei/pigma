import { describe, expect, it } from 'vitest';
import { flattenFrameOp } from './flatten';
import { createFrameNode, createGroupNode, createRectNode, createTextNode } from './factory';
import { absoluteBounds, findNode } from './tree';
import { emptyFile } from './validate';
import type { ContainerNode, PigmaFile, SceneNode } from './types';

const RED = [{ type: 'SOLID' as const, color: { r: 1, g: 0, b: 0 }, opacity: 1 }];

/** A 200x200 frame at (0,0) holding the given shapes; the frame is on the page. */
function setup(children: SceneNode[], clipsContent = true): { file: PigmaFile; frameId: string } {
  const file = emptyFile('Flatten');
  const page = file.document.children[0]!;
  const frame = createFrameNode(file.document, 0, 0, 200, 200) as ContainerNode;
  frame.name = 'Card';
  frame.fills = RED;
  frame.clipsContent = clipsContent;
  frame.children = children;
  page.children = [frame];
  return { file, frameId: frame.id };
}

const topLevel = (file: PigmaFile) => file.document.children[0]!.children;

describe('flatten a frame', () => {
  it('unions its shapes into one layer that takes the frame\'s name and fill', () => {
    const a = createRectNode(null, 20, 20, 100, 100);
    const b = createRectNode(null, 60, 60, 100, 100);
    const { file, frameId } = setup([a, b], false);
    const result = flattenFrameOp(file, frameId);
    expect(result.reason).toBeUndefined();
    const layers = topLevel(result.file);
    expect(layers, 'the frame was not replaced by one layer').toHaveLength(1);
    expect(layers[0]!.type).not.toBe('FRAME');
    expect(layers[0]!.name).toBe('Card');
    expect((layers[0] as { fills: unknown[] }).fills).toEqual(RED);
    expect(result.nodeId).toBe(layers[0]!.id);
  });

  it('clips the result to the frame when the frame clips its content', () => {
    // The second shape overhangs the frame's right and bottom edges by 20.
    const a = createRectNode(null, 20, 20, 100, 100);
    const b = createRectNode(null, 120, 120, 100, 100);
    const { file, frameId } = setup([a, b], true);
    const result = flattenFrameOp(file, frameId);
    expect(result.reason).toBeUndefined();
    const bounds = absoluteBounds(result.file.document, result.nodeId!)!;
    expect(bounds.x + bounds.width, 'the result overhangs the frame').toBeLessThanOrEqual(200 + 0.5);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(200 + 0.5);
  });

  it('keeps the overhang when the frame does not clip', () => {
    const a = createRectNode(null, 20, 20, 100, 100);
    const b = createRectNode(null, 120, 120, 100, 100);
    const { file, frameId } = setup([a, b], false);
    const result = flattenFrameOp(file, frameId);
    const bounds = absoluteBounds(result.file.document, result.nodeId!)!;
    expect(bounds.x + bounds.width).toBeGreaterThan(200);
  });

  it('refuses an empty frame, a frame with empty text, and a frame with a line', () => {
    const empty = setup([], true);
    expect(flattenFrameOp(empty.file, empty.frameId).reason).toMatch(/no shapes/);
    const blank = createTextNode(null, 0, 0, '');
    const withBlank = setup([blank, createRectNode(null, 0, 0, 40, 40)], true);
    expect(flattenFrameOp(withBlank.file, withBlank.frameId).reason).toMatch(/empty/);
    const group = createGroupNode([createRectNode(null, 0, 0, 10, 10)]);
    const withGroup = setup([group], true);
    expect(flattenFrameOp(withGroup.file, withGroup.frameId).reason).toMatch(/shapes or text/);
  });

  it('refuses a frame with text the outline cannot draw, and leaves the tree alone', () => {
    const georgia = createTextNode(null, 0, 0, 'Hi', { fontFamily: 'Georgia' });
    const { file, frameId } = setup([georgia, createRectNode(null, 0, 150, 200, 20)], true);
    const result = flattenFrameOp(file, frameId);
    expect(result.reason).toMatch(/Inter text only/);
    expect(result.file).toBe(file);
    expect(findNode(result.file.document, georgia.id), 'the text was changed by a refused flatten').not.toBeNull();
  });

  it('flattens text into its outline, so a frame of text and shapes becomes one path', () => {
    const text = createTextNode(null, 20, 20, 'Hi', { fontSize: 24 });
    const { file, frameId } = setup([text, createRectNode(null, 0, 150, 200, 20)], true);
    const result = flattenFrameOp(file, frameId);
    expect(result.reason).toBeUndefined();
    const layer = findNode(result.file.document, result.nodeId!) as SceneNode & { pathData?: string };
    expect(layer.type).toBe('VECTOR');
    expect(layer.pathData, 'the text did not become a path').toMatch(/^M/);
    expect(findNode(result.file.document, text.id), 'the text layer survived the flatten').toBeNull();
  });

  it('refuses something that is not a frame', () => {
    const rect = createRectNode(null, 0, 0, 40, 40);
    const { file } = setup([rect], true);
    expect(flattenFrameOp(file, rect.id).reason).toMatch(/Select a frame/);
    expect(findNode(file.document, rect.id)).not.toBeNull();
  });
});

describe('flatten a frame that is not at the origin', () => {
  it('clips against the frame where it sits, not at the origin', () => {
    const file = emptyFile('Offset');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 300, 200, 200, 200) as ContainerNode;
    frame.name = 'Card';
    frame.fills = RED;
    frame.clipsContent = true;
    // Children are in the frame's own coordinates: (20,20) is the frame's top-left inset.
    frame.children = [createRectNode(null, 20, 20, 100, 100), createRectNode(null, 120, 120, 100, 100)];
    page.children = [frame];
    const result = flattenFrameOp(file, frame.id);
    expect(result.reason, 'an offset frame was refused as if outside its own frame').toBeUndefined();
    const bounds = absoluteBounds(result.file.document, result.nodeId!)!;
    expect(bounds.x).toBeCloseTo(320, 0);
    expect(bounds.y).toBeCloseTo(220, 0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(500 + 0.5);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(400 + 0.5);
  });
});

describe('a flattened layer is static', () => {
  it('is a vector with its outline and no operands, and re-evaluation leaves it alone', async () => {
    const a = createRectNode(null, 20, 20, 100, 100);
    const b = createRectNode(null, 60, 60, 100, 100);
    const { file, frameId } = setup([a, b], false);
    const result = flattenFrameOp(file, frameId);
    const layer = findNode(result.file.document, result.nodeId!) as unknown as { type: string; pathData?: string; children?: unknown[] };
    expect(layer.type).toBe('VECTOR');
    expect(layer.pathData, 'the outline was lost').toBeTruthy();
    expect(layer.children, 'a flattened layer still has operands').toBeUndefined();
    const { refreshBooleans } = await import('./boolean');
    const again = refreshBooleans(result.file.document);
    expect(findNode(again, result.nodeId!)).toEqual(layer);
  });
});
