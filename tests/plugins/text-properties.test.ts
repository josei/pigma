/**
 * Text properties in the Plugin API subset.
 *
 * A plugin could create a text node and set `characters`, but could not size it:
 * `fontSize` (and the rest of the TextNode text properties) failed as
 * unsupported. These tests run real scripts through the shared engine, so the
 * allowlist in `src/plugins/bootstrap.ts` and the behaviour in
 * `src/plugins/host.ts` are both exercised, on the read path as well as the
 * write path.
 */
import { describe, expect, it } from 'vitest';
import { getQuickJS } from 'quickjs-emscripten';
import { createPluginEngine, type PluginEngineLoader, type QuickJSModuleLike } from '../../src/plugins/engine';
import { emptyFile } from '../../src/model/validate';
import { parseFile, serializeFile } from '../../src/model/serialize';
import { findNode } from '../../src/model/tree';
import type { PigmaFile, TextNode } from '../../src/model/types';

const nodeLoader: PluginEngineLoader = async () => (await getQuickJS()) as unknown as QuickJSModuleLike;
const engine = createPluginEngine(nodeLoader);

function scene(): PigmaFile {
  return emptyFile('Text properties');
}

/** Run a script and hand back the resulting file plus the last expression value. */
async function run(code: string, file = scene()) {
  return engine.run(code, file);
}

/**
 * The message a script fails with. The engine throws rather than returning a
 * warning, so a failure case has to be caught to be asserted.
 */
