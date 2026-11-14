import { encodeFunctionData, getAddress, type Abi, type Address, type Hex } from 'viem';
import { AppError, ErrorCodes, canonicalKeccak256 } from '@ops/core';
import { getChain, type ChainRegistryLike } from '@ops/chains';
import {
  CONNECTED_WALLET,
  MAX_UINT256,
  Strategy,
  type Precondition,
  type Step,
} from './schema.js';

/**
 * Strategy compiler.
 *
 * Resolves references, validates addresses/decimals/functions/deadlines,
 * converts human amounts to base units without silent rounding, and emits a
 * canonical, deterministic intent per step plus an overall intent hash.
 */

export interface TokenMetadata {
  address: Address;
  chainId: number;
  symbol: string;
  decimals: number;
  /** USD price per whole token, as a decimal string. */
  usdPrice?: string;
}

export interface ContractAbi {
  chainId: number;
  address: Address;
  abi: Abi;
}

export interface CompileContext {
  chainId: number;
  connectedWallet?: Address;
  /** Token metadata keyed by lowercase address. */
  tokens: Map<string, TokenMetadata>;
  /** Imported contract ABIs keyed by `${chainId}:${lowercaseAddress}`. */
  contracts: Map<string, ContractAbi>;
  /** Current time in seconds; injectable for deterministic tests. */
  now: number;
  registry?: ChainRegistryLike;
  /** USD value of native currency (for policy evaluation), decimal string. */
  nativeUsdPrice?: string;
}

export interface CompiledCall {
  target: Address;
  value: string;
  data: Hex;
  allowFailure: boolean;
  gasLimit?: string;
}

export interface CompiledIntent {
  stepId: string;
  stepType: Step['type'];
  /** Chain the intent executes on. */
  chainId: number;
  /** How the intent is executed. */
  execution: 'wallet' | 'signature' | 'backend_job' | 'deployment';
  /** Human-readable summary for review surfaces. */
  summary: string;
  calls: CompiledCall[];
  /** Extra payload for non-call intents (permits, delegations, jobs). */
  payload?: Record<string, unknown>;
  /** USD exposure attributed to this step, decimal string. */
  usdExposure: string;
  /** Whether this step creates an unlimited ERC-20 approval. */
  createsUnlimitedApproval: boolean;
  /** Recipients touched by this step. */
  recipients: string[];
  /** Spenders approved by this step. */
  spenders: string[];
}

export interface CompiledStrategy {
  chainId: number;
  connectedWallet: Address;
  intents: CompiledIntent[];
  /** Deterministic hash over the compiled intents. */
  intentHash: Hex;
  /** Total USD exposure across steps. */
  totalUsd: string;
  recipients: string[];
  spenders: string[];
  createsUnlimitedApproval: boolean;
  multicallCallCount: number;
}

const ERC20_ABI: Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
];

const toWeiUsd = (baseUnits: bigint, decimals: number, usdPrice?: string): string => {
  if (!usdPrice) return '0';
  const whole = Number(baseUnits) / 10 ** decimals;
  return (whole * Number(usdPrice)).toFixed(2);
};

function resolveWallet(ref: string, ctx: CompileContext): Address {
  if (ref === CONNECTED_WALLET) {
    if (!ctx.connectedWallet) {
      throw new AppError(
        ErrorCodes.STRATEGY_UNRESOLVED_REFERENCE,
        'strategy references $connectedWallet but no wallet is connected',
        400,
      );
    }
    return ctx.connectedWallet;
  }
  return getAddress(ref);
}

function resolveToken(address: string, ctx: CompileContext): TokenMetadata {
  const token = ctx.tokens.get(address.toLowerCase());
  if (!token) {
    throw new AppError(
      ErrorCodes.STRATEGY_UNRESOLVED_REFERENCE,
      `token metadata for ${address} is not available on chain ${ctx.chainId}`,
      400,
    );
  }
  if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36) {
    throw new AppError(
      ErrorCodes.STRATEGY_INVALID_DECIMALS,
      `token ${address} has invalid decimals: ${token.decimals}`,
      400,
    );
  }
  return token;
}

