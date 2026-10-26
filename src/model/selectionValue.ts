/**
 * Whether several selected layers hold different values for one property, so a field should read "Mixed" rather than
 * the first layer's value. Values compare with `===`, which is right for the numbers and strings a field shows.
 */
export function isMixedValue<T>(values: readonly T[]): boolean {
  return values.some((value) => value !== values[0]);
}

/**
 * A stable text key for a structured value (an effect list, say): object keys are sorted at every level, so two equal
 * values made in different orders compare equal. Arrays keep their order, which is part of what they mean.
 */
export function canonicalKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalKey).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalKey((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
