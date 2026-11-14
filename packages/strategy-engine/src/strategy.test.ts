import { describe, expect, it } from 'vitest';
import type { Abi, Address } from 'viem';
import { AppError, RiskPolicy } from '@ops/core';
import { compileStrategy, type CompileContext } from './compiler.js';
import { assessRisk, requireSimulation, StubSimulator } from './simulation.js';
import { StrategyStore } from './store.js';

const WALLET = '0x1111111111111111111111111111111111111111' as Address;
const TOKEN = '0x2222222222222222222222222222222222222222' as Address;
const SPENDER = '0x3333333333333333333333333333333333333333' as Address;
const RECIPIENT = '0x4444444444444444444444444444444444444444' as Address;
const VAULT = '0x5555555555555555555555555555555555555555' as Address;

const VAULT_ABI: Abi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
];

function ctx(overrides: Partial<CompileContext> = {}): CompileContext {
  return {
    chainId: 1,
    connectedWallet: WALLET,
    now: 1_760_000_000,
    tokens: new Map([
      [TOKEN.toLowerCase(), { address: TOKEN, chainId: 1, symbol: 'USDC', decimals: 6, usdPrice: '1' }],
    ]),
    contracts: new Map([[`1:${VAULT.toLowerCase()}`, { chainId: 1, address: VAULT, abi: VAULT_ABI }]]),
    nativeUsdPrice: '3000',
    ...overrides,
  };
}

describe('strategy compilation', () => {
  it('compiles an ERC-20 transfer deterministically', () => {
    const strategy = {
      name: 'x',
      chainId: 1,
      steps: [{ id: 't', type: 'token_transfer', token: TOKEN, recipient: RECIPIENT, amount: '1500000' }],
    };
    const a = compileStrategy(strategy, ctx());
    const b = compileStrategy(strategy, ctx());
    expect(a.intentHash).toBe(b.intentHash);
    expect(a.intents[0]!.calls[0]!.data.startsWith('0xa9059cbb')).toBe(true); // transfer selector
    expect(a.totalUsd).toBe('1.50');
  });

  it('flags unlimited approvals', () => {
    const compiled = compileStrategy(
      { name: 'x', chainId: 1, steps: [{ id: 'a', type: 'erc20_approve', token: TOKEN, spender: SPENDER, amount: 'max' }] },
      ctx(),
    );
    expect(compiled.createsUnlimitedApproval).toBe(true);
  });

  it('rejects unknown contract functions', () => {
    expect(() =>
      compileStrategy(
        {
          name: 'x',
          chainId: 1,
          steps: [{ id: 'c', type: 'contract_call', target: VAULT, function: 'withdraw', args: [] }],
        },
        ctx(),
      ),
    ).toThrow(/not present in the imported ABI/);
  });

  it('rejects unresolved token metadata', () => {
    expect(() =>
      compileStrategy(
        { name: 'x', chainId: 1, steps: [{ id: 't', type: 'token_transfer', token: RECIPIENT, recipient: RECIPIENT, amount: '1' }] },
        ctx(),
      ),
    ).toThrow(AppError);
  });

  it('rejects $connectedWallet when no wallet is connected', () => {
    expect(() =>
      compileStrategy(
        {
          name: 'x',
          chainId: 1,
          preconditions: [{ type: 'native_balance', wallet: '$connectedWallet', gte: '1' }],
          steps: [{ id: 't', type: 'token_transfer', token: TOKEN, recipient: RECIPIENT, amount: '1' }],
        },
        ctx({ connectedWallet: undefined }),
      ),
    ).toThrow(/connectedWallet/);
  });

  it('encodes a multicall batch with per-call allowFailure', () => {
    const compiled = compileStrategy(
      {
        name: 'x',
        chainId: 1,
        steps: [
          {
            id: 'batch',
            type: 'multicall',
            calls: [
              { target: VAULT, allowFailure: false, function: 'deposit', args: ['5'] },
              { target: VAULT, allowFailure: true, function: 'deposit', args: ['6'] },
            ],
          },
        ],
      },
      ctx(),
    );
    expect(compiled.intents[0]!.calls).toHaveLength(2);
    expect(compiled.multicallCallCount).toBe(2);
    expect(compiled.intents[0]!.calls[1]!.allowFailure).toBe(true);
  });

  it('assigns a Permit2 deadline from compile time', () => {
    const compiled = compileStrategy(
      {
        name: 'x',
        chainId: 1,
        steps: [
          {
            id: 'p',
            type: 'permit2_signature_transfer',
            token: TOKEN,
            amount: '1000000',
            recipient: RECIPIENT,
            deadlineSeconds: 600,
          },
        ],
      },
      ctx(),
    );
    expect(compiled.intents[0]!.payload!.deadline).toBe(1_760_000_600);
    expect(compiled.intents[0]!.execution).toBe('signature');
  });
});