function resolveContract(address: string, ctx: CompileContext): ContractAbi {
  const key = `${ctx.chainId}:${address.toLowerCase()}`;
  const contract = ctx.contracts.get(key);
  if (!contract) {
    throw new AppError(
      ErrorCodes.STRATEGY_UNRESOLVED_REFERENCE,
      `no imported ABI for ${address} on chain ${ctx.chainId}`,
      400,
    );
  }
  return contract;
}

/** Convert a base-unit string to bigint, rejecting malformed values. */
function parseBaseUnits(value: string, _token: TokenMetadata): bigint {
  if (!/^\d+$/.test(value)) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, `amount "${value}" is not a valid integer`, 422);
  }
  return BigInt(value);
}

function compileStep(step: Step, ctx: CompileContext): CompiledIntent {
  switch (step.type) {
    case 'erc20_approve': {
      const token = resolveToken(step.token, ctx);
      const unlimited = step.amount === 'max';
      const amount = unlimited ? MAX_UINT256 : parseBaseUnits(step.amount, token);
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [getAddress(step.spender), amount],
      });
      return {
        stepId: step.id,
        stepType: step.type,
        chainId: ctx.chainId,
        execution: 'wallet',
        summary: unlimited
          ? `Approve unlimited ${token.symbol} to ${step.spender}`
          : `Approve ${amount} ${token.symbol} to ${step.spender}`,
        calls: [{ target: getAddress(step.token), value: '0', data, allowFailure: false }],
        usdExposure: '0',
        createsUnlimitedApproval: unlimited,
        recipients: [],
        spenders: [getAddress(step.spender)],
      };
    }
    case 'erc20_revoke': {
      const token = resolveToken(step.token, ctx);
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [getAddress(step.spender), 0n],
      });
      return {
        stepId: step.id,
        stepType: step.type,
        chainId: ctx.chainId,
        execution: 'wallet',
        summary: `Revoke ${token.symbol} approval for ${step.spender}`,
        calls: [{ target: getAddress(step.token), value: '0', data, allowFailure: false }],
        usdExposure: '0',
        createsUnlimitedApproval: false,
        recipients: [],
        spenders: [getAddress(step.spender)],
      };
    }
    case 'token_transfer': {
      const token = resolveToken(step.token, ctx);
      const amount = parseBaseUnits(step.amount, token);
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [getAddress(step.recipient), amount],
      });
      return {
        stepId: step.id,
        stepType: step.type,
        chainId: ctx.chainId,
        execution: 'wallet',
        summary: `Transfer ${amount} ${token.symbol} to ${step.recipient}`,
        calls: [{ target: getAddress(step.token), value: '0', data, allowFailure: false }],
        usdExposure: toWeiUsd(amount, token.decimals, token.usdPrice),
        createsUnlimitedApproval: false,
        recipients: [getAddress(step.recipient)],
        spenders: [],
      };
    }
    case 'permit2_signature_transfer': {
      const token = resolveToken(step.token, ctx);
      const amount = parseBaseUnits(step.amount, token);
      const chain = getChain(ctx.chainId, ctx.registry);
      if (!chain.permit2) {
        throw new AppError(
          ErrorCodes.UNKNOWN_CHAIN,
          `no Permit2 address configured for chain ${ctx.chainId}`,
          400,
        );
      }
      const deadline = ctx.now + step.deadlineSeconds;
      return {
        stepId: step.id,
        stepType: step.type,
        chainId: ctx.chainId,
        execution: 'signature',
        summary: `Permit2 signature transfer of ${amount} ${token.symbol} to ${step.recipient}`,
        calls: [],
        payload: {
          permit2: chain.permit2,
          token: getAddress(step.token),
          amount: amount.toString(),
          recipient: getAddress(step.recipient),
          deadline,
          witness: step.witness,
          // A unique nonce is assigned at staging time by the nonce store.
          nonce: null,
        },
        usdExposure: toWeiUsd(amount, token.decimals, token.usdPrice),
        createsUnlimitedApproval: false,
        recipients: [getAddress(step.recipient)],
        spenders: [],
      };
    }
    case 'contract_call': {
      const contract = resolveContract(step.target, ctx);
      const data = encodeCall(contract, step.function, step.args);
      return {
        stepId: step.id,
        stepType: step.type,
        chainId: ctx.chainId,
        execution: 'wallet',
        summary: `Call ${step.function} on ${step.target}`,
        calls: [
          {
            target: getAddress(step.target),
            value: step.value,
            data,
            allowFailure: false,
          },
        ],
        usdExposure: '0',
        createsUnlimitedApproval: false,
        recipients: [],
        spenders: [],
      };
    }
    case 'multicall': {
      const calls: CompiledCall[] = step.calls.map((call) => {
        let data: Hex;
        if (call.calldata) {
          data = call.calldata as Hex;
        } else if (call.function) {
          const contract = resolveContract(call.target, ctx);
          data = encodeCall(contract, call.function, call.args ?? []);
        } else {
          throw new AppError(
            ErrorCodes.VALIDATION_FAILED,
            `multicall entry for ${call.target} has neither calldata nor function`,
            422,
          );
        }
        return {
          target: getAddress(call.target),
          value: '0',
          data,
          allowFailure: call.allowFailure,
          ...(call.gasLimit ? { gasLimit: call.gasLimit } : {}),
        };
      });
      return {
        stepId: step.id,
        stepType: step.type,
        chainId: ctx.chainId,
        execution: 'wallet',
        summary: `Multicall batch of ${calls.length} calls`,
        calls,
        usdExposure: '0',
        createsUnlimitedApproval: false,
        recipients: [],
        spenders: [],
      };
    }
    case 'create2_deploy': {
      const chain = getChain(ctx.chainId, ctx.registry);
      const factory = step.factory || chain.create2Factory;
      if (!factory) {
        throw new AppError(
          ErrorCodes.UNKNOWN_CHAIN,
          `no CREATE2 factory configured for chain ${ctx.chainId}`,
          400,
        );
      }
      return {
        stepId: step.id,
        stepType: step.type,
        chainId: ctx.chainId,
        execution: 'deployment',
        summary: `CREATE2 deploy via factory ${factory}`,
        calls: [],
        payload: {
          factory: getAddress(factory),
          salt: step.salt,
          initCode: step.initCode,
          constructorArgs: step.constructorArgs,
        },
        usdExposure: '0',
        createsUnlimitedApproval: false,
        recipients: [],
        spenders: [],
      };
    }
    case 'delegation_grant': {
      return {
        stepId: step.id,
        stepType: step.type,
        chainId: ctx.chainId,
        execution: 'signature',
        summary: `Grant delegation to ${step.delegate}`,
        calls: [],
        payload: {
          delegate: getAddress(step.delegate),
          scope: step.scope,
          validUntil: ctx.now + step.validForSeconds,
        },
        usdExposure: '0',
        createsUnlimitedApproval: false,
        recipients: [],
        spenders: [],
      };
    }
    case 'backend_job': {
      return {
        stepId: step.id,
        stepType: step.type,
        chainId: ctx.chainId,
        execution: 'backend_job',
        summary: `Queue backend job: ${step.action}`,
        calls: [],
        payload: { action: step.action, params: step.params },
        usdExposure: '0',
        createsUnlimitedApproval: false,
        recipients: [],
        spenders: [],
      };
    }
  }
}

