import { describe, expect, it } from 'vitest';
import { canonicalize, canonicalKeccak256 } from './hashing.js';
import { isId, newId, ulid } from './ids.js';
import { assertNotSelfApproval, hasPermission, requirePermission } from './rbac.js';
import { AppError, ErrorCodes } from './errors.js';
import { evaluatePolicy, RiskPolicy } from './policy.js';

describe('ids', () => {
  it('creates prefixed, correctly sized ids', () => {
    const id = newId('consent');
    expect(id.startsWith('cns_')).toBe(true);
    expect(isId('consent', id)).toBe(true);
    expect(isId('user', id)).toBe(false);
  });

  it('generates sortable ulids', () => {
    const a = ulid(1000);
    const b = ulid(2000);
    expect(a < b).toBe(true);
    expect(a).toHaveLength(26);
  });
});

describe('canonical hashing', () => {
  it('is insensitive to key order', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalKeccak256({ b: 1, a: 2 })).toBe(canonicalKeccak256({ a: 2, b: 1 }));
  });

  it('drops undefined values', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('rbac', () => {
  it('grants permissions from roles', () => {
    expect(hasPermission(['viewer'], 'read:portfolio')).toBe(true);
    expect(hasPermission(['viewer'], 'execute:job')).toBe(false);
  });

  it('throws forbidden when permission missing', () => {
    expect(() => requirePermission(['viewer'], 'execute:job')).toThrow(AppError);
  });

  it('forbids self approval', () => {
    expect(() => assertNotSelfApproval('usr_1', 'usr_1')).toThrow(AppError);
    expect(() => assertNotSelfApproval('usr_1', 'usr_2')).not.toThrow();
  });
});

describe('policy engine', () => {
  it('blocks native value above limit', () => {
    const policy = RiskPolicy.parse({ maxNativeValueUsd: '100' });
    const decision = evaluatePolicy({
      policy,
      context: { nativeValueUsd: '101', recipients: [], simulated: true },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.violations[0]).toContain('exceeds limit');
  });

  it('requires simulation', () => {
    const decision = evaluatePolicy({
      policy: RiskPolicy.parse({}),
      context: { recipients: [], simulated: false },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.requiresSimulation).toBe(true);
  });

  it('blocks unlimited approval when disallowed', () => {
    const decision = evaluatePolicy({
      policy: RiskPolicy.parse({}),
      context: { recipients: [], createsUnlimitedApproval: true, simulated: true },
    });
    expect(decision.allowed).toBe(false);
  });

  it('flags telegram approval requirement', () => {
    const decision = evaluatePolicy({
      policy: RiskPolicy.parse({ requireTelegramApproval: true }),
      context: { recipients: [], simulated: true, approvalsSatisfied: false },
    });
    expect(decision.requiresTelegramApproval).toBe(true);
    expect(decision.allowed).toBe(false);
  });

  it('allows a compliant run', () => {
    const decision = evaluatePolicy({
      policy: RiskPolicy.parse({ maxNativeValueUsd: '1000' }),
      context: { nativeValueUsd: '10', recipients: ['0xabc'], simulated: true },
    });
    expect(decision.allowed).toBe(true);
    expect(decision.violations).toHaveLength(0);
  });
});

describe('errors', () => {
  it('serializes to a machine-readable envelope', () => {
    const e = new AppError(ErrorCodes.FORBIDDEN, 'nope', 403);
    expect(e.toJSON()).toEqual({ error: { code: 'forbidden', message: 'nope' } });
  });
});
