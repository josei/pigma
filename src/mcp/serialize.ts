/**
 * Serializers that turn the Pigma model into the shapes MCP clients expect:
 * a sparse XML outline (`get_metadata`) and a structured design context
 * (`get_design_context`).
 */
import type { ContainerNode, PigmaFile, SceneNode } from '../model/types';
import { hasChildren } from '../model/types';
import { absoluteBounds } from '../model/tree';
import { stylesOf, styleBindingOf } from '../model/styles';
import { activeModeOf, bindingsOf, collectionsOf, resolveVariable, variablesOf } from '../model/variables';
import { resolvedProperties } from '../model/variants';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attr(name: string, value: string | number | undefined): string {
  return value === undefined ? '' : ` ${name}="${escapeXml(String(value))}"`;
}

/** Sparse XML outline of a node subtree: ids, names, types, position, size. */
export function metadataXml(file: PigmaFile, nodes: SceneNode[]): string {
  const lines: string[] = [];
  const emit = (node: SceneNode, depth: number): void => {
    const pad = '  '.repeat(depth);
    const bounds = absoluteBounds(file.document, node.id);
    const attrs =
      attr('id', node.id) +
      attr('name', node.name) +
      attr('type', node.type) +
      attr('x', bounds ? Math.round(bounds.x * 100) / 100 : undefined) +
      attr('y', bounds ? Math.round(bounds.y * 100) / 100 : undefined) +
      attr('width', Math.round(node.width * 100) / 100) +
      attr('height', Math.round(node.height * 100) / 100);
    if (hasChildren(node)) {
      lines.push(`${pad}<node${attrs}>`);
      for (const child of (node as ContainerNode).children) emit(child, depth + 1);
      lines.push(`${pad}</node>`);
    } else {
      lines.push(`${pad}<node${attrs} />`);
    }
  };
  for (const node of nodes) emit(node, 0);
  return lines.join('\n');
}

/** Variable bindings on a node, resolved against the file's variables table. */
function variableBindings(file: PigmaFile, node: SceneNode): Record<string, unknown> | undefined {
  const bindings = bindingsOf(node);
  const properties = Object.keys(bindings);
  if (properties.length === 0) return undefined;
  const variables = variablesOf(file);
  const collections = collectionsOf(file);
  const resolved: Record<string, unknown> = {};
  for (const property of properties) {
    const variableId = bindings[property] as string;
    const variable = variables[variableId];
    resolved[property] = variable
      ? {
          id: variableId,
          name: variable.name,
          resolvedType: variable.resolvedType,
          value: resolveVariable(file, variableId) ?? null,
          collection: collections[variable.variableCollectionId]?.name ?? null,
          description: variable.description ?? null,
        }
      : { id: variableId, name: null, resolvedType: null, value: null, collection: null, description: null };
  }
  return resolved;
}

/** Style bindings on a node, resolved against the file's styles table. */
function styleBindings(file: PigmaFile, node: SceneNode): Record<string, unknown> | undefined {
  const bindings = styleBindingOf(node) as Record<string, string | undefined>;
  const properties = Object.keys(bindings).filter((property) => typeof bindings[property] === 'string');
  if (properties.length === 0) return undefined;
  const styles = stylesOf(file);
  const resolved: Record<string, unknown> = {};
  for (const property of properties) {
    const styleId = bindings[property] as string;
    const style = styles[styleId];
    resolved[property] = style
      ? { id: styleId, key: style.key, name: style.name, type: style.type, description: style.description ?? null }
      : { id: styleId, key: null, name: null, type: null, description: null };
  }
  return resolved;
}

