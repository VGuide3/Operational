import { describe, expect, it } from 'vitest';
import { AppError } from '@ops/core';
import { InMemoryRelayer, RelayerService } from './relayer.js';

const RELAYER_ADDR = '0x9999999999999999999999999999999999999999';
const TARGET = '0x2222222222222222222222222222222222222222';

describe('relayer', () => {
  it('submits a transaction and records a receipt', async () => {
    const relayer = new InMemoryRelayer(RELAYER_ADDR);
    const result = await relayer.submit({
      chainId: 1,
      to: TARGET,
      data: '0x',
      value: '0',
      idempotencyKey: 'idem_1',
    });
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const receipt = await relayer.receipt(1, result.txHash);
    expect(receipt?.status).toBe('success');
  });

  it('is idempotent for the same key', async () => {
    const relayer = new InMemoryRelayer(RELAYER_ADDR);
    const a = await relayer.submit({ chainId: 1, to: TARGET, data: '0x', value: '0', idempotencyKey: 'k' });
    const b = await relayer.submit({ chainId: 1, to: TARGET, data: '0x', value: '0', idempotencyKey: 'k' });
    expect(a.txHash).toBe(b.txHash);
  });

  it('refuses value above the policy limit', async () => {
    const relayer = new InMemoryRelayer(RELAYER_ADDR, {
      maxValueWei: '1000',
      maxGasLimit: '100000',
      blockedRecipients: [],
    });
    await expect(
      relayer.submit({ chainId: 1, to: TARGET, data: '0x', value: '1001', idempotencyKey: 'k' }),
    ).rejects.toThrow(AppError);
  });

  it('refuses blocked recipients', async () => {
    const relayer = new InMemoryRelayer(RELAYER_ADDR, {
      maxValueWei: '0',
      maxGasLimit: '100000',
      blockedRecipients: [TARGET],
    });
    await expect(
      relayer.submit({ chainId: 1, to: TARGET, data: '0x', value: '0', idempotencyKey: 'k' }),
    ).rejects.toThrow(/blocked recipient/);
  });

  it('refuses gas above the policy limit', async () => {
    const relayer = new InMemoryRelayer(RELAYER_ADDR, {
      maxValueWei: '0',
      maxGasLimit: '100000',
      blockedRecipients: [],
    });
    await expect(
      relayer.submit({ chainId: 1, to: TARGET, data: '0x', value: '0', gasLimit: '200000', idempotencyKey: 'k' }),
    ).rejects.toThrow(/gas/);
  });

  it('reports balance for depletion alerting', async () => {
    const relayer = new InMemoryRelayer(RELAYER_ADDR, undefined, { balanceWei: 5000n });
    const service = new RelayerService(new Map([[1, relayer]]));
    const check = await service.checkBalance(1, 10_000n);
    expect(check.ok).toBe(false);
    expect(check.balance).toBe(5000n);
  });
});