async function failure(code: string): Promise<string> {
  try {
    await run(code);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The first TEXT node in the document. */
function textNode(file: PigmaFile, id: string): TextNode {
  const node = findNode(file.document, id);
  if (!node || node.type !== 'TEXT') throw new Error(`no TEXT node ${id}`);
  return node;
}

describe('plugin text properties', () => {
  it('sizes text: fontSize is settable and readable', async () => {
    const result = await run(`
      const text = figma.createText({ characters: 'Sized' });
      text.fontSize = 20;
      text.fontSize;
    `);
    expect(result.output).toBe(20);
    expect(textNode(result.file, result.file.document.children[0]!.children[0]!.id).style.fontSize).toBe(20);
  });

  it('sets fontName as family and style, and reads it back', async () => {
    const result = await run(`
      const text = figma.createText({ characters: 'Fonted' });
      text.fontName = { family: 'Roboto', style: 'Bold' };
      JSON.stringify(text.fontName);
    `);
    expect(result.output).toBe(JSON.stringify({ family: 'Roboto', style: 'Bold' }));
    const id = result.file.document.children[0]!.children[0]!.id;
    const style = textNode(result.file, id).style;
    expect(style.fontFamily).toBe('Roboto');
    expect(style.fontStyle).toBe('Bold');
    // Read back through the API, from a second script.
    const read = await run(`JSON.stringify(figma.getNodeById(${JSON.stringify(id)}).fontName);`, result.file);
    expect(read.output).toBe(JSON.stringify({ family: 'Roboto', style: 'Bold' }));
  });

  it('works with loadFontAsync, which the host already supports', async () => {
    // The async path returns no expression value, so the document is the proof.
    const result = await run(`
      const text = figma.createText({ characters: 'Loaded' });
      await figma.loadFontAsync({ family: 'Roboto', style: 'Bold' });
      text.fontName = { family: 'Roboto', style: 'Bold' };
      figma.notify('set');
    `);
    const id = result.file.document.children[0]!.children[0]!.id;
    const style = textNode(result.file, id).style;
    expect(style.fontFamily).toBe('Roboto');
    expect(style.fontStyle).toBe('Bold');
  });

  it('reports a fontName for a node that never had one', async () => {
    const result = await run(`
      const text = figma.createText({ characters: 'Default' });
      JSON.stringify(text.fontName);
    `);
    const fontName = JSON.parse(result.output as string) as { family: string; style: string };
    expect(typeof fontName.family).toBe('string');
    expect(fontName.family.length).toBeGreaterThan(0);
    expect(fontName.style.length).toBeGreaterThan(0);
  });

  it('sets letterSpacing and lineHeight in Figma object form', async () => {
    const result = await run(`
      const text = figma.createText({ characters: 'Spaced' });
      text.letterSpacing = { unit: 'PIXELS', value: 2 };
      text.lineHeight = { unit: 'PERCENT', value: 150 };
      JSON.stringify([text.letterSpacing, text.lineHeight]);
    `);
    expect(JSON.parse(result.output as string)).toEqual([
      { unit: 'PIXELS', value: 2 },
      { unit: 'PERCENT', value: 150 },
    ]);
    const style = textNode(result.file, result.file.document.children[0]!.children[0]!.id).style;
    expect(style.letterSpacing).toEqual({ unit: 'PIXELS', value: 2 });
    expect(style.lineHeight).toEqual({ unit: 'PERCENT', value: 150 });
  });

  it('accepts AUTO line height, which carries no value', async () => {
    const result = await run(`
      const text = figma.createText({ characters: 'Auto' });
      text.lineHeight = { unit: 'AUTO' };
      JSON.stringify(text.lineHeight);
    `);
    expect(JSON.parse(result.output as string)).toEqual({ unit: 'AUTO' });
  });

  it('sets alignment, case and decoration', async () => {
    const result = await run(`
      const text = figma.createText({ characters: 'Aligned' });
      text.textAlignHorizontal = 'CENTER';
      text.textAlignVertical = 'BOTTOM';
      text.textCase = 'UPPER';
      text.textDecoration = 'UNDERLINE';
      JSON.stringify([text.textAlignHorizontal, text.textAlignVertical, text.textCase, text.textDecoration]);
    `);
    expect(JSON.parse(result.output as string)).toEqual(['CENTER', 'BOTTOM', 'UPPER', 'UNDERLINE']);
    const style = textNode(result.file, result.file.document.children[0]!.children[0]!.id).style;
    expect(style.textAlignHorizontal).toBe('CENTER');
    expect(style.textAlignVertical).toBe('BOTTOM');
    expect(style.textCase).toBe('UPPER');
    expect(style.textDecoration).toBe('UNDERLINE');
  });

  it('keeps the properties through a JSON round trip', async () => {
    const result = await run(`
      const text = figma.createText({ characters: 'Persisted' });
      text.fontSize = 32;
      text.fontName = { family: 'Georgia', style: 'Italic' };
      text.letterSpacing = { unit: 'PERCENT', value: 5 };
      text.lineHeight = { unit: 'PIXELS', value: 40 };
      text.textAlignHorizontal = 'RIGHT';
      text.textCase = 'TITLE';
      text.id;
    `);
    const reloaded = parseFile(serializeFile(result.file)).file!;
    const style = textNode(reloaded, result.output as string).style;
    expect(style.fontSize).toBe(32);
    expect(style.fontFamily).toBe('Georgia');
    expect(style.fontStyle).toBe('Italic');
    expect(style.letterSpacing).toEqual({ unit: 'PERCENT', value: 5 });
    expect(style.lineHeight).toEqual({ unit: 'PIXELS', value: 40 });
    expect(style.textAlignHorizontal).toBe('RIGHT');
    expect(style.textCase).toBe('TITLE');
  });

  it('drops a value passed with AUTO line height, as Figma does', async () => {
    const result = await run(`
      const text = figma.createText({ characters: 'Auto value' });
      text.lineHeight = { unit: 'AUTO', value: 12 };
      JSON.stringify(text.lineHeight);
    `);
    expect(JSON.parse(result.output as string)).toEqual({ unit: 'AUTO' });
  });

  it('fails explicitly on a non-text node', async () => {
    expect(await failure(`
      const rect = figma.createRectangle({});
      rect.fontSize = 20;
    `)).toContain('fontSize is only valid on TEXT nodes');
  });

  it('validates every value it accepts', async () => {
    const cases: Array<[string, string]> = [
      [`text.fontSize = 0;`, 'fontSize must be a positive number'],
      [`text.fontSize = 'big';`, 'fontSize must be a positive number'],
      [`text.fontName = { family: '', style: 'Regular' };`, 'fontName.family must be a non-empty string'],
      [`text.fontName = 'Roboto';`, 'fontName must be an object with family and style'],
      [`text.letterSpacing = { unit: 'EM', value: 1 };`, 'letterSpacing.unit must be one of "PIXELS", "PERCENT"'],
      [`text.letterSpacing = { unit: 'PIXELS' };`, 'letterSpacing.value must be a number'],
      [`text.lineHeight = { unit: 'PERCENT' };`, 'lineHeight.value must be a number'],
      [`text.textAlignHorizontal = 'MIDDLE';`, 'textAlignHorizontal must be one of'],
      [`text.textAlignVertical = 'LEFT';`, 'textAlignVertical must be one of'],
      [`text.textCase = 'CAPS';`, 'textCase must be one of'],
      [`text.textDecoration = 'BOLD';`, 'textDecoration must be one of'],
    ];
    for (const [statement, message] of cases) {
      const reported = await failure(`
        const text = figma.createText({ characters: 'Invalid' });
        ${statement}
      `);
      expect(reported, `expected a failure for: ${statement}`).toContain(message);
    }
  });

  it('still fails explicitly for properties outside the subset', async () => {
    expect(await failure(`
      const text = figma.createText({ characters: 'Nope' });
      text.fontVariations = [];
    `)).toContain('Unsupported Plugin API property "fontVariations"');
    // Reading an unsupported member fails the same way, listing what is there.
    const listed = await failure(`
      const text = figma.createText({ characters: 'Nope' });
      text.fontVariations;
    `);
    expect(listed).toContain('Unsupported Plugin API member "fontVariations"');
    expect(listed).toContain('fontSize');
  });
});
