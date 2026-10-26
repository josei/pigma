/**
 * Figma variables → model tables.
 *
 * Figma keeps variables outside the file JSON: the REST API exposes them from a
 * separate `/v1/files/:key/variables/local` endpoint, and native `.fig` documents
 * carry their own `variableCollections` / `variables` tables. Both shapes are
 * mapped here onto the model's `variableCollections`, `variables` and
 * `activeModes` tables, so imported files resolve variable bindings immediately.
 */
import type { RGBA, VariableCollection, VariableDefinition, VariableValue } from '../../model/types';
import type { ReportBuilder } from './report';
import { isRecord } from '../../model/guards';

export interface FigmaVariableTables {
  variableCollections?: Record<string, VariableCollection>;
  variables?: Record<string, VariableDefinition>;
  activeModes?: Record<string, string>;
}

const VARIABLE_TYPES: readonly VariableDefinition['resolvedType'][] = ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'];

/** REST payloads key tables by id; native documents use arrays. Normalise both. */
function asEntries(value: unknown): Array<[string, Record<string, unknown>]> {
  if (Array.isArray(value)) {
    return value
      .filter(isRecord)
      .map((entry) => [typeof entry.id === 'string' ? entry.id : '', entry] as [string, Record<string, unknown>])
      .filter(([id]) => id !== '');
  }
  if (isRecord(value)) {
    return Object.entries(value).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]));
  }
  return [];
}

function toColor(value: unknown): RGBA | null {
  const raw = isRecord(value) && isRecord(value.color) ? value.color : value;
  if (!isRecord(raw)) return null;
  const { r, g, b, a } = raw;
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return null;
  return { r, g, b, a: typeof a === 'number' ? a : 1 };
}

function toVariableValue(type: VariableDefinition['resolvedType'], value: unknown): VariableValue | null {
  switch (type) {
    case 'COLOR': {
      const color = toColor(value);
      return color;
    }
    case 'FLOAT':
      return typeof value === 'number' ? value : null;
    case 'STRING':
      return typeof value === 'string' ? value : null;
    case 'BOOLEAN':
      return typeof value === 'boolean' ? value : null;
    default:
      return null;
  }
}

/** `valuesByMode` is a modeId→value map; some documents use `[{ key, value }]`. */
function valuesByMode(raw: unknown): Array<[string, unknown]> {
  if (Array.isArray(raw)) {
    return raw
      .filter(isRecord)
      .map((entry) => [typeof entry.key === 'string' ? entry.key : typeof entry.modeId === 'string' ? entry.modeId : '', entry.value] as [string, unknown])
      .filter(([modeId]) => modeId !== '');
  }
  if (isRecord(raw)) return Object.entries(raw);
  return [];
}

function isAlias(value: unknown): value is { type: 'VARIABLE_ALIAS'; id: string } {
  return isRecord(value) && value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string';
}

/**
 * Map either a `/variables/local` response (`{ meta: { … } }`), a bare
 * `{ variableCollections, variables }` table set, or a decoded `.fig` message.
 * Returns `undefined` when the source carries no variables at all.
 */
