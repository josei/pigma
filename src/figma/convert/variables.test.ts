import { describe, expect, it } from 'vitest';
import { mapVariableTables } from './variables';
import { ReportBuilder } from './report';
import { figDocumentToPigmaFile, figmaRestToPigmaFile } from './convert';
import { parseFigmaRestFile } from '../rest/parse';
import { findNode } from '../../model/tree';
import type { FigDocument } from '../native/parse';
import { resolveNodeVariables } from '../../model/variables';
import type { SceneNode } from '../../model/types';

const localPayload = {
  meta: {
    variableCollections: {
      'VariableCollectionId:1:2': {
        id: 'VariableCollectionId:1:2',
        name: 'Colors',
        modes: [
          { modeId: '1:0', name: 'Light' },
          { modeId: '1:1', name: 'Dark' },
        ],
        defaultModeId: '1:0',
        variableIds: ['VariableID:1:3', 'VariableID:1:4'],
      },
    },
    variables: {
      'VariableID:1:3': {
        id: 'VariableID:1:3',
        name: 'brand/primary',
        variableCollectionId: 'VariableCollectionId:1:2',
        resolvedType: 'COLOR',
        valuesByMode: { '1:0': { r: 0.05, g: 0.6, b: 1, a: 1 }, '1:1': { r: 0.4, g: 0.8, b: 1, a: 1 } },
        description: 'Primary action colour',
      },
      'VariableID:1:4': {
        id: 'VariableID:1:4',
        name: 'spacing/md',
        variableCollectionId: 'VariableCollectionId:1:2',
        resolvedType: 'FLOAT',
        valuesByMode: { '1:0': 16, '1:1': 12 },
      },
    },
  },
};

describe('mapVariableTables', () => {
  it('maps a /variables/local payload onto the model tables', () => {
    const report = new ReportBuilder();
    const tables = mapVariableTables(localPayload, report)!;
    expect(Object.keys(tables.variables!)).toEqual(['VariableID:1:3', 'VariableID:1:4']);
    expect(tables.variables!['VariableID:1:3']).toMatchObject({
      name: 'brand/primary',
      resolvedType: 'COLOR',
      variableCollectionId: 'VariableCollectionId:1:2',
      description: 'Primary action colour',
    });
    expect(tables.variables!['VariableID:1:3']!.valuesByMode['1:1']).toEqual({ r: 0.4, g: 0.8, b: 1, a: 1 });
    expect(tables.variables!['VariableID:1:4']!.valuesByMode['1:0']).toBe(16);
    const collection = tables.variableCollections!['VariableCollectionId:1:2']!;
    expect(collection.modes).toEqual([{ modeId: '1:0', name: 'Light' }, { modeId: '1:1', name: 'Dark' }]);
    expect(collection.defaultModeId).toBe('1:0');
    expect(collection.variableIds).toEqual(['VariableID:1:3', 'VariableID:1:4']);
    expect(tables.activeModes).toEqual({ 'VariableCollectionId:1:2': '1:0' });
    expect(report.unsupported).toEqual([]);
  });

  it('accepts native tables given as arrays and resolves aliases', () => {
    const report = new ReportBuilder();
    const tables = mapVariableTables(
      {
        variableCollections: [
          { id: 'c1', name: 'Theme', modes: [{ modeId: 'm1', name: 'Default' }], defaultModeId: 'm1', variableIds: ['v1', 'v2'] },
        ],
        variables: [
          { id: 'v1', name: 'fg', resolvedType: 'COLOR', variableCollectionId: 'c1', valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } } },
          {
            id: 'v2',
            name: 'bg',
            resolvedType: 'COLOR',
            variableCollectionId: 'c1',
            valuesByMode: [{ key: 'm1', value: { type: 'VARIABLE_ALIAS', id: 'v1' } }],
          },
        ],
      },
      report,
    )!;
    expect(tables.variables!['v2']!.valuesByMode.m1).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(tables.variableCollections!['c1']!.variableIds).toEqual(['v1', 'v2']);
    expect(report.unsupported).toEqual([]);
  });

  it('reports unsupported types, values and unresolved aliases', () => {
    const report = new ReportBuilder();
    const tables = mapVariableTables(
      {
        variableCollections: {},
        variables: {
          a: { id: 'a', name: 'weird', resolvedType: 'EXPRESSION', variableCollectionId: 'c1', valuesByMode: {} },
          b: { id: 'b', name: 'bad float', resolvedType: 'FLOAT', variableCollectionId: 'c1', valuesByMode: { m1: 'nope' } },
          c: { id: 'c', name: 'alias', resolvedType: 'COLOR', variableCollectionId: 'c1', valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'missing' } } },
        },
      },
      report,
    )!;
    expect(Object.keys(tables.variables!)).toEqual(['b', 'c']);
    expect(report.unsupported.map((item) => item.feature)).toEqual(['variable:type', 'variable:value', 'variable:alias']);
    // The missing collection is recreated so the variables still resolve.
    expect(tables.variableCollections!['c1']).toBeTruthy();
    expect(report.warnings.some((warning) => warning.includes('c1'))).toBe(true);
  });

  it('returns undefined when there are no variables at all', () => {
    const report = new ReportBuilder();
    expect(mapVariableTables(undefined, report)).toBeUndefined();
    expect(mapVariableTables({ meta: {} }, report)).toBeUndefined();
    expect(mapVariableTables({ document: {} }, report)).toBeUndefined();
  });
});

