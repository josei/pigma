/**
 * Dependency-free Kiwi binary schema + message decoder.
 *
 * Kiwi is Figma's schema-based binary wire format (https://github.com/evanw/kiwi,
 * MIT). A `.fig` file's `canvas.fig` chunk 0 carries a self-describing Kiwi
 * schema; chunk 1 carries a Kiwi message (`nodeChanges`, `blobs`, ...).
 *
 * This module reimplements the read side of `kiwi-schema` (MIT, (c) Evan
 * Wallace) as an interpreter instead of generated `new Function` code, so it is
 * usable under a strict CSP and adds no dependency. Byte layout and semantics
 * mirror `kiwi-schema`'s `bb.ts` / `binary.ts` / `js.ts`.
 */

/** Native Kiwi scalar types, indexed by the encoded `~type` value. */
const NATIVE_TYPES = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64'] as const;
const DEFINITION_KINDS = ['ENUM', 'STRUCT', 'MESSAGE'] as const;

export type KiwiDefinitionKind = (typeof DEFINITION_KINDS)[number];

export interface KiwiField {
  name: string;
  /** `null` for enum fields; otherwise a native type or a definition name. */
  type: string | null;
  isArray: boolean;
  isDeprecated: boolean;
  /** Wire field id (message) / enum ordinal. */
  value: number;
}

export interface KiwiDefinition {
  name: string;
  kind: KiwiDefinitionKind;
  fields: KiwiField[];
}

export interface KiwiSchema {
  package: string | null;
  definitions: KiwiDefinition[];
}

// Shared scratch buffer for reinterpreting Kiwi's packed floats (no per-read allocation).
const FLOAT_SCRATCH = new ArrayBuffer(4);
const FLOAT_BITS = new Int32Array(FLOAT_SCRATCH);
const FLOAT_VALUE = new Float32Array(FLOAT_SCRATCH);

/** Byte reader mirroring `kiwi-schema`'s `ByteBuffer` read side. */
export class KiwiReader {
  private data: Uint8Array;
  private view: DataView;
  private index: number;

  constructor(data: Uint8Array) {
    if (!(data instanceof Uint8Array)) {
      throw new Error('KiwiReader requires a Uint8Array');
    }
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.index = 0;
  }

  get offset(): number {
    return this.index;
  }

  readByte(): number {
    const byte = this.data[this.index];
    if (byte === undefined) throw new Error('Kiwi: index out of bounds');
    this.index += 1;
    return byte;
  }

  readVarUint(): number {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.readByte();
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128 && shift < 35);
    return value >>> 0;
  }

  readVarInt(): number {
    const value = this.readVarUint() | 0;
    return value & 1 ? ~(value >>> 1) : value >>> 1;
  }

  readVarUint64(): bigint {
    let value = 0n;
    let shift = 0n;
    let byte: number;
    do {
      byte = this.readByte();
      value |= BigInt(byte & 127) << shift;
      shift += 7n;
    } while (byte & 128 && shift < 56n);
    value |= BigInt(byte) << shift;
    return value;
  }

  readVarInt64(): bigint {
    let value = this.readVarUint64();
    const sign = value & 1n;
    value >>= 1n;
    return sign ? ~value : value;
  }

  readVarFloat(): number {
    const first = this.readByte();
    if (first === 0) return 0;
    const start = this.index - 1;
    if (start + 4 > this.data.byteLength) throw new Error('Kiwi: index out of bounds');
    // The exponent lives in the first byte; move it back, then reinterpret the
    // 32 bits as an IEEE-754 float.
    const raw = this.view.getUint32(start, true);
    this.index = start + 4;
    FLOAT_BITS[0] = (raw << 23) | (raw >>> 9);
    return FLOAT_VALUE[0] ?? 0;
  }

  readByteArray(): Uint8Array {
    const length = this.readVarUint();
    const start = this.index;
    const end = start + length;
    if (end > this.data.length) throw new Error('Kiwi: read byte array out of bounds');
    this.index = end;
    // Copy so callers cannot alias the backing buffer.
    const out = new Uint8Array(length);
    out.set(this.data.subarray(start, end));
    return out;
  }

  readString(): string {
    let result = '';
    for (;;) {
      const a = this.readByte();
      let codePoint: number;
      if (a < 0xc0) {
        codePoint = a;
      } else {
        const b = this.readByte();
        if (a < 0xe0) {
          codePoint = ((a & 0x1f) << 6) | (b & 0x3f);
        } else {
          const c = this.readByte();
          if (a < 0xf0) {
            codePoint = ((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f);
          } else {
            const d = this.readByte();
            codePoint = ((a & 0x07) << 18) | ((b & 0x3f) << 12) | ((c & 0x3f) << 6) | (d & 0x3f);
          }
        }
      }
      if (codePoint === 0) break;
      if (codePoint < 0x10000) {
        result += String.fromCharCode(codePoint);
      } else {
        const cp = codePoint - 0x10000;
        result += String.fromCharCode((cp >> 10) + 0xd800, (cp & 0x3ff) + 0xdc00);
      }
    }
    return result;
  }
}

/**
 * Decode a Kiwi binary schema (chunk 0 of a `canvas.fig`, deflate-raw inflated).
 * Mirrors `decodeBinarySchema` from `kiwi-schema`.
 */
