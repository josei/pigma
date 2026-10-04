/**
 * The MCP write path settles derived geometry before committing.
 *
 * A document built entirely through the MCP must not be left with stale derived
 * state: an auto-sized text box has to follow its content, and a
 * `BOOLEAN_OPERATION` has to re-evaluate when an operand moves. The editor's
 * store has always run these passes; the MCP path went through the session
 * without them, so `get_metadata`, `get_design_context` and `get_screenshot`
 * all reported a box that disagreed with the text.
 *
 * These tests drive everything through the MCP (no browser, no direct model
 * writes) and compare against the model's own settled answer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpServer, type McpServer } from '../../src/mcp/protocol';
import { createSession, type DocumentSession } from '../../src/mcp/session';
import { createPersistingSession } from '../../src/mcp/bin';
import { emptyFile } from '../../src/model/validate';
import { createRectNode } from '../../src/model/factory';
import { booleanNodes } from '../../src/model/boolean';
import { settleDocument } from '../../src/model/settle';
import { findNode } from '../../src/model/tree';
import type { ContainerNode, PigmaFile } from '../../src/model/types';

vi.setConfig({ testTimeout: 60_000 });

type ToolResult = {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
};

const call = (server: McpServer, name: string, args: Record<string, unknown>) =>
  server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).then(
    (response) => (response as { result?: ToolResult }).result,
  );

const workspaces: string[] = [];

afterEach(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh MCP server with an empty session, plus the session for inspection. */
async function serverWithDocument(): Promise<{ server: McpServer; session: DocumentSession }> {
  const session = createSession(null);
  const server = createMcpServer({ session });
  const created = await call(server, 'create_new_file', { name: 'Settle', editorType: 'design' });
  expect(created?.isError).toBeFalsy();
  return { server, session };
}

describe('an auto-sized text box follows its content through the MCP', () => {
  it('reports the settled box in get_metadata, not the hardcoded creation box', async () => {
    const { server, session } = await serverWithDocument();

    const made = await call(server, 'use_pigma', {
      code: "const t = figma.createText({ characters: 'Hello world', x: 0, y: 0 }); t.fontSize = 40; t.id;",
    });
    expect(made?.isError).toBeFalsy();
    const nodeId = String(made?.structuredContent?.output ?? '');
    expect(nodeId).not.toBe('');

    // The node as stored by the session is already settled…
    const stored = findNode(session.getFile()!.document, nodeId) as { width: number; height: number };
    // …which is the same box the model computes for this content and style.
    const settled = findNode(settleDocument(session.getFile()!).document, nodeId) as { width: number; height: number };
    expect({ width: stored.width, height: stored.height }).toEqual({ width: settled.width, height: settled.height });

    // The creation box (createTextNode's 100 x 16.8) must be gone.
    expect(stored.width).not.toBe(100);
    expect(stored.height).not.toBe(16.8);
    expect(stored.width).toBeGreaterThan(150);
    expect(stored.height).toBeGreaterThan(30);

    // And what a client reads agrees with what is stored.
    const metadata = await call(server, 'get_metadata', { nodeId });
    const text = metadata?.content?.[0]?.text ?? '';
    expect(text).toContain(`width="${stored.width}"`);
    expect(text).toContain(`height="${stored.height}"`);
  });

  it('keeps the box in step when the text or the size changes later', async () => {
    const { server, session } = await serverWithDocument();
    const made = await call(server, 'use_pigma', {
      code: "const t = figma.createText({ characters: 'short', x: 0, y: 0 }); t.fontSize = 12; t.id;",
    });
    const nodeId = String(made?.structuredContent?.output ?? '');
    const first = findNode(session.getFile()!.document, nodeId) as { width: number };

    await call(server, 'use_pigma', { code: `figma.getNodeById('${nodeId}').fontSize = 48; 'x';` });
    const second = findNode(session.getFile()!.document, nodeId) as { width: number; height: number };

    // Bigger text, bigger box — the derived geometry followed the change.
    expect(second.width).toBeGreaterThan(first.width);
    const settled = findNode(settleDocument(session.getFile()!).document, nodeId) as { width: number; height: number };
    expect({ width: second.width, height: second.height }).toEqual({ width: settled.width, height: settled.height });
  });
});

