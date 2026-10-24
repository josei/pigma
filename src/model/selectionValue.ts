/**
 * Whether several selected layers hold different values for one property, so a field should read "Mixed" rather than
 * the first layer's value. Values compare with `===`, which is right for the numbers and strings a field shows.
 */
export function isMixedValue<T>(values: readonly T[]): boolean {
  return values.some((value) => value !== values[0]);
}
