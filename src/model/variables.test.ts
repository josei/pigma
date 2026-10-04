import { describe, expect, it } from 'vitest';
import {
  activeModeOf,
  addMode,
  addVariable,
  bindableVariables,
  bindVariable,
  bindingsOf,
  collectionsOf,
  createCollection,
  defaultVariableValue,
  deleteVariable,
  renameVariable,
  resolveNodeVariables,
  resolveVariable,
  setActiveMode,
  setVariableValue,
  variablesOf,
} from './variables';
import { createRectNode, createTextNode } from './factory';
import { emptyFile } from './validate';
import { findNode } from './tree';
import { parseFile, serializeFile } from './serialize';
import type { SceneNode } from './types';

function setup() {
  const file = emptyFile('Variables');
  const page = file.document.children[0]!;
  const rect = createRectNode(null, 0, 0, 100, 100);
  const text = createTextNode(null, 0, 0, 'Hello');
  page.children = [rect, text];
  return { file, rectId: rect.id, textId: text.id };
}

const nodeOf = (file: ReturnType<typeof setup>['file'], id: string) => findNode(file.document, id) as SceneNode;

describe('variables and modes', () => {
  it('creates a collection with one active mode', () => {
    const { file } = setup();
    const { file: withCollection, collectionId } = createCollection(file, 'Theme');
    const collection = collectionsOf(withCollection)[collectionId]!;
    expect(collection.name).toBe('Theme');
    expect(collection.modes).toHaveLength(1);
    expect(activeModeOf(withCollection, collectionId)).toBe(collection.defaultModeId);
  });

  it('adds variables per type and edits values per mode', () => {
    const { file } = setup();
    const { file: c1, collectionId } = createCollection(file, 'Theme');
    const color = addVariable(c1, collectionId, 'COLOR', 'Brand');
    const number = addVariable(color.file, collectionId, 'FLOAT', 'Radius');
    expect(color.variableId).toBeTruthy();
    expect(variablesOf(number.file)[color.variableId!]!.name).toBe('Brand');

    const mode = activeModeOf(number.file, collectionId)!;
    const tinted = setVariableValue(number.file, color.variableId!, mode, { r: 1, g: 0, b: 0, a: 1 });
    expect(resolveVariable(tinted, color.variableId!)).toMatchObject({ r: 1, g: 0, b: 0 });
    expect(resolveVariable(tinted, number.variableId!)).toBe(1);
    expect(defaultVariableValue('BOOLEAN')).toBe(true);
    expect(defaultVariableValue('STRING')).toBe('');
  });

  it('adds a mode that inherits the current values, and switches between them', () => {
    const { file } = setup();
    const { file: c1, collectionId } = createCollection(file, 'Theme');
    const color = addVariable(c1, collectionId, 'COLOR', 'Brand');
    const first = activeModeOf(color.file, collectionId)!;
    const tinted = setVariableValue(color.file, color.variableId!, first, { r: 1, g: 0, b: 0, a: 1 });

    const withSecond = addMode(tinted, collectionId, 'Dark');
    const collection = collectionsOf(withSecond)[collectionId]!;
    expect(collection.modes).toHaveLength(2);
    const second = collection.modes[1]!.modeId;
    // The new mode starts from the active mode's value.
    expect(resolveVariable(setActiveMode(withSecond, collectionId, second), color.variableId!)).toMatchObject({ r: 1, g: 0, b: 0 });

    const dark = setVariableValue(withSecond, color.variableId!, second, { r: 0, g: 0, b: 1, a: 1 });
    expect(resolveVariable(setActiveMode(dark, collectionId, first), color.variableId!)).toMatchObject({ r: 1, g: 0, b: 0 });
    expect(resolveVariable(setActiveMode(dark, collectionId, second), color.variableId!)).toMatchObject({ r: 0, g: 0, b: 1 });
    // An unknown mode is ignored rather than corrupting the active mode.
    expect(setActiveMode(dark, collectionId, 'nope')).toBe(dark);
  });

  it('binds a colour variable to a fill and resolves it per mode', () => {
    const { file, rectId } = setup();
    const { file: c1, collectionId } = createCollection(file, 'Theme');
    const color = addVariable(c1, collectionId, 'COLOR', 'Brand');
    const first = activeModeOf(color.file, collectionId)!;
    let next = setVariableValue(color.file, color.variableId!, first, { r: 1, g: 0, b: 0, a: 1 });
    next = bindVariable(next, rectId, 'fill', color.variableId!);
    expect(bindingsOf(nodeOf(next, rectId)).fill).toBe(color.variableId);

    const resolved = resolveNodeVariables(next, nodeOf(next, rectId));
    expect(resolved?.fills?.[0]).toMatchObject({ type: 'SOLID', color: { r: 1, g: 0, b: 0 } });

    // A second mode with a different colour repaints the same node.
    const withSecond = addMode(next, collectionId, 'Dark');
    const second = collectionsOf(withSecond)[collectionId]!.modes[1]!.modeId;
    const dark = setVariableValue(withSecond, color.variableId!, second, { r: 0, g: 0, b: 1, a: 1 });
    const switched = setActiveMode(dark, collectionId, second);
    expect(resolveNodeVariables(switched, nodeOf(switched, rectId))?.fills?.[0]).toMatchObject({ color: { r: 0, g: 0, b: 1 } });
  });

  it('resolves opacity, visibility and text bindings', () => {
    const { file, rectId, textId } = setup();
    const { file: c1, collectionId } = createCollection(file, 'Theme');
    const mode = activeModeOf(c1, collectionId)!;
    const opacity = addVariable(c1, collectionId, 'FLOAT', 'Opacity');
    const visible = addVariable(opacity.file, collectionId, 'BOOLEAN', 'Visible');
    const label = addVariable(visible.file, collectionId, 'STRING', 'Label');

    let next = setVariableValue(label.file, opacity.variableId!, mode, 0.5);
    next = setVariableValue(next, visible.variableId!, mode, false);
    next = setVariableValue(next, label.variableId!, mode, 'From a variable');
    next = bindVariable(next, rectId, 'opacity', opacity.variableId!);
    next = bindVariable(next, rectId, 'visible', visible.variableId!);
    next = bindVariable(next, textId, 'characters', label.variableId!);

    const resolvedRect = resolveNodeVariables(next, nodeOf(next, rectId));
    expect(resolvedRect?.opacity).toBe(0.5);
    expect(resolvedRect?.visible).toBe(false);
    expect(resolveNodeVariables(next, nodeOf(next, textId))?.characters).toBe('From a variable');
  });

  it('lists bindable variables by property type', () => {
    const { file } = setup();
    const { file: c1, collectionId } = createCollection(file, 'Theme');
    const color = addVariable(c1, collectionId, 'COLOR', 'Brand');
    const number = addVariable(color.file, collectionId, 'FLOAT', 'Opacity');
    const options = bindableVariables(number.file, 'fill');
    expect(options.map((option) => option.name)).toEqual(['Brand']);
    expect(bindableVariables(number.file, 'opacity').map((option) => option.name)).toEqual(['Opacity']);
    expect(bindableVariables(number.file, 'nope')).toEqual([]);
  });

  it('deletes a variable and unbinds it everywhere', () => {
    const { file, rectId } = setup();
    const { file: c1, collectionId } = createCollection(file, 'Theme');
    const color = addVariable(c1, collectionId, 'COLOR', 'Brand');
    const bound = bindVariable(color.file, rectId, 'fill', color.variableId!);
    const removed = deleteVariable(bound, color.variableId!);
    expect(variablesOf(removed)[color.variableId!]).toBeUndefined();
    expect(bindingsOf(nodeOf(removed, rectId)).fill).toBeUndefined();
    expect(collectionsOf(removed)[collectionId]!.variableIds).toEqual([]);
    expect(resolveNodeVariables(removed, nodeOf(removed, rectId))).toBeNull();
  });

  it('renames variables and ignores blank names', () => {
    const { file } = setup();
    const { file: c1, collectionId } = createCollection(file, 'Theme');
    const color = addVariable(c1, collectionId, 'COLOR', 'Brand');
    expect(variablesOf(renameVariable(color.file, color.variableId!, 'Primary'))[color.variableId!]!.name).toBe('Primary');
    expect(renameVariable(color.file, color.variableId!, '  ').variables).toBe(color.file.variables);
  });

  it('round-trips collections, values and bindings through JSON', () => {
    const { file, rectId } = setup();
    const { file: c1, collectionId } = createCollection(file, 'Theme');
    const color = addVariable(c1, collectionId, 'COLOR', 'Brand');
    const mode = activeModeOf(color.file, collectionId)!;
    let next = setVariableValue(color.file, color.variableId!, mode, { r: 0.2, g: 0.8, b: 0.4, a: 1 });
    next = bindVariable(next, rectId, 'fill', color.variableId!);

    const restored = parseFile(serializeFile(next));
    expect(restored.ok).toBe(true);
    const file2 = restored.file!;
    expect(collectionsOf(file2)[collectionId]!.modes).toHaveLength(1);
    expect(activeModeOf(file2, collectionId)).toBe(mode);
    expect(resolveVariable(file2, color.variableId!)).toMatchObject({ g: 0.8 });
    expect(bindingsOf(nodeOf(file2, rectId)).fill).toBe(color.variableId);
    expect(resolveNodeVariables(file2, nodeOf(file2, rectId))?.fills?.[0]).toMatchObject({ color: { g: 0.8 } });
  });
});