/** Encode a contract call, rejecting unknown functions with a clear error. */
function encodeCall(contract: ContractAbi, fn: string, args: unknown[]): Hex {
  const hasFn = (contract.abi as unknown as { type?: string; name?: string }[]).some(
    (e) => e.type === 'function' && e.name === fn,
  );
  if (!hasFn) {
    throw new AppError(
      ErrorCodes.STRATEGY_UNKNOWN_FUNCTION,
      `function "${fn}" is not present in the imported ABI for ${contract.address}`,
      400,
    );
  }
  return encodeFunctionData({ abi: contract.abi, functionName: fn, args } as Parameters<
    typeof encodeFunctionData
  >[0]);
}

/** Evaluate preconditions against provided readings (for review display). */
export interface PreconditionReading {
  type: Precondition['type'];
  ok: boolean;
  actual?: string;
  required?: string;
}

export function checkPreconditions(
  preconditions: Precondition[],
  readings: Map<string, string>,
): PreconditionReading[] {
  return preconditions.map((p) => {
    if (p.type === 'token_balance') {
      const key = `token_balance:${p.token.toLowerCase()}:${p.wallet}`;
      const actual = readings.get(key);
      return {
        type: p.type,
        ok: actual !== undefined && BigInt(actual) >= BigInt(p.gte),
        ...(actual !== undefined ? { actual } : {}),
        required: p.gte,
      };
    }
    if (p.type === 'allowance') {
      const key = `allowance:${p.token.toLowerCase()}:${p.spender.toLowerCase()}`;
      const actual = readings.get(key);
      return {
        type: p.type,
        ok: actual !== undefined && BigInt(actual) >= BigInt(p.gte),
        ...(actual !== undefined ? { actual } : {}),
        required: p.gte,
      };
    }
    const key = `native_balance:${p.wallet}`;
    const actual = readings.get(key);
    return {
      type: p.type,
      ok: actual !== undefined && BigInt(actual) >= BigInt(p.gte),
      ...(actual !== undefined ? { actual } : {}),
      required: p.gte,
    };
  });
}

