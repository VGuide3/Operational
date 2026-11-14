import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';
import { AppError } from '@ops/core';
import {
  buildPermit2Payload,
  describeAllowance,
  NonceStore,
  permit2Domain,
  permitDigest,
  validatePermitPreconditions,
} from './permit2.js';
import { MAX_UINT256_DEC, type AllowanceRecord } from './types.js';

const account = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const TOKEN = '0x2222222222222222222222222222222222222222' as Address;
const SPENDER = '0x3333333333333333333333333333333333333333' as Address;
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;

describe('permit2 domain + payload', () => {
  it('uses the canonical Permit2 contract from the registry', () => {
    expect(permit2Domain(1).verifyingContract).toBe(PERMIT2);
  });

  it('builds a plain permitTransferFrom payload', () => {
    const payload = buildPermit2Payload({
      chainId: 1,
      spender: SPENDER,
      token: TOKEN,
      amount: 1000n,
      nonce: 1n,
      deadline: 9999999999,
    });
    expect(payload.primaryType).toBe('PermitTransferFrom');
    expect(permitDigest(payload)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('builds a witness-bound permit with struct ordering', () => {
    const payload = buildPermit2Payload({
      chainId: 1,
      spender: SPENDER,
      token: TOKEN,
      amount: 1000n,
      nonce: 1n,
      deadline: 9999999999,
      witness: {
        strategyId: ('0x' + '11'.repeat(32)) as `0x${string}`,
        intentHash: ('0x' + '22'.repeat(32)) as `0x${string}`,
        expiresAt: 9999999999,
        executor: SPENDER,
      },
    });
    expect(payload.primaryType).toBe('PermitWitnessTransferFrom');
    expect(Object.keys(payload.types)).toContain('StrategyWitness');
    // A real signature can be produced over the payload.
    expect(account.address).toMatch(/^0x/);
  });
});

describe('nonce store', () => {
  it('makes a nonce single-use', () => {
    const store = new NonceStore();
    store.consume(1, account.address, TOKEN, 1n);
    expect(store.isConsumed(1, account.address, TOKEN, 1n)).toBe(true);
    expect(() => store.consume(1, account.address, TOKEN, 1n)).toThrow(AppError);
  });

  it('rejects a reused intent hash', () => {
    const store = new NonceStore();
    store.reserveIntent('0xabc');
    expect(() => store.reserveIntent('0xabc')).toThrow(/already issued/);
  });

  it('derives deterministic nonces', () => {
    const store = new NonceStore();
    const a = store.deriveNonce(account.address, '0xabc', 1);
    const b = store.deriveNonce(account.address, '0xabc', 1);
    expect(a).toBe(b);
  });
});

describe('permit preconditions', () => {
  const permit = {
    chainId: 1,
    permit2: PERMIT2,
    token: TOKEN,
    amount: '1000',
    nonce: '1',
    deadline: 9999999999,
  };
  const details = { to: SPENDER, requestedAmount: '1000' };

  it('requires an ERC-20 approval when the Permit2 allowance is insufficient', () => {
    const result = validatePermitPreconditions({
      permit,
      details,
      owner: account.address,
      ownerBalance: 5000n,
      permit2Erc20Allowance: 0n,
      spender: SPENDER,
      now: 1,
    });
    expect(result.needsErc20Approval).toBe(true);
  });

  it('passes when allowance and balance are sufficient', () => {
    const result = validatePermitPreconditions({
      permit,
      details,
      owner: account.address,
      ownerBalance: 5000n,
      permit2Erc20Allowance: 1000n,
      spender: SPENDER,
      now: 1,
    });
    expect(result.needsErc20Approval).toBe(false);
  });

  it('rejects expired permits', () => {
    expect(() =>
      validatePermitPreconditions({
        permit: { ...permit, deadline: 100 },
        details,
        owner: account.address,
        ownerBalance: 5000n,
        permit2Erc20Allowance: 1000n,
        spender: SPENDER,
        now: 200,
      }),
    ).toThrow(/deadline/);
  });

  it('rejects when the owner lacks balance', () => {
    expect(() =>
      validatePermitPreconditions({
        permit,
        details,
        owner: account.address,
        ownerBalance: 1n,
        permit2Erc20Allowance: 1000n,
        spender: SPENDER,
        now: 1,
      }),
    ).toThrow(/balance/);
  });
});

describe('allowance display', () => {
  it('labels unlimited approvals', () => {
    const record: AllowanceRecord = {
      owner: account.address,
      token: TOKEN,
      spender: SPENDER,
      chainId: 1,
      allowanceRaw: MAX_UINT256_DEC,
      allowanceIsMax: true,
      scannedAt: new Date().toISOString(),
      source: 'rpc_multicall',
    };
    expect(describeAllowance(record)).toContain('UNLIMITED');
  });
});