describe('simulation + risk', () => {
  it('produces a stable simulation hash and passes policy', async () => {
    const compiled = compileStrategy(
      { name: 'x', chainId: 1, steps: [{ id: 't', type: 'token_transfer', token: TOKEN, recipient: RECIPIENT, amount: '1000000' }] },
      ctx(),
    );
    const sim = await new StubSimulator().simulate({
      chainId: 1,
      from: WALLET,
      calls: compiled.intents[0]!.calls,
    });
    const assessment = assessRisk({
      strategy: compiled,
      simulation: sim,
      policy: RiskPolicy.parse({ maxNativeValueUsd: '1000' }),
    });
    expect(assessment.policy.allowed).toBe(true);
    expect(() => requireSimulation(assessment)).not.toThrow();
  });

  it('blocks execution when simulation reverts under fail-closed policy', async () => {
    const compiled = compileStrategy(
      { name: 'x', chainId: 1, steps: [{ id: 't', type: 'token_transfer', token: TOKEN, recipient: RECIPIENT, amount: '1000000' }] },
      ctx(),
    );
    const sim = await new StubSimulator({ forceRevertTargets: [TOKEN] }).simulate({
      chainId: 1,
      from: WALLET,
      calls: compiled.intents[0]!.calls,
    });
    const assessment = assessRisk({ strategy: compiled, simulation: sim, policy: RiskPolicy.parse({}) });
    expect(assessment.riskFlags.some((f) => f.code === 'simulation_revert')).toBe(true);
    expect(() => requireSimulation(assessment)).toThrow(/revert/);
  });

  it('flags untrusted spenders', async () => {
    const compiled = compileStrategy(
      { name: 'x', chainId: 1, steps: [{ id: 'a', type: 'erc20_approve', token: TOKEN, spender: SPENDER, amount: '1000' }] },
      ctx(),
    );
    const sim = await new StubSimulator().simulate({ chainId: 1, from: WALLET, calls: compiled.intents[0]!.calls });
    const assessment = assessRisk({
      strategy: compiled,
      simulation: sim,
      policy: RiskPolicy.parse({}),
      untrustedSpenders: new Set([SPENDER.toLowerCase()]),
    });
    expect(assessment.riskFlags.some((f) => f.code === 'untrusted_spender')).toBe(true);
  });
});

describe('strategy store', () => {
  it('versions strategies immutably', () => {
    const store = new StrategyStore();
    const v1 = store.createStrategy('usr_1', {
      name: 'rebalance',
      chainId: 1,
      steps: [{ id: 't', type: 'token_transfer', token: TOKEN, recipient: RECIPIENT, amount: '1' }],
    });
    const v2 = store.updateStrategy(v1.id, {
      name: 'rebalance',
      chainId: 1,
      steps: [{ id: 't', type: 'token_transfer', token: TOKEN, recipient: RECIPIENT, amount: '2' }],
    });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v1.definition.steps[0]).toMatchObject({ amount: '1' });
    expect(v2.definition.steps[0]).toMatchObject({ amount: '2' });
  });

  it('rejects intent-hash reuse after execution', () => {
    const store = new StrategyStore();
    const run = store.createRun({
      strategyId: 'str_1',
      strategyVersion: 1,
      initiatedBy: 'usr_1',
      walletAddress: WALLET,
      chainId: 1,
      intentHash: '0xabc',
    });
    store.updateRun(run.id, { status: 'completed' });
    expect(() => store.assertIntentHashFresh('0xabc', WALLET, 1)).toThrow(AppError);
    expect(() => store.assertIntentHashFresh('0xdef', WALLET, 1)).not.toThrow();
  });
});