function contextForNode(file: PigmaFile, node: SceneNode): Record<string, unknown> {
  const bounds = absoluteBounds(file.document, node.id);
  const context: Record<string, unknown> = {
    id: node.id,
    name: node.name,
    type: node.type,
    bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null,
    width: node.width,
    height: node.height,
    visible: node.visible,
    opacity: node.opacity,
    transform: node.transform,
  };
  if (node.blendMode) context.blendMode = node.blendMode;
  if (node.fills.length > 0) context.fills = node.fills;
  if (node.strokes.length > 0) context.strokes = node.strokes;
  if (node.strokeWeight !== undefined) context.strokeWeight = node.strokeWeight;
  if (node.strokeAlign) context.strokeAlign = node.strokeAlign;
  if (node.effects && node.effects.length > 0) context.effects = node.effects;
  if (node.constraints) context.constraints = node.constraints;
  if (node.type === 'TEXT') {
    context.text = { characters: node.characters, style: node.style };
  }
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    context.component = {
      propertyDefinitions: node.componentPropertyDefinitions ?? {},
      description: node.description ?? null,
    };
  }
  if (node.type === 'INSTANCE') {
    context.component = {
      id: node.componentId,
      properties: node.componentProperties ?? {},
      // Properties after variant resolution, so consumers see the effective values.
      resolvedProperties: resolvedProperties(file, node),
    };
  }
  if (node.componentPropertyReferences && Object.keys(node.componentPropertyReferences).length > 0) {
    context.componentPropertyReferences = node.componentPropertyReferences;
  }
  const variables = variableBindings(file, node);
  if (variables) context.variables = variables;
  const styles = styleBindings(file, node);
  if (styles) context.styles = styles;
  if ('cornerRadius' in node && node.cornerRadius !== undefined) context.cornerRadius = node.cornerRadius;
  if ('rectangleCornerRadii' in node && node.rectangleCornerRadii !== undefined) {
    context.rectangleCornerRadii = node.rectangleCornerRadii;
  }
  if ('pathData' in node && node.pathData !== undefined) context.pathData = node.pathData;
  if ('windingRule' in node && node.windingRule !== undefined) context.windingRule = node.windingRule;
  if ('autoLayout' in node && node.autoLayout) context.autoLayout = node.autoLayout;
  if ('clipsContent' in node && node.clipsContent !== undefined) context.clipsContent = node.clipsContent;
  if (hasChildren(node)) {
    context.children = (node as ContainerNode).children.map((child) => contextForNode(file, child));
  }
  return context;
}

/**
 * Structured design context for the given nodes. This is a faithful projection
 * of the Pigma model (geometry, paints, effects, text, layout, components) —
 * not Figma's React/Tailwind code output, which the hosted server generates.
 */
export function designContext(file: PigmaFile, nodes: SceneNode[]): Record<string, unknown> {
  const collections = Object.values(collectionsOf(file)).map((collection) => ({
    id: collection.id,
    name: collection.name,
    modes: collection.modes,
    defaultModeId: collection.defaultModeId,
    activeModeId: activeModeOf(file, collection.id),
  }));
  const styles = Object.values(stylesOf(file)).map((style) => ({
    id: style.key,
    key: style.key,
    name: style.name,
    type: style.type,
  }));
  return {
    format: 'pigma-design-context',
    file: {
      name: file.name,
      schema: file.schema,
      source: file.source ?? null,
      // Token tables the projection resolves node bindings against.
      styles,
      variableCollections: collections,
      variables: Object.values(variablesOf(file)).map((variable) => ({
        id: variable.id,
        name: variable.name,
        resolvedType: variable.resolvedType,
        variableCollectionId: variable.variableCollectionId,
        value: resolveVariable(file, variable.id) ?? null,
      })),
    },
    nodes: nodes.map((node) => contextForNode(file, node)),
  };
}

/** Flat inventory of node ids, names, and types for a subtree. */
export function nodeInventory(nodes: SceneNode[]): Array<{ id: string; name: string; type: string }> {
  const entries: Array<{ id: string; name: string; type: string }> = [];
  const visit = (node: SceneNode): void => {
    entries.push({ id: node.id, name: node.name, type: node.type });
    if (hasChildren(node)) for (const child of (node as ContainerNode).children) visit(child);
  };
  for (const node of nodes) visit(node);
  return entries;
}
