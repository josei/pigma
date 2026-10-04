/**
 * The MCP write path's document invariants.
 *
 * The editor's own actions cannot produce these states — its ops clamp and
 * validate — but a plugin script can, and before this guard the MCP committed
 * them. Each case below was reached with a hostile script through the real call
 * path; the ones marked unreachable are asserted to *stay* unreachable, so a
 * future change that opens them fails here.
 */
import { describe, expect, it, vi } from 'vitest';
import { createMcpServer, type McpServer } from '../../src/mcp/protocol';
import { createSession, type DocumentSession } from '../../src/mcp/session';
import { documentProblems, isCommittable } from '../../src/mcp/invariants';
import { emptyFile } from '../../src/model/validate';
import { createRectNode, createTextNode } from '../../src/model/factory';
import { findNode, descendants } from '../../src/model/tree';
import type { CanvasNode, PigmaFile, SceneNode } from '../../src/model/types';

vi.setConfig({ testTimeout: 60_000 });

type ToolResult = { isError?: boolean; content?: Array<{ type?: string; text?: string }>; structuredContent?: Record<string, unknown> };

const run = (server: McpServer, name: string, args: Record<string, unknown>) =>
  server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).then(
    (response) => (response as { result?: ToolResult }).result,
  );

const textOf = (result: ToolResult | undefined): string => (result?.content ?? []).map((item) => item.text ?? '').join('\n');

/** A server with a fresh document, plus the session so the commit can be inspected. */
async function freshServer(): Promise<{ server: McpServer; session: DocumentSession }> {
  const session = createSession(null);
  const server = createMcpServer({ session });
  expect((await run(server, 'create_new_file', { name: 'Invariants', editorType: 'design' }))?.isError).toBeFalsy();
  return { server, session };
}

describe('reachable invalid states are refused with a clear error', () => {
  const cases: Array<[string, string, RegExp]> = [
    [
      'a negative size from resize',
      "const r = figma.createRectangle({ width: 5, height: 5 }); r.resize(-10, -10); 'done';",
      /width must not be negative/,
    ],
    [
      'a malformed fill colour',
      "const r = figma.createRectangle({ width: 5, height: 5 }); r.fills = [{ type: 'SOLID', color: { r: 'x', g: 0, b: 0 } }]; 'done';",
      /colour\.r must be a finite number/,
    ],
    [
      'a colour channel out of range',
      "const r = figma.createRectangle({ width: 5, height: 5 }); r.fills = [{ type: 'SOLID', color: { r: 255, g: 0, b: 0 } }]; 'done';",
      /colour\.r must be between 0 and 1/,
    ],
    [
      'an opacity outside 0..1',
      "const r = figma.createRectangle({ width: 5, height: 5 }); r.opacity = 42; 'done';",
      /opacity must be between 0 and 1/,
    ],
    [
      'a malformed effect colour',
      "const r = figma.createRectangle({ width: 5, height: 5 }); r.effects = [{ type: 'DROP_SHADOW', color: { r: NaN, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 2 }, radius: 4 }]; 'done';",
      /effect\[0\]: colour\.r must be a finite number/,
    ],
    [
      'a child under a missing parent',
      "figma.createRectangle({ parentId: 'does-not-exist', width: 10, height: 10 }).id;",
      /Unknown parent id "does-not-exist"/,
    ],
    [
      'a child under a text node',
      "const t = figma.createText({ characters: 'x' }); figma.createRectangle({ parentId: t.id, width: 5, height: 5 }); 'done';",
      /\(TEXT\) cannot contain children/,
    ],
  ];

  for (const [label, code, pattern] of cases) {
    it(`refuses ${label}`, async () => {
      const { server, session } = await freshServer();
      const before = session.getFile()!;

      const result = await run(server, 'use_pigma', { code });
      expect(result?.isError, `${label} should be refused`).toBe(true);
      expect(textOf(result), `${label} needs a clear reason`).toMatch(pattern);

      // Nothing was committed: the session still holds the previous document.
      const after = session.getFile()!;
      expect(after.document).toBe(before.document);
      expect(documentProblems(after)).toEqual([]);
    });
  }

  it('names the node and the problem, and reports the rest when there are several', async () => {
    const { server } = await freshServer();
    const result = await run(server, 'use_pigma', {
      code: `
        const a = figma.createRectangle({ width: 5, height: 5, name: 'Bad A' });
        a.resize(-1, -1);
        const b = figma.createRectangle({ width: 5, height: 5, name: 'Bad B' });
        b.opacity = 3;
        'done';
      `,
    });
    expect(result?.isError).toBe(true);
    const text = textOf(result);
    expect(text).toMatch(/Bad A|Bad B/);
    expect(text).toMatch(/invalid/);
  });
});

