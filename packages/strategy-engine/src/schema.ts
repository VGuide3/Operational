import { z } from 'zod';
import { RiskPolicy } from '@ops/core';

/**
 * Strategy schema.
 *
 * A strategy is a declarative, versioned execution plan. It compiles into one
 * or more transaction intents, must be simulated before approval, and supports
 * dry-run execution. See README "Strategy engine".
 */

export const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 20-byte hex address');
export const HexData = z.string().regex(/^0x[0-9a-fA-F]*$/, 'expected hex data');
export const UintString = z.string().regex(/^\d+$/, 'expected a non-negative integer string');

/** A reference resolved at proposal time (e.g. the connected wallet). */
export const CONNECTED_WALLET = '$connectedWallet';
export const WalletRef = z.union([Address, z.literal(CONNECTED_WALLET)]);

export const Precondition = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('token_balance'),
    token: Address,
    wallet: WalletRef,
    gte: UintString,
  }),
  z.object({
    type: z.literal('allowance'),
    token: Address,
    spender: Address,
    gte: UintString,
  }),
  z.object({
    type: z.literal('native_balance'),
    wallet: WalletRef,
    gte: UintString,
  }),
]);
export type Precondition = z.infer<typeof Precondition>;

export const StepBase = z.object({
  id: z.string().min(1).max(64),
  /** Optional human label shown in review surfaces. */
  label: z.string().optional(),
});

export const Erc20ApproveStep = StepBase.extend({
  type: z.literal('erc20_approve'),
  token: Address,
  spender: Address,
  /** Base-unit amount, or "max" for an unlimited approval. */
  amount: z.union([UintString, z.literal('max')]),
});
export const Erc20RevokeStep = StepBase.extend({
  type: z.literal('erc20_revoke'),
  token: Address,
  spender: Address,
});
export const TokenTransferStep = StepBase.extend({
  type: z.literal('token_transfer'),
  token: Address,
  recipient: Address,
  amount: UintString,
});
export const Permit2SignatureTransferStep = StepBase.extend({
  type: z.literal('permit2_signature_transfer'),
  token: Address,
  amount: UintString,
  recipient: Address,
  deadlineSeconds: z.number().int().positive().max(3600 * 24 * 30),
  /** When true, bind the permit to the strategy intent via a witness. */
  witness: z.boolean().default(false),
});
export const ContractCallStep = StepBase.extend({
  type: z.literal('contract_call'),
  /** Contract key from the imported contract registry, or a raw address. */
  target: Address,
  /** Function name; resolved against the imported ABI. */
  function: z.string().min(1),
  args: z.array(z.unknown()).default([]),
  /** Native value to send, in wei. */
  value: UintString.default('0'),
});
export const MulticallStep = StepBase.extend({
  type: z.literal('multicall'),
  calls: z
    .array(
      z.object({
        target: Address,
        allowFailure: z.boolean().default(false),
        /** ABI-encoded calldata or a {function,args} descriptor. */
        calldata: HexData.optional(),
        function: z.string().optional(),
        args: z.array(z.unknown()).optional(),
        /** Per-call gas cap. */
        gasLimit: UintString.optional(),
      }),
    )
    .min(1),
});
export const Create2DeployStep = StepBase.extend({
  type: z.literal('create2_deploy'),
  factory: Address,
  salt: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  /** Hex-encoded initialization code. */
  initCode: HexData,
  constructorArgs: z.array(z.unknown()).default([]),
});
export const DelegationGrantStep = StepBase.extend({
  type: z.literal('delegation_grant'),
  delegate: Address,
  scope: z.record(z.unknown()),
  validForSeconds: z.number().int().positive(),
});
export const BackendJobStep = StepBase.extend({
  type: z.literal('backend_job'),
  action: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});

export const Step = z.discriminatedUnion('type', [
  Erc20ApproveStep,
  Erc20RevokeStep,
  TokenTransferStep,
  Permit2SignatureTransferStep,
  ContractCallStep,
  MulticallStep,
  Create2DeployStep,
  DelegationGrantStep,
  BackendJobStep,
]);
export type Step = z.infer<typeof Step>;
export type StepType = Step['type'];

export const Trigger = z.object({
  type: z.enum(['manual', 'scheduled', 'event']).default('manual'),
  allowedRoles: z.array(z.string()).default([]),
  /** Cron expression for scheduled triggers. */
  schedule: z.string().optional(),
});

export const Strategy = z.object({
  strategyId: z.string().optional(),
  name: z.string().min(1).max(120),
  version: z.number().int().nonnegative().default(0),
  chainId: z.number().int().positive(),
  owner: z.string().optional(),
  trigger: Trigger.default({ type: 'manual', allowedRoles: [] }),
  preconditions: z.array(Precondition).default([]),
  steps: z.array(Step).min(1),
  riskPolicy: RiskPolicy.default({}),
});
export type Strategy = z.infer<typeof Strategy>;

/** Actions table from the README: execution model + approval requirement. */
export const ACTION_METADATA: Record<
  StepType,
  { executionModel: string; approval: string; stateChanging: boolean }
> = {
  erc20_approve: {
    executionModel: 'Direct wallet transaction',
    approval: 'Explicit user confirmation',
    stateChanging: true,
  },
  erc20_revoke: {
    executionModel: 'Direct wallet transaction',
    approval: 'Explicit user confirmation',
    stateChanging: true,
  },
  token_transfer: {
    executionModel: 'Direct wallet transaction',
    approval: 'Explicit user confirmation',
    stateChanging: true,
  },
  permit2_signature_transfer: {
    executionModel: 'EIP-712 signature plus executor transaction',
    approval: 'Explicit signature and policy check',
    stateChanging: true,
  },
  contract_call: {
    executionModel: 'ABI-encoded call',
    approval: 'Decoded calldata review',
    stateChanging: true,
  },
  multicall: {
    executionModel: 'Batched calls in one transaction',
    approval: 'Per-call decoded review',
    stateChanging: true,
  },
  create2_deploy: {
    executionModel: 'Deterministic deployment transaction',
    approval: 'Deployment review and address verification',
    stateChanging: true,
  },
  delegation_grant: {
    executionModel: 'Smart-account or session-key delegation',
    approval: 'Policy-specific approval',
    stateChanging: true,
  },
  backend_job: {
    executionModel: 'Queued privileged server action',
    approval: 'Telegram approval where required',
    stateChanging: true,
  },
};

export const MAX_UINT256 = (1n << 256n) - 1n;
