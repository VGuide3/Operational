import { keccak256, sha256, toHex, type Hex } from 'viem';

/**
 * Canonical, deterministic JSON serialization.
 *
 * Keys are sorted recursively so that logically-equal documents hash equally.
 * Used for intent hashes, definition hashes, and audit event hashing.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue;
    out[key] = normalize(v);
  }
  return out;
}

export function sha256Hex(input: string | Uint8Array): Hex {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return sha256(bytes);
}

/** keccak256 of the canonical JSON serialization of a value. */
export function canonicalKeccak256(value: unknown): Hex {
  return keccak256(toHex(canonicalize(value)));
}

/** keccak256 of an arbitrary UTF-8 string. */
export function keccakOfString(input: string): Hex {
  return keccak256(toHex(input));
}

/**
 * Deterministic pseudo-address derived from a hash. Only used for fixtures and
 * documentation examples where a real address is not meaningful.
 */
export function hashToAddress(hash: Hex): Hex {
  return `0x${hash.slice(-40)}` as Hex;
}
