import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import { createMcpServer, type McpServer } from '../../src/mcp/protocol';
import type { JsonRpcResponse } from '../../src/mcp/types';
import { findNode } from '../../src/model/tree';
import { hasChildren } from '../../src/model/types';
import { createSession } from '../../src/mcp/session';
import { nodeRasterizer } from '../../src/mcp/raster.node';
import { addMode, addVariable, bindVariable, createCollection, setActiveMode, setVariableValue } from '../../src/model/variables';
import { createStyleFromNode } from '../../src/model/styles';
import { booleanNodes } from '../../src/model/boolean';
import { createComponentSet } from '../../src/model/variants';
import { createComponentNode, createFrameNode, createRectNode } from '../../src/model/factory';
import { emptyFile } from '../../src/model/validate';

const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../figma/fixtures/${name}`, import.meta.url)), 'utf8'));

function buildServer() {
  const { file } = figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1_700_000_000_000 });
  const session = createSession(file);
  return { server: createMcpServer({ session, rasterizer: nodeRasterizer }), session, file };
}
async function call(server: McpServer, method: string, params?: unknown, id = 1): Promise<JsonRpcResponse> {
  const response = await server.handle({ jsonrpc: '2.0', id, method, params });
  if (!response) throw new Error('expected a response');
  return response;
}

function result(response: JsonRpcResponse): Record<string, unknown> {
  if ('error' in response) throw new Error(`unexpected error: ${response.error.message}`);
  return response.result as Record<string, unknown>;
}

describe('MCP protocol', () => {
  it('initializes for any client name, including unknown ones', async () => {
    for (const name of ['totally-unknown-harness', 'cursor', 'claude-ai', '', 'some-new-client-2030']) {
      const { server } = buildServer();
      const response = await call(server, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name, version: '9.9.9' },
      });
      const value = result(response);
      expect(value.protocolVersion).toBe('2025-06-18');
      expect(value.serverInfo).toMatchObject({ name: 'pigma' });
      expect(value.capabilities).toMatchObject({ tools: expect.anything(), resources: expect.anything(), prompts: expect.anything() });
    }
  });

  it('negotiates the protocol version', async () => {
    const { server } = buildServer();
    expect(result(await call(server, 'initialize', { protocolVersion: '2024-11-05' })).protocolVersion).toBe('2024-11-05');
    expect(result(await call(server, 'initialize', { protocolVersion: '1999-01-01' })).protocolVersion).toBe('2025-06-18');
    expect(result(await call(server, 'initialize', {})).protocolVersion).toBe('2025-06-18');
  });

  it('returns no response for notifications', async () => {
    const { server } = buildServer();
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  it('lists the Figma catalog tools', async () => {
    const { server } = buildServer();
    const tools = result(await call(server, 'tools/list')).tools as Array<{ name: string; inputSchema: unknown }>;
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_design_context',
        'get_metadata',
        'get_screenshot',
        'download_assets',
        'get_variable_defs',
        'get_motion_context',
        'get_libraries',
        'search_design_system',
        'get_code_connect_map',
        'use_pigma',
        'create_new_file',
        'upload_assets',
      ]),
    );
    for (const tool of tools) expect(tool.inputSchema).toMatchObject({ type: 'object' });
  });

  it('answers ping and rejects unknown methods', async () => {
    const { server } = buildServer();
    expect(result(await call(server, 'ping'))).toEqual({});
    const response = await call(server, 'does/not/exist');
    expect('error' in response && response.error.code).toBe(-32601);
  });

  it('rejects malformed tools/call params as a tool error', async () => {
    const { server } = buildServer();
    const response = result(await call(server, 'tools/call', { name: 'get_metadata' }));
    expect(response.isError).toBeFalsy();
    const bad = result(await call(server, 'tools/call', { name: 'nope' }));
    expect(bad.isError).toBe(true);
  });
});

describe('MCP read tools', () => {
  it('get_metadata lists pages without a nodeId', async () => {
    const { server } = buildServer();
    const value = result(await call(server, 'tools/call', { name: 'get_metadata', arguments: {} }));
    expect(value.structuredContent).toMatchObject({ pages: expect.arrayContaining([{ id: '0:1', name: 'Page 1' }]) });
  });

  it('get_metadata returns an XML outline and recovers from unknown ids', async () => {
    const { server } = buildServer();
    const value = result(await call(server, 'tools/call', { name: 'get_metadata', arguments: { nodeId: '1:2' } }));
    const text = (value.content as Array<{ text: string }>)[0]?.text ?? '';
    expect(text).toContain('<node');
    expect(text).toContain('id="1:2"');
    expect(text).toContain('id="1:3"');

    const missing = result(await call(server, 'tools/call', { name: 'get_metadata', arguments: { nodeId: '9:9' } }));
    expect(missing.isError).toBe(true);
    expect((missing.content as Array<{ text: string }>)[0]?.text).toContain('Page 1');
  });

  it('get_metadata with a page id returns that page\'s outline', async () => {
    const { server } = buildServer();
    const value = result(await call(server, 'tools/call', { name: 'get_metadata', arguments: { nodeId: '0:1' } }));
    const text = (value.content as Array<{ text: string }>)[0]?.text ?? '';
    expect(text).toContain('id="1:2"');
    expect(text).toContain('name="Hero"');
    expect(text).not.toContain('Page 1\n- ');
    const nodes = (value.structuredContent as { nodes: Array<{ id: string }> }).nodes;
    expect(nodes.map((node) => node.id)).toContain('1:2');
  });

  it('get_metadata with the document id covers every page', async () => {
    const { server } = buildServer();
    const value = result(await call(server, 'tools/call', { name: 'get_metadata', arguments: { nodeId: '0:0' } }));
    const nodes = (value.structuredContent as { nodes: Array<{ id: string }> }).nodes;
    expect(nodes.map((node) => node.id)).toContain('1:2');
  });

  it('get_metadata notes an empty page rather than returning nothing', async () => {
    const { file } = figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 });
    const server = createMcpServer({ session: createSession(file), rasterizer: nodeRasterizer });
    // '0:2' (Internal Only Canvas) has no children in the fixture.
    const value = result(await call(server, 'tools/call', { name: 'get_metadata', arguments: { nodeId: '0:2' } }));
    expect((value.content as Array<{ text: string }>)[0]?.text).toContain('has no layers');
    expect((value.structuredContent as { nodes: unknown[] }).nodes).toEqual([]);
  });

  it('get_design_context generates React + Tailwind by default', async () => {
    const { server } = buildServer();
    const value = result(await call(server, 'tools/call', { name: 'get_design_context', arguments: { nodeId: '1:3' } }));
    const code = (value.content as Array<{ text: string }>)[0]?.text ?? '';
    expect(code).toContain('export function');
    expect(code).toContain('className=');
    expect(code).toContain('text-[24px]');
    expect(value.structuredContent).toMatchObject({ framework: 'react', styling: 'tailwind' });

    const html = result(
      await call(server, 'tools/call', { name: 'get_design_context', arguments: { nodeId: '1:3', framework: 'html', styling: 'css' } }),
    );
    const htmlCode = (html.content as Array<{ text: string }>)[0]?.text ?? '';
    expect(htmlCode).toContain('<div');
    expect(htmlCode).toContain('font-size: 24px');
    expect(html.structuredContent).toMatchObject({ framework: 'html', styling: 'css' });
  });

  it('get_screenshot returns a real PNG by default and SVG on request', async () => {
    const { server } = buildServer();
    const value = result(await call(server, 'tools/call', { name: 'get_screenshot', arguments: { nodeId: '1:2' } }));
    const image = (value.content as Array<{ type: string; mimeType: string; data: string }>)[0];
    expect(image?.type).toBe('image');
    expect(image?.mimeType).toBe('image/png');
    const png = Buffer.from(image?.data ?? '', 'base64');
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(value.structuredContent).toMatchObject({ format: 'png', scale: 1 });

    const svg = result(await call(server, 'tools/call', { name: 'get_screenshot', arguments: { nodeId: '1:2', format: 'svg' } }));
    expect((svg.content as Array<{ mimeType: string }>)[0]?.mimeType).toBe('image/svg+xml');
  });

  it('get_screenshot reports a clear error when no rasterizer is configured', async () => {
    const { file } = figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 });
    const server = createMcpServer({ session: createSession(file) });
    const value = result(await call(server, 'tools/call', { name: 'get_screenshot', arguments: { nodeId: '1:2' } }));
    expect(value.isError).toBe(true);
    expect((value.content as Array<{ text: string }>)[0]?.text).toContain('rasterizer');
  });

  it('download_assets returns inline data URLs', async () => {
    const { server } = buildServer();
    const value = result(await call(server, 'tools/call', { name: 'download_assets', arguments: { nodeIds: ['1:4'] } }));
    const structured = value.structuredContent as { assets: Array<{ nodeId: string; dataUrl: string }> };
    expect(structured.assets[0]?.nodeId).toBe('1:4');
    expect(structured.assets[0]?.dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('get_variable_defs reports bound variables and styles', async () => {
    const { server } = buildServer();
    const value = result(await call(server, 'tools/call', { name: 'get_variable_defs', arguments: { nodeId: '1:4' } }));
    const structured = value.structuredContent as {
      variables: Array<{ id: string; usedBy: string[] }>;
      styles: Array<{ id: string; name?: string }>;
    };
    expect(structured.variables).toContainEqual(expect.objectContaining({ id: 'VariableID:1:2', usedBy: ['1:4'] }));
    // Styles resolve through the model's first-class styles table.
    expect(structured.styles[0]).toMatchObject({ id: 'S:1', name: 'Brand/Fill', styleType: 'FILL' });
  });

  it('get_libraries and search_design_system use the file resources', async () => {
    const { server } = buildServer();
    const libraries = result(await call(server, 'tools/call', { name: 'get_libraries', arguments: {} }));
    expect((libraries.structuredContent as { subscribed: Array<{ name: string }> }).subscribed[0]?.name).toBe('Pigma Import Fixture');

    const search = result(await call(server, 'tools/call', { name: 'search_design_system', arguments: { queries: ['butt', 'brand'] } }));
    const found = (search.structuredContent as { results: Array<{ id: string; kind: string }> }).results;
    expect(found).toEqual(expect.arrayContaining([expect.objectContaining({ id: '2:1', kind: 'component' }), expect.objectContaining({ id: 'S:1', kind: 'style' })]));
  });

  it('resolves variables through collections, modes, and the active mode', async () => {
    const { file } = figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 });
    let next = file;
    const created = createCollection(next, 'Theme');
    next = created.file;
    const collectionId = created.collectionId;
    const added = addVariable(next, collectionId, 'COLOR', 'Brand/Background');
    next = added.file;
    const variableId = added.variableId as string;
    const modeId = next.variableCollections?.[collectionId]?.defaultModeId as string;
    next = setVariableValue(next, variableId, modeId, { r: 1, g: 0, b: 0, a: 1 });
    next = bindVariable(next, '1:4', 'fill', variableId);

    const server = createMcpServer({ session: createSession(next), rasterizer: nodeRasterizer });
    const value = result(await call(server, 'tools/call', { name: 'get_variable_defs', arguments: { nodeId: '1:4' } }));
    const structured = value.structuredContent as {
      variables: Array<{ id: string; name: string; resolvedType: string; collection: string; value: unknown; usedBy: string[] }>;
    };
    const entry = structured.variables.find((item) => item.id === variableId);
    expect(entry).toMatchObject({
      name: 'Brand/Background',
      resolvedType: 'COLOR',
      collection: 'Theme',
      value: { r: 1, g: 0, b: 0, a: 1 },
      usedBy: ['1:4'],
    });

    // A second mode changes the resolved value without touching the node.
    const withMode = addMode(next, collectionId, 'Dark');
    const darkModeId = withMode.variableCollections?.[collectionId]?.modes.find((mode) => mode.name === 'Dark')?.modeId as string;
    const switched = setActiveMode(setVariableValue(withMode, variableId, darkModeId, { r: 0, g: 0, b: 1, a: 1 }), collectionId, darkModeId);
    const darkServer = createMcpServer({ session: createSession(switched), rasterizer: nodeRasterizer });
    const darkValue = result(await call(darkServer, 'tools/call', { name: 'get_variable_defs', arguments: { nodeId: '1:4' } }));
    const darkEntry = (darkValue.structuredContent as { variables: Array<{ id: string; value: unknown }> }).variables.find((item) => item.id === variableId);
    expect(darkEntry?.value).toEqual({ r: 0, g: 0, b: 1, a: 1 });
  });

  it('get_libraries counts components, component sets, styles, and variables', async () => {
    const { file } = figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 });
    let next = file;
    const created = createCollection(next, 'Theme');
    next = addVariable(created.file, created.collectionId, 'FLOAT', 'Spacing/4').file;
    const styled = createStyleFromNode(next, '1:4', 'FILL', 'Brand/Fill (local)');
    next = styled.file;

    const server = createMcpServer({ session: createSession(next), rasterizer: nodeRasterizer });
    const libraries = result(await call(server, 'tools/call', { name: 'get_libraries', arguments: {} }));
    const library = (libraries.structuredContent as { subscribed: Array<Record<string, unknown>> }).subscribed[0];
    expect(library).toMatchObject({
      componentCount: expect.any(Number),
      componentSetCount: expect.any(Number),
      styleCount: expect.any(Number),
      variableCount: 1,
      variableCollectionCount: 1,
    });
    expect((library?.styleCounts as Record<string, number>).FILL).toBeGreaterThanOrEqual(1);
    expect((library?.variableCollections as Array<{ name: string; modes: unknown[] }>)[0]).toMatchObject({ name: 'Theme' });
  });

  it('search_design_system finds variables and styles in the model tables', async () => {
    const { file } = figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 });
    const created = createCollection(file, 'Theme');
    const withVariable = addVariable(created.file, created.collectionId, 'COLOR', 'Brand/Accent');

    const server = createMcpServer({ session: createSession(withVariable.file), rasterizer: nodeRasterizer });
    const search = result(
      await call(server, 'tools/call', { name: 'search_design_system', arguments: { queries: ['brand', 'accent'] } }),
    );
    const found = (search.structuredContent as { results: Array<{ kind: string; name: string }> }).results;
    expect(found).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'variable', name: 'Brand/Accent' }),
        expect.objectContaining({ kind: 'style', name: 'Brand/Fill' }),
      ]),
    );
  });

  it('get_metadata outlines boolean operations and component sets with their children', async () => {
    const file = emptyFile('Outline');
    const page = file.document.children[0]!;
    const a = createRectNode(null, 0, 0, 40, 40);
    const b = createRectNode(null, 20, 0, 40, 40);
    page.children = [a, b];
    const boolean = booleanNodes(file, [a.id, b.id], 'UNION');
    expect(boolean.nodeId).toBeTruthy();

    const booleanPage = boolean.file.document.children[0]!;
    const components = ['Size=sm', 'Size=lg'].map((name, index) => {
      const component = createComponentNode(null, createFrameNode(null, index * 40, 80, 40, 20));
      return { ...component, id: `outline-${index}`, name } as never;
    });
    booleanPage.children = [...booleanPage.children, ...components];
    const withSet = createComponentSet(boolean.file, components.map((component) => (component as { id: string }).id));
    expect(withSet.setId).toBeTruthy();

    const server = createMcpServer({ session: createSession(withSet.file), rasterizer: nodeRasterizer });
    const outline = result(
      await call(server, 'tools/call', { name: 'get_metadata', arguments: { nodeId: booleanPage.id } }),
    );
    const xml = (outline.content as Array<{ text: string }>)[0]?.text ?? '';
    expect(xml).toContain('type="BOOLEAN_OPERATION"');
    expect(xml).toContain('type="COMPONENT_SET"');
    // Children of both are outlined: the boolean's operands and the set's variants.
    expect(xml).toMatch(/type="BOOLEAN_OPERATION"[^>]*>\n\s+<node[^>]*type="RECTANGLE"/);
    expect(xml).toMatch(/type="COMPONENT_SET"[^>]*>\n\s+<node[^>]*type="COMPONENT"/);
  });

  it('get_design_context exposes styles, variables, variant references, and fill rule', async () => {
    const file = emptyFile('Context');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 0, 0, 30, 30);
    rect.pathData = 'M0 0 L30 0 L30 30 Z';
    rect.windingRule = 'EVENODD';
    rect.rectangleCornerRadii = [1, 2, 3, 4];
    rect.styles = { fill: 'style-1' };
    rect.boundVariables = { opacity: 'variable-1' };
    rect.componentPropertyReferences = { visible: 'Show icon' };
    page.children = [rect];

    const created = createCollection(file, 'Theme');
    const added = addVariable(created.file, created.collectionId, 'FLOAT', 'Opacity/Subtle');
    const modeId = added.file.variableCollections?.[created.collectionId]?.defaultModeId as string;
    const withValue = setVariableValue(added.file, added.variableId as string, modeId, 0.5);
    const bound = bindVariable(withValue, rect.id, 'opacity', added.variableId as string);
    const styled = createStyleFromNode(bound, rect.id, 'FILL', 'Brand/Fill');
    const context = result(
      await call(createMcpServer({ session: createSession(styled.file), rasterizer: nodeRasterizer }), 'tools/call', {
        name: 'get_design_context',
        arguments: { nodeId: rect.id },
      }),
    );
    const node = (context.structuredContent as { nodes: Array<Record<string, unknown>> }).nodes[0];
    expect(node).toMatchObject({
      type: 'RECTANGLE',
      windingRule: 'EVENODD',
      rectangleCornerRadii: [1, 2, 3, 4],
      componentPropertyReferences: { visible: 'Show icon' },
    });
    expect((node?.variables as Record<string, { name: string; value: unknown }>).opacity).toMatchObject({
      name: 'Opacity/Subtle',
      resolvedType: 'FLOAT',
      value: 0.5,
    });
    const fillStyleId = Object.keys((styled.file.styles ?? {}))[0] as string;
    expect((node?.styles as Record<string, { name: string; type: string }>).fill).toMatchObject({ name: 'Brand/Fill', type: 'FILL' });
    expect(fillStyleId).toBeTruthy();
    // The token tables are part of the projection so consumers can resolve ids.
    expect((context.structuredContent as { file: { styles: unknown[] } }).file.styles.length).toBeGreaterThan(0);
    expect((context.structuredContent as { file: { variables: unknown[] } }).file.variables.length).toBe(1);
  });

  it('get_design_context resolves variant instance properties', async () => {
    const file = emptyFile('Variants');
    const page = file.document.children[0]!;
    const components = ['Size=sm', 'Size=lg'].map((name, index) => {
      const component = createComponentNode(null, createFrameNode(null, index * 40, 0, 40, 20));
      return { ...component, id: `variant-${index}`, name } as never;
    });
    page.children = components;
    const { file: withSet, setId } = createComponentSet(file, components.map((component) => (component as { id: string }).id));
    const server = createMcpServer({ session: createSession(withSet), rasterizer: nodeRasterizer });
    const context = result(
      await call(server, 'tools/call', { name: 'get_design_context', arguments: { nodeId: setId as string } }),
    );
    const node = (context.structuredContent as { nodes: Array<Record<string, unknown>> }).nodes[0];
    expect(node).toMatchObject({ type: 'COMPONENT_SET' });
    expect((node?.component as { propertyDefinitions: Record<string, { variantOptions: string[] }> }).propertyDefinitions.Size?.variantOptions).toEqual(['sm', 'lg']);
  });

  it('get_screenshot renders boolean operations and component sets', async () => {
    const file = emptyFile('Shots');
    const page = file.document.children[0]!;
    const a = createRectNode(null, 0, 0, 40, 40);
    const b = createRectNode(null, 20, 20, 40, 40);
    a.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    page.children = [a, b];
    const boolean = booleanNodes(file, [a.id, b.id], 'UNION');
    const booleanId = boolean.nodeId as string;
    const booleanNode = findNode(boolean.file.document, booleanId) as { pathData?: string };
    const server = createMcpServer({ session: createSession(boolean.file), rasterizer: nodeRasterizer });

    const svgResult = result(
      await call(server, 'tools/call', { name: 'get_screenshot', arguments: { nodeId: booleanId, format: 'svg' } }),
    );
    const svg = Buffer.from((svgResult.content as Array<{ data: string }>)[0]?.data ?? '', 'base64').toString('utf8');
    expect(svg).toContain('<svg');
    // The boolean's own path is what renders, in the node's local space.
    expect(svg.replace(/\s+/g, '')).toContain(`d="${(booleanNode.pathData ?? '').replace(/\s+/g, '')}"`);
    expect(svg).toContain('fill-rule="evenodd"');

    const pngResult = result(await call(server, 'tools/call', { name: 'get_screenshot', arguments: { nodeId: booleanId } }));
    const png = Buffer.from((pngResult.content as Array<{ data: string }>)[0]?.data ?? '', 'base64');
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(png.length).toBeGreaterThan(200);

    // A component set renders its variant children.
    const setPage = boolean.file.document.children[0]!;
    const components = ['Size=sm', 'Size=lg'].map((name, index) => {
      const component = createComponentNode(null, createFrameNode(null, index * 40, 100, 40, 20));
      component.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 }];
      return { ...component, id: `shot-${index}`, name } as never;
    });
    setPage.children = [...setPage.children, ...components];
    const withSet = createComponentSet(boolean.file, components.map((component) => (component as { id: string }).id));
    expect(withSet.setId).toBeTruthy();
    const setServer = createMcpServer({ session: createSession(withSet.file), rasterizer: nodeRasterizer });
    const setSvg = result(
      await call(setServer, 'tools/call', { name: 'get_screenshot', arguments: { nodeId: withSet.setId as string, format: 'svg' } }),
    );
    const markup = Buffer.from((setSvg.content as Array<{ data: string }>)[0]?.data ?? '', 'base64').toString('utf8');
    expect(markup).toContain('<svg');
    // Two variant frames painted, i.e. the set is not rendered blank.
    expect((markup.match(/fill="rgb\(0, 0, 255\)"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('get_code_connect_map is empty without Code Connect data', async () => {
    const { server } = buildServer();
    const value = result(await call(server, 'tools/call', { name: 'get_code_connect_map', arguments: { nodeId: '1:9' } }));
    expect(value.structuredContent).toEqual({ map: {} });
  });

  it('get_motion_context reports interactions and no keyframes', async () => {
    const { server } = buildServer();
    const value = result(await call(server, 'tools/call', { name: 'get_motion_context', arguments: { nodeId: '1:2', recursive: true } }));
    expect(value.structuredContent).toMatchObject({ keyframes: [] });
  });
});

describe('MCP write tools', () => {
  it('use_pigma passes plugin parameters to the run handler', async () => {
    const { server, session } = buildServer();
    const created = result(
      await call(server, 'tools/call', {
        name: 'use_pigma',
        arguments: {
          code: `figma.on('run', ({ command, parameters }) => {
            const node = figma.createText({ characters: parameters.label, x: 4, y: 4 });
            node.name = command;
            return { id: node.id, label: parameters.label };
          });`,
          parameters: { label: 'From parameters' },
          command: 'Insert label',
        },
      }),
    );
    const output = (created.structuredContent as { output: { id: string; label: string } }).output;
    expect(output.label).toBe('From parameters');

    const after = session.getFile();
    expect(after).not.toBeNull();
    const node = findNode(after!.document, output.id);
    expect(node?.type).toBe('TEXT');
    expect((node as { characters?: string }).characters).toBe('From parameters');
    expect(node?.name).toBe('Insert label');
  });

  it('use_pigma reports converted input as warnings and keeps logs unchanged', async () => {
    const { server } = buildServer();
    const created = result(
      await call(server, 'tools/call', {
        name: 'use_pigma',
        arguments: {
          code: `const vector = figma.createVector({ width: 10, height: 10 });