describe('variable tables through the converters', () => {
  const document = {
    id: '0:0',
    name: 'Document',
    type: 'DOCUMENT',
    children: [
      {
        id: '0:1',
        name: 'Page 1',
        type: 'CANVAS',
        children: [
          {
            id: '1:1',
            name: 'Card',
            type: 'RECTANGLE',
            absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
            fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
            boundVariables: { fills: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:3' } },
          },
        ],
      },
    ],
  };

  it('merges a /variables/local payload passed to the REST converter', () => {
    const source = parseFigmaRestFile({ name: 'Themed', document });
    const result = figmaRestToPigmaFile(source, { variables: localPayload, now: () => 0 });
    const file = result.file;
    expect(Object.keys(file.variables ?? {})).toHaveLength(2);
    expect(file.variableCollections?.['VariableCollectionId:1:2']?.name).toBe('Colors');
    expect(file.activeModes).toEqual({ 'VariableCollectionId:1:2': '1:0' });
    // The node's binding is mapped onto the model's property name and resolves.
    const card = findNode(file.document, '1:1') as SceneNode;
    expect(card.boundVariables).toEqual({ fill: 'VariableID:1:3' });
    const resolved = resolveNodeVariables(file, card);
    expect(resolved?.fills?.[0]).toMatchObject({ type: 'SOLID', color: { r: 0.05, g: 0.6, b: 1 } });
    // Switching the active mode repaints from the imported table.
    const dark = { ...file, activeModes: { 'VariableCollectionId:1:2': '1:1' } };
    const darkResolved = resolveNodeVariables(dark, findNode(dark.document, '1:1') as SceneNode);
    expect(darkResolved?.fills?.[0]).toMatchObject({ color: { r: 0.4, g: 0.8, b: 1 } });
  });

  it('reads the variable tables out of a native .fig message', () => {
    const nativeNodes = [
      { guid: { sessionID: 0, localID: 0 }, type: 'DOCUMENT', name: 'Document' },
      { guid: { sessionID: 0, localID: 1 }, type: 'CANVAS', name: 'Page 1', parentIndex: { guid: { sessionID: 0, localID: 0 }, position: '!' } },
      {
        guid: { sessionID: 0, localID: 2 },
        type: 'RECTANGLE',
        name: 'Card',
        parentIndex: { guid: { sessionID: 0, localID: 1 }, position: '!' },
        size: { x: 100, y: 100 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        fillPaints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
        variableBindings: { fills: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:3' } },
      },
    ];
    const native = {
      header: { prelude: 'fig-kiwi', version: 106 },
      nodes: nativeNodes,
      nodeMap: new Map(nativeNodes.map((node) => [`${node.guid.sessionID}:${node.guid.localID}`, node])),
      childrenMap: new Map([
        ['0:0', [nativeNodes[1]]],
        ['0:1', [nativeNodes[2]]],
      ]),
      schema: {},
      compiledSchema: {},
      rawChunks: [],
      message: {
        nodeChanges: nativeNodes,
        variableCollections: localPayload.meta.variableCollections,
        variables: localPayload.meta.variables,
      },
      blobs: [],
      images: new Map(),
    } as unknown as FigDocument;
    const result = figDocumentToPigmaFile(native, { now: () => 0 });
    expect(Object.keys(result.file.variables ?? {})).toHaveLength(2);
    expect(result.file.variables?.['VariableID:1:4']?.resolvedType).toBe('FLOAT');
    expect(result.file.activeModes?.['VariableCollectionId:1:2']).toBe('1:0');
    // Native bindings are normalised too, so the imported layer resolves.
    const page = result.file.document.children[0]!;
    const card = (page.children as SceneNode[])[0]!;
    expect(card?.name).toBe('Card');
    expect(card.boundVariables).toEqual({ fill: 'VariableID:1:3' });
    expect(resolveNodeVariables(result.file, card)?.fills?.[0]).toMatchObject({ color: { r: 0.05, g: 0.6, b: 1 } });
  });

  it('leaves the tables absent when the source has no variables', () => {
    const source = parseFigmaRestFile({ name: 'Plain', document });
    const result = figmaRestToPigmaFile(source, { now: () => 0 });
    expect(result.file.variables).toBeUndefined();
    expect(result.file.variableCollections).toBeUndefined();
  });
});

describe('prototype and boolean metadata through import', () => {
  it('keeps the boolean operation and the frame scrolling', () => {
    const source = parseFigmaRestFile({
      name: 'Prototype',
      document: {
        id: '0:0',
        name: 'Document',
        type: 'DOCUMENT',
        children: [
          {
            id: '0:1',
            name: 'Page 1',
            type: 'CANVAS',
            children: [
              {
                id: '1:1',
                name: 'Scroller',
                type: 'FRAME',
                absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
                clipsContent: true,
                overflowDirection: 'VERTICAL_SCROLLING',
                children: [],
              },
              {
                id: '1:2',
                name: 'Cut out',
                type: 'BOOLEAN_OPERATION',
                booleanOperation: 'SUBTRACT',
                absoluteBoundingBox: { x: 0, y: 300, width: 100, height: 100 },
                children: [],
              },
            ],
          },
        ],
      },
    });
    const file = figmaRestToPigmaFile(source, { now: () => 0 }).file;
    const page = file.document.children[0]!;
    const scroller = page.children[0] as SceneNode & { overflowDirection?: string };
    const boolean = page.children[1] as SceneNode & { booleanOperation?: string };
    expect(scroller.overflowDirection).toBe('VERTICAL_SCROLLING');
    expect(boolean.booleanOperation).toBe('SUBTRACT');
  });
});