describe('a boolean operation re-evaluates through the MCP', () => {
  /** The same operands built directly with the model, as the reference answer. */
  const modelUnion = (): string => {
    const file = emptyFile('Reference');
    const page = file.document.children[0]!;
    const a = createRectNode(null, 0, 0, 40, 40);
    const b = createRectNode(null, 20, 20, 40, 40);
    page.children = [a, b];
    const result = booleanNodes(file, [a.id, b.id], 'UNION');
    const node = findNode(result.file.document, result.nodeId as string) as { pathData?: string };
    return node.pathData ?? '';
  };

  it('matches a fresh evaluation of the same operands', async () => {
    const { server, session } = await serverWithDocument();
    const made = await call(server, 'use_pigma', {
      code: `
        const a = figma.createRectangle({ x: 0, y: 0, width: 40, height: 40 });
        const b = figma.createRectangle({ x: 20, y: 20, width: 40, height: 40 });
        figma.union([a, b], figma.currentPage).id;
      `,
    });
    expect(made?.isError).toBeFalsy();
    const unionId = String(made?.structuredContent?.output ?? '');

    const node = findNode(session.getFile()!.document, unionId) as ContainerNode & { pathData?: string };
    expect(node.type).toBe('BOOLEAN_OPERATION');
    expect(node.pathData ?? '').not.toBe('');
    // Settled through the MCP == what the model computes for those operands.
    expect(node.pathData).toBe(modelUnion());
    // The operands are still there (the operation stays inspectable).
    expect(node.children).toHaveLength(2);
  });

  it('re-evaluates when an operand moves', async () => {
    const { server, session } = await serverWithDocument();
    const made = await call(server, 'use_pigma', {
      code: `
        const a = figma.createRectangle({ x: 0, y: 0, width: 40, height: 40 });
        const b = figma.createRectangle({ x: 20, y: 20, width: 40, height: 40 });
        figma.union([a, b], figma.currentPage).id;
      `,
    });
    const unionId = String(made?.structuredContent?.output ?? '');
    const before = (findNode(session.getFile()!.document, unionId) as { pathData?: string }).pathData ?? '';
    expect(before).not.toBe('');

    // Move the first operand through the MCP: the boolean must follow.
    const moved = await call(server, 'use_pigma', {
      code: `const u = figma.getNodeById('${unionId}'); u.children[0].x = 60; u.id;`,
    });
    expect(moved?.isError).toBeFalsy();

    const after = (findNode(session.getFile()!.document, unionId) as { pathData?: string }).pathData ?? '';
    expect(after).not.toBe(before);
    // Still settled: a second settle pass changes nothing.
    const settled = findNode(settleDocument(session.getFile()!).document, unionId) as { pathData?: string };
    expect(settled.pathData).toBe(after);
  });
});

describe('settling is idempotent and does not churn', () => {
  it('returns the same document object the second time', async () => {
    const { server, session } = await serverWithDocument();
    await call(server, 'use_pigma', {
      code: `
        const t = figma.createText({ characters: 'Idempotence', x: 0, y: 0 });
        t.fontSize = 24;
        const a = figma.createRectangle({ x: 0, y: 60, width: 40, height: 40 });
        const b = figma.createRectangle({ x: 20, y: 80, width: 40, height: 40 });
        figma.union([a, b], figma.currentPage);
        'done';
      `,
    });

    const once = settleDocument(session.getFile()!);
    const twice = settleDocument(once);
    // Identity, not just equality: nothing was rebuilt, so nothing churned.
    expect(twice).toBe(once);
    expect(twice.document).toBe(once.document);
    // And a third write through the session changes nothing either.
    const stored = session.getFile()!;
    session.setFile(stored);
    expect(session.getFile()!.document).toBe(stored.document);
  });
});

describe('the session is the choke point', () => {
  it('settles any file handed to it, so no tool can forget', () => {
    const file = emptyFile('Direct');
    const page = file.document.children[0]!;
    // A text node with the wrong box, as a tool would produce it.
    const text = { ...createRectNode(null, 0, 0, 100, 17), type: 'TEXT' as const, characters: 'Direct write', style: { fontFamily: 'Inter', fontSize: 40, fontWeight: 400, textAutoResize: 'WIDTH_AND_HEIGHT' as const } };
    page.children = [text as never];

    const session = createSession(file);
    session.setFile({ ...file, document: { ...file.document, children: [{ ...page, children: [text as never] }, ...file.document.children.slice(1)] } });
    const stored = findNode(session.getFile()!.document, text.id) as { width: number; height: number };
    expect(stored.width).toBeGreaterThan(150);
    expect(stored.height).toBeGreaterThan(30);
  });

  it('persists the settled document, not the raw write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pigma-settle-'));
    workspaces.push(dir);
    const path = join(dir, 'doc.json');

    const session = createPersistingSession(createSession(null), path);
    const file = emptyFile('Persisted');
    const page = file.document.children[0]!;
    const text = { ...createRectNode(null, 0, 0, 100, 17), type: 'TEXT' as const, characters: 'Persisted text', style: { fontFamily: 'Inter', fontSize: 40, fontWeight: 400, textAutoResize: 'WIDTH_AND_HEIGHT' as const } };
    page.children = [text as never];
    session.setFile(file);

    // Memory and disk agree, and both hold the settled box.
    const stored = findNode(session.getFile()!.document, text.id) as { width: number };
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as PigmaFile;
    const persisted = findNode(onDisk.document, text.id) as { width: number; height: number };
    expect(persisted.width).toBe(stored.width);
    expect(persisted.width).toBeGreaterThan(150);
  });
});