vector.vectorNetwork = {
  vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
  segments: [
    { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
    { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
    { start: 2, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
  ],
};
vector.id;`,
        },
      }),
    );
    const structured = created.structuredContent as { output: string; logs: string[]; warnings: string[] };
    expect(structured.warnings.some((line) => line.includes('converted to pathData'))).toBe(true);
    for (const warning of structured.warnings) expect(structured.logs).toContain(warning);
  });

  it('use_pigma runs Plugin-API-shaped calls', async () => {
    const { server, session } = buildServer();
    const created = result(
      await call(server, 'tools/call', {
        name: 'use_pigma',
        arguments: {
          operations: [
            { call: 'figma.createRectangle', args: { x: 8, y: 8, width: 50, height: 20, name: 'New' } },
            { call: 'figma.currentPage.selection', args: { nodeIds: [] } },
          ],
        },
      }),
    );
    const results = (created.structuredContent as { results: Array<{ call: string; nodeId?: string }> }).results;
    const nodeId = results[0]?.nodeId;
    expect(results[0]?.call).toBe('figma.createRectangle');
    expect(nodeId).toBeTruthy();

    const after = session.getFile();
    expect(after).not.toBeNull();
    const page = after ? findNode(after.document, after.document.children[0]?.id ?? '') : null;
    expect(page && hasChildren(page) ? page.children.some((child) => child.id === nodeId) : false).toBe(true);

    const applied = result(
      await call(server, 'tools/call', {
        name: 'use_pigma',
        arguments: {
          operations: [
            { call: `${nodeId}.resize`, args: { width: 120, height: 40 } },
            { call: `${nodeId}.set`, args: { name: 'Renamed', opacity: 0.5 } },
            { call: 'figma.currentPage.appendChild', args: { nodeId } },
            { call: `${nodeId}.get` },
            { call: 'figma.currentPage.selection', args: { nodeIds: [nodeId] } },
          ],
        },
      }),
    );
    expect(applied.isError).toBeFalsy();
    expect(session.getSelection()).toEqual([nodeId]);
    const renamed = session.getFile() ? findNode(session.getFile()!.document, nodeId ?? '') : null;
    expect(renamed?.name).toBe('Renamed');
    expect(renamed?.width).toBe(120);
    expect(renamed?.opacity).toBe(0.5);
    const contextResult = (applied.structuredContent as { results: Array<{ call: string; context?: unknown }> }).results.find((entry) =>
      entry.call.endsWith('.get'),
    );
    expect(contextResult?.context).toBeTruthy();

    const removed = result(
      await call(server, 'tools/call', { name: 'use_pigma', arguments: { operations: [{ call: `${nodeId}.remove` }] } }),
    );
    expect((removed.structuredContent as { results: Array<{ removed: boolean }> }).results[0]?.removed).toBe(true);
  });

  it('use_pigma rejects unknown calls', async () => {
    const { server } = buildServer();
    const value = result(
      await call(server, 'tools/call', { name: 'use_pigma', arguments: { operations: [{ call: 'figma.explode' }] } }),
    );
    expect(value.isError).toBe(true);
  });

  it('create_new_file opens a blank design document', async () => {
    const { server, session } = buildServer();
    const value = result(await call(server, 'tools/call', { name: 'create_new_file', arguments: { name: 'Fresh' } }));
    expect(value.structuredContent).toMatchObject({ name: 'Fresh', editorType: 'design' });
    expect(session.getFile()?.name).toBe('Fresh');
    expect(session.getFile()?.document.children).toHaveLength(1);

    const figjam = result(await call(server, 'tools/call', { name: 'create_new_file', arguments: { editorType: 'figjam' } }));
    expect(figjam.isError).toBe(true);
  });

  it('upload_assets fills a node or creates frames', async () => {
    const { server, session } = buildServer();
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const filled = result(await call(server, 'tools/call', { name: 'upload_assets', arguments: { nodeId: '1:4', images: [{ dataUrl }] } }));
    expect(filled.isError).toBeFalsy();
    const file = session.getFile();
    const target = file ? findNode(file.document, '1:4') : null;
    expect(target?.fills[0]).toMatchObject({ type: 'IMAGE', dataUrl });

    const created = result(await call(server, 'tools/call', { name: 'upload_assets', arguments: { images: [{ dataUrl }, { dataUrl }] } }));
    expect((created.structuredContent as { placed: unknown[] }).placed).toHaveLength(2);
  });
});

describe('MCP resources and prompts', () => {
  it('lists and reads resources', async () => {
    const { server } = buildServer();
    const listed = result(await call(server, 'resources/list')).resources as Array<{ uri: string }>;
    expect(listed.map((resource) => resource.uri)).toContain('pigma://document');

    const doc = result(await call(server, 'resources/read', { uri: 'pigma://document' }));
    const contents = (doc.contents as Array<{ mimeType: string; text: string }>)[0];
    expect(contents?.mimeType).toBe('application/json');
    expect(JSON.parse(contents?.text ?? '{}')).toMatchObject({ schema: 'pigma/1' });

    const metadata = result(await call(server, 'resources/read', { uri: 'pigma://document/metadata' }));
    expect((metadata.contents as Array<{ text: string }>)[0]?.text).toContain('<node');

    const bad = await call(server, 'resources/read', { uri: 'pigma://nope' });
    expect('error' in bad && bad.error.code).toBe(-32602);

    // Clients that probe for templates get a well-formed empty list, not an error.
    const templates = result(await call(server, 'resources/templates/list'));
    expect(templates.resourceTemplates).toEqual([]);
  });

  it('lists and renders the published prompt', async () => {
    const { server } = buildServer();
    const prompts = result(await call(server, 'prompts/list')).prompts as Array<{ name: string; arguments?: unknown[] }>;
    expect(prompts.map((prompt) => prompt.name)).toEqual(['create_design_system_rules']);
    // Figma publishes no arguments for this prompt.
    expect(prompts[0]?.arguments ?? []).toEqual([]);

    const rendered = result(await call(server, 'prompts/get', { name: 'create_design_system_rules' }));
    const messages = rendered.messages as Array<{ role: string; content: { text: string } }>;
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content.text).toContain('get_design_context');
    expect(messages[0]?.content.text).toContain('rules/');
  });

  // The complete Figma MCP tool surface as published (docs/rest-api + MCP tools page).
  const PUBLISHED_TOOLS = [
    'download_assets', 'get_code_connect_map', 'get_code_connect_suggestions', 'get_context_for_code_connect',
    'get_design_context', 'get_figjam', 'get_generative_plugin', 'get_libraries', 'get_metadata', 'get_motion_context',
    'get_screenshot', 'get_shader', 'get_variable_defs', 'list_file_shaders', 'list_generative_plugins', 'list_shaders',
    'search_design_system', 'whoami',
    'add_code_connect_map', 'create_generative_plugin', 'create_new_file', 'create_shader', 'generate_diagram',
    'generate_pigma_design', 'send_code_connect_mappings', 'update_generative_plugin', 'update_shader', 'upload_assets',
    'use_pigma',
    'weave_list_tools', 'weave_get_tool_inputs', 'weave_upload_asset', 'weave_run_tool', 'weave_get_tool_run_output',
    'weave_cancel_tool_run',
  ];

  it('registers every published Figma MCP tool', async () => {
    const { server } = buildServer();
    const listed = result(await call(server, 'tools/list', {}));
    const names = new Set((listed.tools as Array<{ name: string }>).map((tool) => tool.name));
    const missing = PUBLISHED_TOOLS.filter((name) => !names.has(name));
    expect(missing).toEqual([]);
  });

  // Every tool for which Figma's page publishes an explicit `**Parameters:**`
  // block, with the exact names it lists. Pigma may add documented extensions
  // (a superset is fine); a missing published name is a parity bug.
  const PUBLISHED_PARAMS: Record<string, string[]> = {
    list_generative_plugins: ['cursor'],
    get_generative_plugin: ['id', 'version', 'includeSource'],
    create_generative_plugin: ['name', 'description', 'planKey'],
    update_generative_plugin: ['id', 'commitMessage', 'files', 'metadata'],
    list_shaders: ['cursor'],
    get_shader: ['id', 'version', 'includeSource'],
    create_shader: ['name', 'description', 'planKey', 'kind'],
    update_shader: ['id', 'kind', 'commitMessage', 'files', 'metadata'],
    list_file_shaders: ['fileKey'],
    weave_list_tools: ['search'],
    weave_get_tool_inputs: ['recipeId', 'version'],
    weave_upload_asset: ['recipeId'],
    weave_run_tool: ['recipeId', 'version', 'inputs', 'numberOfRuns', 'acknowledgedCost'],
    weave_get_tool_run_output: ['recipeId', 'runIds'],
    weave_cancel_tool_run: ['recipeId', 'runIds'],
  };

  it('covers every parameter name Figma publishes', async () => {
    const { server } = buildServer();
    const listed = result(await call(server, 'tools/list', {}));
    const byName = new Map(
      (listed.tools as Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }>).map((tool) => [tool.name, tool]),
    );
    const missing: string[] = [];
    for (const [tool, params] of Object.entries(PUBLISHED_PARAMS)) {
      const registered = Object.keys(byName.get(tool)?.inputSchema.properties ?? {});
      for (const param of params) {
        if (!registered.includes(param)) missing.push(`${tool}.${param}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('answers every Weave tool with an explicit capability error', async () => {
    const { server } = buildServer();
    for (const name of PUBLISHED_TOOLS.filter((tool) => tool.startsWith('weave_'))) {
      const outcome = result(await call(server, 'tools/call', { name, arguments: { recipeId: 'r1' } })) as {
        isError?: boolean;
        structuredContent?: { supported?: boolean; capability?: string; reason?: string; alternatives?: string[] };
      };
      expect(outcome.isError).toBe(true);
      expect(outcome.structuredContent?.supported).toBe(false);
      expect(outcome.structuredContent?.capability).toBe(name);
      expect(outcome.structuredContent?.reason).toMatch(/weavy\.ai/);
      expect(outcome.structuredContent?.alternatives?.length).toBeGreaterThan(0);
    }
  });
});
