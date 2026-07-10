import 'react-native-get-random-values';
import { sha256 } from 'js-sha256';
import { v4 as uuidv4 } from 'uuid';

/** Replaces expo-crypto. */

export function randomUUID(): string {
  return uuidv4();
}

/** Hex-encoded SHA-256 of a UTF-8 string (idempotency keys — not security-critical). */
export function sha256Hex(input: string): string {
  return sha256(input);
}
