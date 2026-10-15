/**
 * A wire envelope with the right SHAPE, for relay tests that are about routing,
 * limits or persistence rather than cryptography. The relay checks only the shape
 * (`isEncryptedEnvelope`), so these pass where a real ciphertext would; the
 * decryption round trip is covered by e2e.test.ts with real keys.
 */
export const ENVELOPE = { v: 1, iv: 'A'.repeat(16), ct: 'A'.repeat(32) } as const;

/** An envelope carrying a given ciphertext string (for size and framing tests). */
export function envelopeWith(ct: string) {
  return { v: 1, iv: 'A'.repeat(16), ct } as const;
}
