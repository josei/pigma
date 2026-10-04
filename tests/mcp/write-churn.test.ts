/**
 * No-churn guarantee for MCP writes, at scale.
 *
 * Every MCP write funnels through `DocumentSession.setFile`, which settles
 * derived geometry and validates before storing. Both passes must be pure and
 * idempotent: a repeated write of an unchanged document must store the SAME file
 * object, so nothing downstream sees a spurious change.
 *
 * **Fixture**: this file's own `largeFile()` — one page holding a frame with 1000
 * rectangles and 1000 auto-sized text nodes, 2003 nodes in total.
 *
 * **Measured on the current tree** (median after warm-up, on this machine):
 *
 * | case | ms |
 * | --- | --- |
 * | settle no-op (already-settled document) | 0.47 |
 * | validate alone | 0.37 |
 * | full `setFile`, **unchanged** document — the no-op figure | 0.83 |
 * | full `setFile`, one node changed | 0.85 |
 * | full `setFile`, every text box changed (1000 nodes) | 1.53 |
 * | first settle of a freshly built document | 3.24 |
 * | `JSON.stringify` of the same document (what the app pays per save) | 3.68 |
 *
 * Two things the numbers say. A full `setFile` of an **unchanged** document is
 * 0.83 ms — that is the no-op figure, not the cost of every write; a write that
 * actually changes something costs 0.85–1.53 ms depending on how much changed,
 * because the settle work tracks the change rather than the document. And even
 * the heaviest of those is cheaper than the 3.68 ms JSON serialisation the app
 * already pays per save.
 *
 * The first settle of a freshly built document used to be far more expensive here
 * (77 ms) because `syncTextSizes` applied each measured box with its own
 * root-walking `updateNode` call, O(changed × nodes). It now applies them in one
 * traversal, which is why the first settle is 3.24 ms and a heavy real write is
 * 1.53 ms. Steady state is unchanged, and the same file object comes back at every
 * size — the identity assertions below are the point of this file.
 */
import { describe, expect, it } from 'vitest';
import { emptyFile } from '../../src/model/validate';
import { createFrameNode, createRectNode, createTextNode } from '../../src/model/factory';
import { settleDocument } from '../../src/model/settle';
import { createSession } from '../../src/mcp/session';
import { documentProblems } from '../../src/model/invariants';
import type { AnyNode, PigmaFile } from '../../src/model/types';

/** A frame holding 1000 rectangles and 1000 text nodes: ~2000 nodes. */
function largeFile(): PigmaFile {
  const file = emptyFile('Large');
  const page = file.document.children[0]!;
  const frame = createFrameNode(file.document, 0, 0, 4000, 4000);
  const children = [];
  for (let i = 0; i < 1000; i += 1) {
    children.push(createRectNode(file.document, (i % 40) * 100, Math.floor(i / 40) * 100, 80, 60));
    const text = createTextNode(file.document, (i % 40) * 100, Math.floor(i / 40) * 100 + 60, `Label ${i}`);
    text.style = { ...text.style, textAutoResize: 'WIDTH_AND_HEIGHT' };
    children.push(text);
  }
  frame.children = children;
  page.children = [frame];
  return file;
}

function count(node: AnyNode): number {
  const children = 'children' in node ? (node.children as AnyNode[]) : [];
  return 1 + children.reduce((sum, child) => sum + count(child), 0);
}

describe('MCP writes do not churn', () => {
  it('stores the same file object when a settled document is written again', () => {
    const file = largeFile();
    expect(count(file.document)).toBeGreaterThan(2000);

    // The first settle does the derived-geometry work and produces a new object.
    const settled = settleDocument(file);
    expect(settled).not.toBe(file);
    expect(documentProblems(settled)).toEqual([]);

    // From then on every pass is a no-op, by identity.
    expect(settleDocument(settled)).toBe(settled);
    expect(settleDocument(settleDocument(settled))).toBe(settled);

    const session = createSession(settled);
    expect(session.getFile()).toBe(settled);
    session.setFile(settled);
    expect(session.getFile(), 'a repeated write rebuilt the document').toBe(settled);
    session.setFile(session.getFile()!);
    expect(session.getFile()).toBe(settled);
  });

  it('rejects an invalid write without storing anything', () => {
    const session = createSession(emptyFile('Valid'));
    const stored = session.getFile();
    const broken = largeFile();
    const frame = broken.document.children[0]!.children[0]!;
    (frame as { opacity: number }).opacity = 5;
    // The refusal must name the node and the field, so a harness can act on it.
    let message = '';
    try {
      session.setFile(broken);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/invalid/i);
    expect(message, 'the refusal should name the field').toContain('opacity must be between 0 and 1');
    expect(message, 'the refusal should name the node').toContain(frame.id);
    expect(message).toContain(frame.name);
    expect(session.getFile(), 'a rejected write must leave the previous document').toBe(stored);
  });
});
