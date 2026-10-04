import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import { createPluginInterpreter } from '../../src/mcp/plugin/interpreter';
import { createMcpServer } from '../../src/mcp/protocol';
import { createSession } from '../../src/mcp/session';
import type { ComponentNode, ContainerNode, InstanceNode, PigmaFile, ShapeNode } from '../../src/model/types';
import { findNode } from '../../src/model/tree';
import { hasChildren } from '../../src/model/types';

const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../figma/fixtures/${name}`, import.meta.url)), 'utf8'));

const interpreter = createPluginInterpreter();

function freshFile(): PigmaFile {
  return figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 }).file;
}

describe('QuickJS plugin interpreter', () => {
  it('runs a Figma Plugin API script and applies the document', async () => {
    const result = await interpreter.run(
      `
      const frame = figma.createFrame({ name: 'Sandbox', x: 10, y: 20, width: 300, height: 200 });
      frame.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
      const rect = figma.createRectangle({ x: 4, y: 6, width: 50, height: 40 });
      rect.resize(80, 60);
      rect.name = 'Inner';
      frame.appendChild(rect);
      figma.currentPage.selection = [frame];
      console.log('made', rect.name);
      rect.id;
      `,
      freshFile(),
    );

    const page = result.file.document.children[0];
    const frame = page && hasChildren(page) ? page.children.find((child) => child.name === 'Sandbox') : undefined;
    expect(frame).toBeDefined();
    expect(frame?.fills[0]).toMatchObject({ type: 'SOLID', color: { r: 1, g: 0, b: 0 } });
    const inner = frame && hasChildren(frame) ? frame.children.find((child) => child.name === 'Inner') : undefined;
    expect(inner).toBeDefined();
    expect(inner?.width).toBe(80);
    expect(inner?.height).toBe(60);
    expect(result.output).toBe(inner?.id);
    expect(result.logs).toContain('made Inner');
  });

  it('exposes no host capabilities inside the sandbox', async () => {
    const result = await interpreter.run(
      `[
        typeof require, typeof process, typeof fetch, typeof globalThis.__pigmaGet,
        typeof globalThis.__pigmaRunContextJson,
        typeof globalThis.eval === 'function' ? 'js-eval-only' : 'no-eval',
      ].join(',')`,
      freshFile(),
    );
    expect(result.output).toBe('undefined,undefined,undefined,undefined,undefined,js-eval-only');
  });

  it('supports reads through figma.getNodeById and currentPage', async () => {
    const result = await interpreter.run(
      `const node = figma.getNodeById('1:3');
       const page = figma.currentPage;
       node.name + '|' + page.children.length;`,
      freshFile(),
    );
    expect(String(result.output)).toContain('Title|');
  });

  it('stops runaway scripts', async () => {
    await expect(interpreter.run('while (true) {}', freshFile(), { timeoutMs: 200 })).rejects.toThrow(/interrupted|Plugin script failed/);
  });

  it('reports script syntax errors', async () => {
    await expect(interpreter.run('const = ;', freshFile())).rejects.toThrow(/Plugin script failed/);
  });

  it('reports unsupported API use', async () => {
    await expect(interpreter.run('figma.createInstance();', freshFile())).rejects.toThrow(/createInstance/);
  });

  it('surfaces host errors for unknown nodes', async () => {
    await expect(interpreter.run("figma.getNodeById('9:9'); figma.currentPage.selection = [{ id: '9:9' }];", freshFile())).rejects.toThrow(/Unknown node id/);
  });
});

describe('QuickJS plugin interpreter — broadened subset', () => {
  it('supports async/await with figma.loadFontAsync', async () => {
    const result = await interpreter.run(
      `
      async function build() {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        const text = figma.createText({ x: 0, y: 0, characters: 'Async' });
        text.name = 'Async Text';
        return text.id;
      }
      const id = await build();
      return id;
      `,
      freshFile(),
    );
    const stored = findNode((result.file as PigmaFile).document, String(result.output));
    expect(stored?.name).toBe('Async Text');
  });

  it('supports auto-layout properties', async () => {
    const result = await interpreter.run(
      `
      const frame = figma.createFrame({ name: 'Stack', width: 200, height: 120 });
      frame.layoutMode = 'VERTICAL';
      frame.itemSpacing = 12;
      frame.paddingLeft = 8;
      frame.paddingTop = 8;
      frame.primaryAxisSizingMode = 'AUTO';
      frame.counterAxisAlignItems = 'CENTER';
      frame.layoutSizingHorizontal = 'HUG';
      frame.id;
      `,
      freshFile(),
    );
    const frame = findNode((result.file as PigmaFile).document, String(result.output)) as ContainerNode;
    expect(frame.autoLayout).toMatchObject({
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      paddingLeft: 8,
      paddingTop: 8,
      primaryAxisSizingMode: 'AUTO',
      counterAxisAlignItems: 'CENTER',
      layoutSizingHorizontal: 'HUG',
    });
  });

  it('supports vector paths', async () => {
    const result = await interpreter.run(
      `
      const vector = figma.createVector({ name: 'Icon', width: 24, height: 24 });
      vector.vectorPaths = [{ windingRule: 'EVENODD', data: 'M0 0 L24 0 L24 24 Z' }];
      vector.id;
      `,
      freshFile(),
    );
    const vector = findNode((result.file as PigmaFile).document, String(result.output)) as ShapeNode;
    expect(vector.type).toBe('VECTOR');
    expect(vector.pathData).toBe('M0 0 L24 0 L24 24 Z');
    expect(vector.windingRule).toBe('EVENODD');
  });

  it('supports components and variant sets', async () => {
    const result = await interpreter.run(
      `
      const a = figma.createComponent({ name: 'Size=sm', width: 40, height: 20 });
      const b = figma.createComponent({ name: 'Size=lg', width: 80, height: 20 });
      const set = figma.combineAsVariants([a, b], figma.currentPage);
      set.id;
      `,
      freshFile(),
    );
    const set = findNode((result.file as PigmaFile).document, String(result.output)) as ComponentNode;
    expect(set.type).toBe('COMPONENT_SET');
    // One VARIANT axis per `Property=value` name segment, as Figma derives it.
    expect(set.componentPropertyDefinitions).toMatchObject({
      Size: { type: 'VARIANT', variantOptions: ['sm', 'lg'] },
    });
    expect(set.children.map((child: { type: string }) => child.type)).toEqual(['COMPONENT', 'COMPONENT']);
  });

  it('derives one VARIANT axis per name segment when combining variants', async () => {
    const result = await interpreter.run(
      `
      const a = figma.createComponent({ name: 'Size=sm, State=on', width: 40, height: 20 });
      const b = figma.createComponent({ name: 'Size=lg, State=off', width: 80, height: 20 });
      const c = figma.createComponent({ name: 'Size=lg, State=on', width: 80, height: 20 });
      const set = figma.combineAsVariants([a, b, c], figma.currentPage);
      set.id;
      `,
      freshFile(),
    );
    const set = findNode((result.file as PigmaFile).document, String(result.output)) as ComponentNode;
    expect(set.componentPropertyDefinitions).toMatchObject({
      Size: { type: 'VARIANT', variantOptions: ['sm', 'lg'] },
      State: { type: 'VARIANT', variantOptions: ['on', 'off'] },
    });
  });

  it('creates and inspects boolean operations', async () => {
    const result = await interpreter.run(
      `
      const a = figma.createRectangle({ x: 0, y: 0, width: 40, height: 40 });
      const b = figma.createRectangle({ x: 20, y: 0, width: 40, height: 40 });
      const union = figma.union([a, b], figma.currentPage);
      const subtract = figma.subtract([figma.createEllipse({ x: 0, y: 60, width: 40, height: 40 }), figma.createEllipse({ x: 20, y: 60, width: 40, height: 40 })], figma.currentPage);
      const intersect = figma.intersect([figma.createRectangle({ x: 100, y: 0, width: 40, height: 40 }), figma.createRectangle({ x: 120, y: 0, width: 40, height: 40 })], figma.currentPage);
      const exclude = figma.exclude([figma.createRectangle({ x: 100, y: 60, width: 40, height: 40 }), figma.createRectangle({ x: 120, y: 60, width: 40, height: 40 })], figma.currentPage);
      ({
        union: { id: union.id, type: union.type, children: union.children.length, paths: union.vectorPaths, windingRule: union.windingRule },
        types: [subtract.type, intersect.type, exclude.type],
      });
      `,
      freshFile(),
    );
    const output = result.output as {
      union: { id: string; type: string; children: number; paths: Array<{ data: string }>; windingRule: string };
      types: string[];
    };
    expect(output.union.type).toBe('BOOLEAN_OPERATION');
    expect(output.union.children).toBe(2);
    expect(output.union.paths[0]?.data.length ?? 0).toBeGreaterThan(0);
    expect(output.union.windingRule).toBe('EVENODD');
    expect(output.types).toEqual(['BOOLEAN_OPERATION', 'BOOLEAN_OPERATION', 'BOOLEAN_OPERATION']);

    const node = findNode((result.file as PigmaFile).document, output.union.id) as ContainerNode;
    expect(node.type).toBe('BOOLEAN_OPERATION');
    expect(node.children.map((child) => child.type)).toEqual(['RECTANGLE', 'RECTANGLE']);
  });

  it('exposes style, variable, and variant bindings to scripts', async () => {
    const result = await interpreter.run(
      `
      const node = figma.createRectangle({ x: 0, y: 0, width: 10, height: 10 });
      node.styles = { fill: 'S:style-1' };
      node.boundVariables = { opacity: 'VariableID:1' };
      node.componentPropertyReferences = { visible: 'Show icon' };
      node.windingRule = 'EVENODD';
      node.rectangleCornerRadii = [1, 2, 3, 4];
      ({ styles: node.styles, bound: node.boundVariables, refs: node.componentPropertyReferences, winding: node.windingRule, radii: node.rectangleCornerRadii });
      `,
      freshFile(),
    );
    expect(result.output).toEqual({
      styles: { fill: 'S:style-1' },
      bound: { opacity: 'VariableID:1' },
      refs: { visible: 'Show icon' },
      winding: 'EVENODD',
      radii: [1, 2, 3, 4],
    });
  });

  it('creates a component set and switches an instance variant with setProperties', async () => {
    const result = await interpreter.run(
      `
      const a = figma.createComponent({ name: 'Size=sm', width: 40, height: 20 });
      const b = figma.createComponent({ name: 'Size=lg', width: 80, height: 20 });
      const set = figma.combineAsVariants([a, b], figma.currentPage);
      const instance = a.createInstance();
      instance.setProperties({ Size: 'lg' });
      ({
        setId: set.id,
        componentId: instance.componentId,
        mainComponentName: instance.mainComponent.name,
        properties: instance.componentProperties,
        width: instance.width,
        definitions: set.componentPropertyDefinitions,
      });
      `,
      freshFile(),
    );
    const output = result.output as {
      setId: string;
      componentId: string;
      mainComponentName: string;
      properties: Record<string, string>;
      width: number;
      definitions: Record<string, { variantOptions: string[] }>;
    };
    expect(output.properties).toMatchObject({ Size: 'lg' });
    expect(output.mainComponentName).toBe('Size=lg');
    expect(output.width).toBe(80);
    expect(output.definitions.Size?.variantOptions).toEqual(['sm', 'lg']);

    const set = findNode((result.file as PigmaFile).document, output.setId) as ComponentNode;
    const variants = set.children as Array<{ id: string; name: string }>;
    const large = variants.find((variant) => variant.name === 'Size=lg');
    expect(output.componentId).toBe(large?.id);
  });

  it('fails explicitly for unsupported plugin surfaces', async () => {
    await expect(interpreter.run('figma.ui.postMessage("hi");', freshFile())).rejects.toThrow(/figma\.ui is not supported/);
    await expect(interpreter.run('figma.showUI("<div/>");', freshFile())).rejects.toThrow(/showUI is not supported/);
    await expect(interpreter.run('figma.createRectangle().vectorNetwork = {};', freshFile())).rejects.toThrow(
      /vectorNetwork needs vertices and segments/,
    );
  });

  it('materializes component instances', async () => {
    const result = await interpreter.run(
      `
      const component = figma.createComponent({ name: 'Card', width: 120, height: 60 });
      const label = figma.createText({ x: 8, y: 8, characters: 'Label' });
      component.appendChild(label);
      const instance = component.createInstance();
      instance.name = 'Card Instance';
      instance.id;
      `,
      freshFile(),
    );
    const instance = findNode((result.file as PigmaFile).document, String(result.output)) as InstanceNode;
    expect(instance.type).toBe('INSTANCE');
    expect(instance.componentId).toBeTruthy();
    expect(instance.componentSnapshot).toBeTruthy();
    expect(instance.children).toHaveLength(1);
    expect(instance.children[0]?.type).toBe('TEXT');
    expect(instance.children[0]?.id).not.toBe((instance.componentSnapshot as { children: Array<{ id: string }> }).children[0]?.id);
  });

  it('converts a vector network to path data and says so', async () => {
    const result = await interpreter.run(
      `
      const vector = figma.createVector({ width: 10, height: 10 });
      vector.vectorNetwork = {
        vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        segments: [
          { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 2, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        ],
        regions: [{ loops: [[0, 1, 2]] }],
      };
      vector.id;
      `,
      freshFile(),
    );
    const vector = findNode((result.file as PigmaFile).document, String(result.output)) as ShapeNode;
    expect(vector.pathData).toBe('M0 0 L10 0 L10 10 Z');
    expect(result.logs.some((line) => line.includes('converted to pathData'))).toBe(true);
  });

  it('rejects reading a vector network explicitly', async () => {
    await expect(
      interpreter.run('const v = figma.createVector({ width: 10, height: 10 }); v.vectorNetwork;', freshFile()),
    ).rejects.toThrow(/vectorNetwork is not supported by Pigma/);
    await expect(
      interpreter.run('const v = figma.createVector({ width: 10, height: 10 }); v.vectorNetwork;', freshFile()),
    ).rejects.toThrow(/Read node\.vectorPaths instead/);
  });

  it('delivers plugin parameters to the run handler like Figma', async () => {
    const result = await interpreter.run(
      `
      figma.on('run', ({ command, parameters }) => {
        const text = figma.createText({ characters: parameters.label + '/' + command, x: 0, y: 0 });
        return { created: text.id, label: parameters.label };
      });
      `,
      freshFile(),
      { parameters: { label: 'Hello' }, command: 'insert' },
    );
    expect(result.output).toEqual({ created: expect.any(String), label: 'Hello' });
    const text = findNode((result.file as PigmaFile).document, String((result.output as { created: string }).created));
    expect(text?.type).toBe('TEXT');
    expect((text as { characters: string }).characters).toBe('Hello/insert');
  });

  it('awaits an async run handler and reports its value', async () => {
    const result = await interpreter.run(
      `
      figma.on('run', async ({ parameters }) => {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        return parameters.count * 2;
      });
      `,
      freshFile(),
      { parameters: { count: 21 } },
    );
    expect(result.output).toBe(42);
  });

  it('exposes parameters on figma.parameters.values and notes the missing input UI', async () => {
    const result = await interpreter.run(
      `
      figma.parameters.on('input', () => {});
      figma.parameters.values.size;
      `,
      freshFile(),
      { parameters: { size: 'large' } },
    );
    expect(result.output).toBe('large');
    expect(result.logs.some((line) => line.includes('figma.parameters.on("input") is not fired in Pigma'))).toBe(true);
  });

  it('leaves the run event parameters undefined when none are passed', async () => {
    const result = await interpreter.run(
      `
      figma.on('run', ({ parameters }) => {
        return parameters === undefined ? 'none' : 'some';
      });
      `,
      freshFile(),
    );
    expect(result.output).toBe('none');
  });

  it('requires a selected component for figma.createInstance', async () => {
    await expect(interpreter.run('figma.createInstance();', freshFile())).rejects.toThrow(/exactly one selected COMPONENT/);
    const result = await interpreter.run(
      `
      const component = figma.createComponent({ name: 'Solo' });
      figma.currentPage.selection = [component];
      const instance = figma.createInstance();
      instance.id;
      `,
      freshFile(),
    );
    const instance = findNode((result.file as PigmaFile).document, String(result.output));
    expect(instance?.type).toBe('INSTANCE');
  });

  it('reports an unknown node method explicitly', async () => {
    await expect(interpreter.run("figma.createRectangle().setPluginData('a', 'b');", freshFile())).rejects.toThrow(/Unsupported Plugin API member \"setPluginData\"/);
  });
});

describe('use_pigma code execution over MCP', () => {
  it('executes a plugin script through the tool', async () => {
    const session = createSession(freshFile());
    const server = createMcpServer({ session, interpreter });
    const response = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'use_pigma',
        arguments: { code: "const t = figma.createText({ x: 0, y: 0, characters: 'Hi' }); t.name = 'MCP Text'; t.id;" },
      },
    });
    const result = response && 'result' in response ? (response.result as { structuredContent: { output: string; logs: string[] } }) : null;
    expect(result?.structuredContent.output).toBeTruthy();

    const stored = findNode(session.getFile()?.document ?? freshFile().document, result?.structuredContent.output ?? '');
    expect(stored?.name).toBe('MCP Text');
  });

  it('keeps the declarative operations interface working', async () => {
    const file = freshFile();
    const server = createMcpServer({ session: createSession(file), interpreter });
    const response = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'use_pigma', arguments: { operations: [{ call: 'figma.createRectangle', args: { name: 'Declarative' } }] } },
    });
    const result = response && 'result' in response ? (response.result as { structuredContent: { results: Array<{ nodeId: string }> } }) : null;
    expect(result?.structuredContent.results[0]?.nodeId).toBeTruthy();
  });

  it('requires code or operations', async () => {
    const server = createMcpServer({ session: createSession(freshFile()), interpreter });
    const response = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'use_pigma', arguments: {} } });
    const result = response && 'result' in response ? (response.result as { isError?: boolean }) : null;
    expect(result?.isError).toBe(true);
  });
});
