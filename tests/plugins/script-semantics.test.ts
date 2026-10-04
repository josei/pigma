/**
 * Plugin script semantics.
 *
 * In Figma a plugin script is always an async function body, so a top-level
 * `return` is legal and idiomatic. The engine used to wrap the script only when
 * it contained `await`, so `return value;` was a bare SyntaxError unless the
 * script happened to await something. These tests pin the whole contract: a
 * top-level return with and without await, the `figma.on('run')` entry point,
 * eval's completion value for a plain expression script, and a clear failure for
 * a script that genuinely does not compile.
 */
import { describe, expect, it } from 'vitest';
import { getQuickJS } from 'quickjs-emscripten';
import { createPluginEngine, type PluginEngineLoader, type QuickJSModuleLike } from '../../src/plugins/engine';
import { emptyFile } from '../../src/model/validate';
import type { PigmaFile } from '../../src/model/types';

const nodeLoader: PluginEngineLoader = async () => (await getQuickJS()) as unknown as QuickJSModuleLike;
const engine = createPluginEngine(nodeLoader);

function scene(): PigmaFile {
  return emptyFile('Script semantics');
}

async function run(code: string, file = scene()) {
  return engine.run(code, file);
}

async function failure(code: string): Promise<string> {
  try {
    await run(code);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Every node id in the document, at any depth. */
function ids(file: PigmaFile): string[] {
  const out: string[] = [];
  const walk = (node: { id: string; children?: Array<{ id: string }> }): void => {
    out.push(node.id);
    for (const child of (node.children ?? []) as Array<{ id: string; children?: unknown[] }>) walk(child as { id: string });
  };
  for (const child of file.document.children[0]!.children) walk(child as { id: string });
  return out;
}

describe('plugin script semantics', () => {
  it('returns a top-level return value with no await', async () => {
    const result = await run(`
      const text = figma.createText({ characters: 'Returned' });
      return 'value:' + text.id;
    `);
    expect(String(result.output).startsWith('value:')).toBe(true);
  });

  it('returns a top-level return value with await', async () => {
    const result = await run(`
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      const text = figma.createText({ characters: 'Awaited' });
      text.fontSize = 18;
      return { id: text.id, size: text.fontSize };
    `);
    expect(result.output).toEqual(expect.objectContaining({ size: 18 }));
  });

  it('keeps eval completion value for a script with no return', async () => {
    const result = await run(`
      const text = figma.createText({ characters: 'Completion' });
      text.fontSize = 24;
      text.fontSize;
    `);
    expect(result.output).toBe(24);
  });

  it('is not confused by the word await in a string or comment', async () => {
    // The old wrapper sniffed for /\bawait\b/ anywhere in the source.
    const result = await run(`
      // await is only mentioned here
      const label = 'await me';
      label;
    `);
    expect(result.output).toBe('await me');
  });

  it('lets figma.on("run") win over the script value', async () => {
    const result = await run(`
      figma.on('run', function () { return 'from the run handler'; });
      'from the script body';
    `);
    expect(result.output).toBe('from the run handler');
  });

  it('returns the run handler value when the script also returns one', async () => {
    const result = await run(`
      figma.on('run', function () { return 'handler'; });
      return 'script';
    `);
    expect(result.output).toBe('handler');
  });

  it('awaits an async run handler', async () => {
    const result = await run(`
      figma.on('run', async function () {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        return 'async handler';
      });
    `);
    expect(result.output).toBe('async handler');
  });

  it('fails clearly on a script that is not valid JavaScript', async () => {
    const message = await failure('const = ;');
    expect(message).toContain('Plugin script failed');
    expect(message, 'the failure should say it is a syntax error').toMatch(/not valid JavaScript|SyntaxError/);
  });

  it('does not retry a script that failed at runtime', async () => {
    // Only a syntax error is retried. A runtime failure must not run twice, so
    // the node the script created before throwing exists exactly once.
    const result = await run(`
      const text = figma.createText({ characters: 'Once' });
      text.fontSize = 20;
      text.fontSize;
    `);
    expect(ids(result.file)).toHaveLength(1);
    const message = await failure(`
      const text = figma.createText({ characters: 'Once' });
      text.fontSize = 20;
      figma.currentPage.selection = [{ id: 'nope:1' }];
    `);
    expect(message).toContain('Unknown node id');
    expect(message, 'a runtime failure must not be reported as a syntax error').not.toContain('not valid JavaScript');
  });

  it('runs exactly once when a runtime SyntaxError is thrown', async () => {
    // The retry must be gated on a COMPILE failure, not on an error's name. The
    // throw reports the page's child count at that moment: 1 is the node the
    // script created itself, 2 would mean the whole script ran a second time.
    const probe = (form: 'plain' | 'async' | 'object'): string => {
      const create = "figma.createFrame({ name: 'Once' });";
      const thrower = `'children=' + figma.currentPage.children.length`;
      if (form === 'object') return `${create}\nthrow { name: 'SyntaxError', message: ${thrower} };`;
      if (form === 'async') {
        return `await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });\n${create}\nthrow new SyntaxError(${thrower});`;
      }
      return `${create}\nthrow new SyntaxError(${thrower});`;
    };
    for (const form of ['plain', 'async', 'object'] as const) {
      const message = await failure(probe(form));
      expect(message, `${form}: the runtime error should be reported as-is`).toContain('children=1');
      expect(message, `${form}: the script must not run twice`).not.toContain('children=2');
      expect(message, `${form}: a runtime failure is not a syntax error`).not.toContain('not valid JavaScript');
    }
  });

  it('still reports unsupported API members', async () => {
    expect(await failure('figma.createText({}).fontVariations = [];')).toContain('Unsupported Plugin API property');
  });
});