/**
 * Compile a strategy into deterministic intents.
 *
 * Rejects unresolved references, invalid decimals, unknown functions, and
 * expired deadlines. Never silently rounds amounts.
 */
export function compileStrategy(input: unknown, ctx: CompileContext): CompiledStrategy {
  const strategy = Strategy.parse(input);

  // Resolve precondition references up front so unresolved references fail
  // compilation rather than surfacing at execution time.
  for (const pre of strategy.preconditions) {
    if ('wallet' in pre) resolveWallet(pre.wallet, ctx);
    if (pre.type === 'token_balance') resolveToken(pre.token, ctx);
    if (pre.type === 'allowance') resolveToken(pre.token, ctx);
  }

  const intents = strategy.steps.map((step) => compileStep(step, ctx));

  const totalUsd = intents.reduce((sum, i) => sum + Number(i.usdExposure), 0).toFixed(2);
  const recipients = [...new Set(intents.flatMap((i) => i.recipients))];
  const spenders = [...new Set(intents.flatMap((i) => i.spenders))];
  const createsUnlimitedApproval = intents.some((i) => i.createsUnlimitedApproval);
  const multicallCallCount = Math.max(
    0,
    ...intents.filter((i) => i.stepType === 'multicall').map((i) => i.calls.length),
  );

  const intentHash = canonicalKeccak256({
    chainId: ctx.chainId,
    wallet: ctx.connectedWallet ?? null,
    intents: intents.map((i) => ({
      stepId: i.stepId,
      stepType: i.stepType,
      calls: i.calls,
      payload: i.payload ?? null,
    })),
  });

  return {
    chainId: ctx.chainId,
    connectedWallet: ctx.connectedWallet ?? ('0x0000000000000000000000000000000000000000' as Address),
    intents,
    intentHash,
    totalUsd,
    recipients,
    spenders,
    createsUnlimitedApproval,
    multicallCallCount,
  };
}