export function mapVariableTables(source: unknown, report: ReportBuilder): FigmaVariableTables | undefined {
  if (!isRecord(source)) return undefined;
  const root = isRecord(source.meta) ? source.meta : source;
  const collectionEntries = asEntries(root.variableCollections);
  const variableEntries = asEntries(root.variables);
  if (collectionEntries.length === 0 && variableEntries.length === 0) return undefined;

  const variables: Record<string, VariableDefinition> = {};
  const aliases: Array<{ id: string; modeId: string; targetId: string }> = [];

  for (const [id, entry] of variableEntries) {
    const type = entry.resolvedType;
    if (typeof type !== 'string' || !(VARIABLE_TYPES as readonly string[]).includes(type)) {
      report.addUnsupported({
        nodeId: id,
        path: `variables.${id}`,
        feature: 'variable:type',
        detail: `unsupported resolvedType ${JSON.stringify(type)}`,
      });
      continue;
    }
    const resolvedType = type as VariableDefinition['resolvedType'];
    const values: Record<string, VariableValue> = {};
    for (const [modeId, raw] of valuesByMode(entry.valuesByMode)) {
      if (isAlias(raw)) {
        // Aliases are resolved after every variable is known.
        aliases.push({ id, modeId, targetId: raw.id });
        continue;
      }
      const value = toVariableValue(resolvedType, raw);
      if (value === null) {
        report.addUnsupported({
          nodeId: id,
          path: `variables.${id}.valuesByMode.${modeId}`,
          feature: 'variable:value',
          detail: `could not map a ${resolvedType} value`,
        });
        continue;
      }
      values[modeId] = value;
    }
    variables[id] = {
      id,
      name: typeof entry.name === 'string' ? entry.name : id,
      resolvedType,
      variableCollectionId:
        typeof entry.variableCollectionId === 'string' ? entry.variableCollectionId : '',
      valuesByMode: values,
      ...(typeof entry.description === 'string' && entry.description !== '' ? { description: entry.description } : {}),
    };
  }

  // Resolve aliases against the target's own values (any mode it defines).
  for (const alias of aliases) {
    const target = variables[alias.targetId];
    const resolved = target ? Object.values(target.valuesByMode)[0] : undefined;
    if (resolved === undefined) {
      report.addUnsupported({
        nodeId: alias.id,
        path: `variables.${alias.id}.valuesByMode.${alias.modeId}`,
        feature: 'variable:alias',
        detail: `unresolved alias to ${alias.targetId}`,
      });
      continue;
    }
    variables[alias.id]!.valuesByMode[alias.modeId] = resolved;
  }

  const variableCollections: Record<string, VariableCollection> = {};
  const activeModes: Record<string, string> = {};
  for (const [id, entry] of collectionEntries) {
    const modes = (Array.isArray(entry.modes) ? entry.modes : [])
      .filter(isRecord)
      .map((mode) => ({
        modeId: typeof mode.modeId === 'string' ? mode.modeId : typeof mode.id === 'string' ? mode.id : '',
        name: typeof mode.name === 'string' ? mode.name : 'Mode',
      }))
      .filter((mode) => mode.modeId !== '');
    const defaultModeId =
      typeof entry.defaultModeId === 'string' && entry.defaultModeId !== ''
        ? entry.defaultModeId
        : (modes[0]?.modeId ?? '');
    const variableIds = (Array.isArray(entry.variableIds) ? entry.variableIds : [])
      .filter((variableId): variableId is string => typeof variableId === 'string' && variables[variableId] !== undefined);
    variableCollections[id] = {
      id,
      name: typeof entry.name === 'string' ? entry.name : id,
      modes,
      defaultModeId,
      // Fall back to the variables that point at this collection.
      variableIds:
        variableIds.length > 0
          ? variableIds
          : Object.values(variables)
              .filter((variable) => variable.variableCollectionId === id)
              .map((variable) => variable.id),
    };
    if (defaultModeId !== '') activeModes[id] = defaultModeId;
  }

  // Variables whose collection was not in the payload still need a home.
  for (const variable of Object.values(variables)) {
    const collectionId = variable.variableCollectionId;
    if (collectionId === '' || variableCollections[collectionId]) continue;
    variableCollections[collectionId] = {
      id: collectionId,
      name: collectionId,
      modes: Object.keys(variable.valuesByMode).map((modeId) => ({ modeId, name: modeId })),
      defaultModeId: Object.keys(variable.valuesByMode)[0] ?? '',
      variableIds: [],
    };
    report.warn(`Variable collection ${collectionId} was missing; recreated from its variables`);
  }

  if (Object.keys(variables).length === 0 && Object.keys(variableCollections).length === 0) return undefined;
  return { variableCollections, variables, activeModes };
}