describe('states a script cannot reach stay unreachable', () => {
  it('cannot duplicate a node id', async () => {
    const { server, session } = await freshServer();
    const result = await run(server, 'use_pigma', {
      code: `
        const a = figma.createRectangle({ width: 10, height: 10 });
        const b = figma.createRectangle({ width: 10, height: 10 });
        try { a.id = b.id; } catch (error) {}
        try { figma.createRectangle({ id: 'dup', width: 4, height: 4 }); } catch (error) {}
        'done';
      `,
    });
    expect(result?.isError).toBeFalsy();
    const ids = descendants(session.getFile()!.document).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cannot empty the document of pages', async () => {
    const { server, session } = await freshServer();
    const result = await run(server, 'use_pigma', { code: 'figma.currentPage.remove(); "done";' });
    expect(result?.isError).toBe(true);
    expect(session.getFile()!.document.children.length).toBeGreaterThan(0);
  });

  it('cannot give a TEXT node children, or characters to a rectangle', async () => {
    const { server, session } = await freshServer();
    await run(server, 'use_pigma', {
      code: `
        const t = figma.createText({ characters: 'x' });
        const r = figma.createRectangle({ width: 5, height: 5 });
        try { t.appendChild(r); } catch (error) {}
        try { r.characters = 'nope'; } catch (error) {}
        'done';
      `,
    });
    for (const node of descendants(session.getFile()!.document)) {
      if (node.type === 'TEXT') expect('children' in node && Array.isArray((node as { children?: unknown[] }).children)).toBe(false);
      if (node.type === 'RECTANGLE') expect('characters' in node).toBe(false);
    }
  });

  it('cannot commit a non-finite size or an unknown selection id', async () => {
    const { server, session } = await freshServer();
    for (const code of [
      "const r = figma.createRectangle({ width: 5, height: 5 }); r.width = NaN; 'done';",
      "const r = figma.createRectangle({ width: 5, height: 5 }); r.resize(Infinity, 5); 'done';",
      "figma.currentPage.selection = [{ id: 'ghost' }]; 'done';",
    ]) {
      const result = await run(server, 'use_pigma', { code });
      expect(result?.isError, code).toBe(true);
      expect(textOf(result).length, code).toBeGreaterThan(0);
    }
    for (const node of descendants(session.getFile()!.document)) {
      expect(Number.isFinite((node as { width?: number }).width ?? 0)).toBe(true);
    }
  });
});

describe('legitimate plugin results are not blocked', () => {
  it('accepts sub-pixel sizes, boundary opacities and colours, and every paint kind', async () => {
    const { server, session } = await freshServer();
    const result = await run(server, 'use_pigma', {
      code: `
        const line = figma.createRectangle({ x: 0, y: 0, width: 0.5, height: 12 });
        line.opacity = 0;
        line.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
        const solid = figma.createRectangle({ x: 0, y: 20, width: 10, height: 10 });
        solid.opacity = 1;
        solid.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }];
        const grad = figma.createRectangle({ x: 0, y: 40, width: 10, height: 10 });
        grad.fills = [{ type: 'GRADIENT_LINEAR', gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }] }];
        const shadow = figma.createRectangle({ x: 0, y: 60, width: 10, height: 10 });
        shadow.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 4 }];
        [line, solid, grad, shadow].map(function (n) { return n.id; });
      `,
    });
    expect(result?.isError, textOf(result)).toBeFalsy();
    expect(documentProblems(session.getFile()!)).toEqual([]);
  });

  it('accepts an auto-sized text box, and the settle pass keeps it valid', async () => {
    const { server, session } = await freshServer();
    const made = await run(server, 'use_pigma', {
      code: "const t = figma.createText({ characters: 'Legit label', x: 0, y: 0 }); t.fontSize = 20; t.id;",
    });
    expect(made?.isError).toBeFalsy();
    const node = findNode(session.getFile()!.document, String(made?.structuredContent?.output ?? '')) as { width: number };
    expect(node.width).toBeGreaterThan(50); // settled, not the 100px creation box
    expect(documentProblems(session.getFile()!)).toEqual([]);
  });

  it('accepts a freshly created document with an empty page', async () => {
    const session = createSession(null);
    const server = createMcpServer({ session });
    expect((await run(server, 'create_new_file', { name: 'Empty', editorType: 'design' }))?.isError).toBeFalsy();
    expect(documentProblems(session.getFile()!)).toEqual([]);
  });
});

describe('documentProblems reports each rule', () => {
  const sceneFile = (mutate: (node: SceneNode) => void): PigmaFile => {
    const file = emptyFile('Problems');
    const page = file.document.children[0] as CanvasNode;
    const node = createRectNode(null, 0, 0, 10, 10);
    mutate(node);
    page.children = [node];
    return file;
  };

  it('accepts a clean document', () => {
    expect(isCommittable(sceneFile(() => undefined))).toBe(true);
    expect(documentProblems(sceneFile(() => undefined))).toEqual([]);
  });

  it('reports geometry, opacity and colour problems, naming the node', () => {
    expect(documentProblems(sceneFile((node) => (node.width = -1)))[0]).toMatch(/width must not be negative/);
    expect(documentProblems(sceneFile((node) => (node.height = Number.NaN)))[0]).toMatch(/height must be a finite number/);
    expect(documentProblems(sceneFile((node) => (node.opacity = 1.5)))[0]).toMatch(/opacity must be between 0 and 1/);
    expect(
      documentProblems(sceneFile((node) => (node.fills = [{ type: 'SOLID', color: { r: -1, g: 0, b: 0 } }])))[0],
    ).toMatch(/colour\.r must be between 0 and 1/);
    expect(
      documentProblems(sceneFile((node) => (node.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 2 } }])))[0],
    ).toMatch(/stroke\[0\]: colour\.b must be between 0 and 1/);
  });

  it('checks gradient stops and effect colours too', () => {
    const gradient = sceneFile(
      (node) => (node.fills = [{ type: 'GRADIENT_LINEAR', gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0 } }, { position: 1, color: { r: 5, g: 0, b: 0 } }] }]),
    );
    expect(documentProblems(gradient)[0]).toMatch(/stop\[1\]: colour\.r must be between 0 and 1/);
    const effect = sceneFile(
      (node) => (node.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: Number.NaN, b: 0, a: 1 }, offset: { x: 0, y: 1 }, radius: 2 }]),
    );
    expect(documentProblems(effect)[0]).toMatch(/effect\[0\]: colour\.g must be a finite number/);
  });

  it('leaves a text node and its style alone', () => {
    const file = emptyFile('Text');
    const page = file.document.children[0] as CanvasNode;
    page.children = [createTextNode(null, 0, 0, 'Hello')];
    expect(documentProblems(file)).toEqual([]);
  });
});
