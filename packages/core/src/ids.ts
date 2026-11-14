const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 16 cryptographically-random bytes; works in Node and browsers. */
function randomBytes16(): Uint8Array {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** ULID-compatible monotonic-ish identifier generator (Crockford base32, 26 chars). */
export function ulid(now: number = Date.now()): string {
  let timePart = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[t % 32]! + timePart;
    t = Math.floor(t / 32);
  }
  const random = randomBytes16();
  let randomPart = '';
  for (let i = 0; i < 16; i++) {
    randomPart += CROCKFORD[random[i]! % 32]!;
  }
  return timePart + randomPart;
}

/** Prefixed, sortable identifiers used across the system. */
export const idPrefixes = {
  consent: 'cns',
  user: 'usr',
  strategy: 'str',
  run: 'run',
  job: 'job',
  delegation: 'dlg',
  deployment: 'dep',
  manifest: 'man',
  contract: 'ctr',
  request: 'req',
  event: 'evt',
  approval: 'apr',
  token: 'tok',
  apiKey: 'pk',
} as const;

export type IdKind = keyof typeof idPrefixes;

/** Create an id like `cns_01J...` where the suffix matches the README examples. */
export function newId(kind: IdKind): string {
  return `${idPrefixes[kind]}_${ulid()}`;
}

export function isId(kind: IdKind, value: string): boolean {
  return value.startsWith(`${idPrefixes[kind]}_`) && value.length === idPrefixes[kind].length + 1 + 26;
}

/** Opaque request id for audit correlation. */
export function newRequestId(): string {
  return newId('request');
}