export function decodeBinarySchema(buffer: Uint8Array): KiwiSchema {
  const bb = new KiwiReader(buffer);
  const definitionCount = bb.readVarUint();
  const definitions: KiwiDefinition[] = [];

  for (let i = 0; i < definitionCount; i++) {
    const name = bb.readString();
    const kindIndex = bb.readByte();
    if (kindIndex < 0 || kindIndex >= DEFINITION_KINDS.length) {
      throw new Error(`Kiwi: invalid definition kind ${kindIndex} for ${name}`);
    }
    const kind = DEFINITION_KINDS[kindIndex];
    if (!kind) throw new Error(`Kiwi: invalid definition kind ${kindIndex} for ${name}`);
    const fieldCount = bb.readVarUint();
    const fields: KiwiField[] = [];
    for (let j = 0; j < fieldCount; j++) {
      const fieldName = bb.readString();
      const rawType = bb.readVarInt();
      const isArray = (bb.readByte() & 1) !== 0;
      const value = bb.readVarUint();
      fields.push({
        name: fieldName,
        // Enums carry no type; everything else is bound after all definitions
        // are read, because a field may reference a definition declared later.
        type: kind === 'ENUM' ? null : String(rawType),
        isArray,
        isDeprecated: false,
        value,
      });
    }
    definitions.push({ name, kind, fields });
  }

  // Bind type names (native scalars are encoded as negative values).
  for (const definition of definitions) {
    for (const field of definition.fields) {
      if (field.type === null) continue;
      const encoded = Number(field.type);
      if (encoded < 0) {
        const native = NATIVE_TYPES[~encoded];
        if (!native) throw new Error(`Kiwi: invalid type ${encoded}`);
        field.type = native;
      } else {
        const target = definitions[encoded];
        if (!target) throw new Error(`Kiwi: invalid type ${encoded}`);
        field.type = target.name;
      }
    }
  }

  return { package: null, definitions };
}

export interface CompiledSchema {
  schema: KiwiSchema;
  /** Enum name -> (name -> ordinal | ordinal -> name). */
  enums: Record<string, Record<string | number, string | number>>;
  /** `decode<Name>` for every STRUCT and MESSAGE definition. */
  decoders: Record<string, (input: Uint8Array | KiwiReader) => unknown>;
}

/**
 * Compile a decoded schema into `decode<Definition>` functions, matching the
 * surface of `kiwi-schema`'s `compileSchema` (minus code generation).
 */
export function compileSchema(schema: KiwiSchema): CompiledSchema {
  const byName = new Map<string, KiwiDefinition>();
  for (const definition of schema.definitions) byName.set(definition.name, definition);

  const enums: Record<string, Record<string | number, string | number>> = {};
  for (const definition of schema.definitions) {
    if (definition.kind !== 'ENUM') continue;
    const map: Record<string | number, string | number> = {};
    for (const field of definition.fields) {
      map[field.name] = field.value;
      map[field.value] = field.name;
    }
    enums[definition.name] = map;
  }

  const decoders: Record<string, (input: Uint8Array | KiwiReader) => unknown> = {};

  const decodeField = (field: KiwiField, bb: KiwiReader): unknown => {
    switch (field.type) {
      case 'bool':
        return bb.readByte() !== 0;
      case 'byte':
        return bb.readByte();
      case 'int':
        return bb.readVarInt();
      case 'uint':
        return bb.readVarUint();
      case 'float':
        return bb.readVarFloat();
      case 'string':
        return bb.readString();
      case 'int64':
        return bb.readVarInt64();
      case 'uint64':
        return bb.readVarUint64();
      default: {
        const type = field.type as string;
        const definition = byName.get(type);
        if (!definition) throw new Error(`Kiwi: unknown type ${type}`);
        if (definition.kind === 'ENUM') {
          const ordinal = bb.readVarUint();
          const values = enums[type];
          if (!values) throw new Error(`Kiwi: enum ${type} is not compiled`);
          return values[ordinal];
        }
        return decodeDefinition(definition, bb);
      }
    }
  };

  const decodeDefinition = (definition: KiwiDefinition, bb: KiwiReader): unknown => {
    if (definition.kind === 'ENUM') {
      throw new Error(`Kiwi: cannot decode enum ${definition.name} as a value`);
    }
    const result: Record<string, unknown> = {};

    if (definition.kind === 'STRUCT') {
      for (const field of definition.fields) {
        const value = field.isArray ? decodeArray(field, bb) : decodeField(field, bb);
        if (!field.isDeprecated) result[field.name] = value;
      }
      return result;
    }

    // MESSAGE: field-tagged, terminated by id 0.
    const fieldsById = new Map<number, KiwiField>();
    for (const field of definition.fields) fieldsById.set(field.value, field);
    for (;;) {
      const id = bb.readVarUint();
      if (id === 0) return result;
      const field = fieldsById.get(id);
      if (!field) {
        throw new Error(`Kiwi: unknown field id ${id} in message ${definition.name}`);
      }
      const value = field.isArray ? decodeArray(field, bb) : decodeField(field, bb);
      if (!field.isDeprecated) result[field.name] = value;
    }
  };

  const decodeArray = (field: KiwiField, bb: KiwiReader): unknown => {
    if (field.type === 'byte') return bb.readByteArray();
    const length = bb.readVarUint();
    const values = new Array(length);
    for (let i = 0; i < length; i++) values[i] = decodeField(field, bb);
    return values;
  };

  for (const definition of schema.definitions) {
    if (definition.kind === 'ENUM') continue;
    decoders[`decode${definition.name}`] = (input) =>
      decodeDefinition(definition, input instanceof KiwiReader ? input : new KiwiReader(input));
  }

  return { schema, enums, decoders };
}
