import { describe, expect, it } from 'vitest';
import { compileSchema, decodeBinarySchema, KiwiReader } from '../../src/figma/native/kiwi';

/** Minimal Kiwi encoder, used only to exercise the decoder without a fixture. */
class Writer {
  private readonly bytes: number[] = [];

  byte(value: number): void {
    this.bytes.push(value & 0xff);
  }

  varuint(value: number): void {
    let rest = value >>> 0;
    do {
      const byte = rest & 127;
      rest >>>= 7;
      this.byte(rest ? byte | 128 : byte);
    } while (rest);
  }

  varint(value: number): void {
    this.varuint(((value << 1) ^ (value >> 31)) >>> 0);
  }

  string(value: string): void {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 0x80) this.byte(code);
      else if (code < 0x800) {
        this.byte(((code >> 6) & 0x1f) | 0xc0);
        this.byte((code & 0x3f) | 0x80);
      } else {
        this.byte(((code >> 12) & 0x0f) | 0xe0);
        this.byte(((code >> 6) & 0x3f) | 0x80);
        this.byte((code & 0x3f) | 0x80);
      }
    }
    this.byte(0);
  }

  byteArray(value: number[]): void {
    this.varuint(value.length);
    for (const byte of value) this.byte(byte);
  }

  varfloat(value: number): void {
    const scratch = new ArrayBuffer(4);
    new Float32Array(scratch)[0] = value;
    let bits = new Int32Array(scratch)[0] ?? 0;
    bits = (bits >>> 23) | (bits << 9);
    if ((bits & 255) === 0) {
      this.byte(0);
      return;
    }
    for (let i = 0; i < 4; i++) this.byte((bits >>> (8 * i)) & 0xff);
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

const NATIVE = { bool: 0, byte: 1, int: 2, uint: 3, float: 4, string: 5, int64: 6, uint64: 7 } as const;

function field(w: Writer, name: string, type: string | number, isArray: boolean, value: number): void {
  w.string(name);
  w.varint(typeof type === 'number' ? type : ~NATIVE[type as keyof typeof NATIVE]);
  w.byte(isArray ? 1 : 0);
  w.varuint(value);
}

function buildSchema(): Uint8Array {
  const w = new Writer();
  w.varuint(2);
  // ENUM Color { RED = 0; GREEN = 1 }
  w.string('Color');
  w.byte(0);
  w.varuint(2);
  field(w, 'RED', 0, false, 0);
  field(w, 'GREEN', 0, false, 1);
  // MESSAGE Message { … }
  w.string('Message');
  w.byte(2);
  w.varuint(6);
  field(w, 'count', 'uint', false, 1);
  field(w, 'name', 'string', false, 2);
  field(w, 'flag', 'bool', false, 3);
  field(w, 'colors', 0, true, 4);
  field(w, 'data', 'byte', true, 5);
  field(w, 'ratio', 'float', false, 6);
  return w.toBytes();
}

function buildMessage(): Uint8Array {
  const w = new Writer();
  w.varuint(1);
  w.varuint(3);
  w.varuint(2);
  w.string('hi');
  w.varuint(3);
  w.byte(1);
  w.varuint(4);
  w.varuint(2);
  w.varuint(1);
  w.varuint(0);
  w.varuint(5);
  w.byteArray([1, 2, 3]);
  w.varuint(6);
  w.varfloat(1.5);
  w.varuint(0);
  return w.toBytes();
}

describe('Kiwi decoder', () => {
  it('decodes a binary schema', () => {
    const schema = decodeBinarySchema(buildSchema());
    expect(schema.definitions.map((definition) => definition.name)).toEqual(['Color', 'Message']);
    expect(schema.definitions[0]?.kind).toBe('ENUM');
    expect(schema.definitions[1]?.kind).toBe('MESSAGE');
    expect(schema.definitions[1]?.fields.map((f) => f.type)).toEqual([
      'uint',
      'string',
      'bool',
      'Color',
      'byte',
      'float',
    ]);
  });

  it('decodes a message end to end', () => {
    const compiled = compileSchema(decodeBinarySchema(buildSchema()));
    const message = compiled.decoders.decodeMessage?.(new KiwiReader(buildMessage())) as {
      count: number;
      name: string;
      flag: boolean;
      colors: string[];
      data: Uint8Array;
      ratio: number;
    };
    expect(message.count).toBe(3);
    expect(message.name).toBe('hi');
    expect(message.flag).toBe(true);
    expect(message.colors).toEqual(['GREEN', 'RED']);
    expect(Array.from(message.data)).toEqual([1, 2, 3]);
    expect(message.ratio).toBeCloseTo(1.5, 6);
  });

  it('round-trips zero and negative floats', () => {
    const compiled = compileSchema(decodeBinarySchema(buildSchema()));
    const w = new Writer();
    w.varuint(6);
    w.varfloat(0);
    w.varuint(0);
    const zero = compiled.decoders.decodeMessage?.(new KiwiReader(w.toBytes())) as { ratio: number };
    expect(zero.ratio).toBe(0);

    const n = new Writer();
    n.varuint(6);
    n.varfloat(-2.25);
    n.varuint(0);
    const negative = compiled.decoders.decodeMessage?.(new KiwiReader(n.toBytes())) as { ratio: number };
    expect(negative.ratio).toBeCloseTo(-2.25, 6);
  });

  it('rejects unknown message fields', () => {
    const compiled = compileSchema(decodeBinarySchema(buildSchema()));
    const w = new Writer();
    w.varuint(99);
    w.varuint(1);
    w.varuint(0);
    expect(() => compiled.decoders.decodeMessage?.(new KiwiReader(w.toBytes()))).toThrow(/unknown field id 99/);
  });

  it('rejects truncated input', () => {
    const compiled = compileSchema(decodeBinarySchema(buildSchema()));
    expect(() => compiled.decoders.decodeMessage?.(new KiwiReader(buildMessage().slice(0, 3)))).toThrow();
  });

  it('rejects an invalid definition kind', () => {
    const w = new Writer();
    w.varuint(1);
    w.string('Bad');
    w.byte(9);
    w.varuint(0);
    expect(() => decodeBinarySchema(w.toBytes())).toThrow(/invalid definition kind/);
  });
});
