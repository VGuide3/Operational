import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { AppError } from '@ops/core';
import {
  buildDomain,
  delegationTypedData,
  describeTypedPayload,
  strategyIntentTypedData,
  toBytes32,
  typedDataDigest,
  verifyTypedSignature,
} from './index.js';

const account = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const executor = '0x00000000000000000000000000000000000000e0' as const;

describe('eip712', () => {
  it('builds a canonical domain', () => {
    const d = buildDomain(1, executor);
    expect(d.name).toBe('Web3 Operations Dashboard');
    expect(d.chainId).toBe(1);
  });

  it('hashes deterministically and verifies a real signature', async () => {
    const domain = buildDomain(1, executor);
    const payload = strategyIntentTypedData(domain, {
      strategyId: toBytes32('str_1'),
      version: 3,
      chainId: 1,
      executor,
      intentHash: toBytes32('intent'),
      nonce: 1,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    const digest = typedDataDigest(payload);
    const signature = await account.signTypedData({
      domain: payload.domain,
      primaryType: payload.primaryType,
      types: payload.types,
      message: payload.message,
    } as Parameters<typeof account.signTypedData>[0]);

    const result = await verifyTypedSignature({
      payload,
      signature,
      expectedAddress: account.address,
      expectedChainId: 1,
    });
    expect(result.valid).toBe(true);
    expect(result.digest).toBe(digest);
    expect(result.recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it('rejects a mismatched chain domain', async () => {
    const domain = buildDomain(10, executor);
    const payload = delegationTypedData(domain, {
      delegationId: toBytes32('dlg'),
      grantor: account.address,
      delegate: account.address,
      chainId: 10,
      scopeHash: toBytes32('scope'),
      validFrom: 0,
      validUntil: 9999999999,
      nonce: 1,
    });
    await expect(
      verifyTypedSignature({
        payload,
        signature: ('0x' + '00'.repeat(65)) as `0x${string}`,
        expectedAddress: account.address,
        expectedChainId: 1,
      }),
    ).rejects.toThrow(AppError);
  });

  it('rejects an expired message', async () => {
    const domain = buildDomain(1, executor);
    const payload = strategyIntentTypedData(domain, {
      strategyId: toBytes32('str'),
      version: 1,
      chainId: 1,
      executor,
      intentHash: toBytes32('i'),
      nonce: 0,
      expiresAt: 1000,
    });
    await expect(
      verifyTypedSignature({
        payload,
        signature: ('0x' + '00'.repeat(65)) as `0x${string}`,
        expectedAddress: account.address,
        expectedChainId: 1,
        now: 2000,
      }),
    ).rejects.toThrow(/expired/);
  });

  it('describes a payload for human review', () => {
    const payload = strategyIntentTypedData(buildDomain(1, executor), {
      strategyId: toBytes32('str'),
      version: 1,
      chainId: 1,
      executor,
      intentHash: toBytes32('i'),
      nonce: 0,
      expiresAt: 5,
    });
    expect(describeTypedPayload(payload)).toContain('StrategyIntent');
  });
});
