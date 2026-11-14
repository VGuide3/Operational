import { z } from 'zod';

/**
 * Policy engine.
 *
 * Every privileged action is evaluated against a compiled policy on the server
 * before it may be simulated, queued, or executed. The client never decides
 * whether an action is permitted.
 */

export const DecimalString = z
  .string()
  .regex(/^\d+$/, 'expected a non-negative integer encoded as a decimal string');

export const UsdAmount = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'expected a non-negative decimal USD amount');

export const RiskPolicy = z.object({
  /** Maximum native-token value a single run may move, in USD. */
  maxNativeValueUsd: UsdAmount.default('0'),
  /** Maximum total USD exposure per run across all steps. */
  maxTotalUsd: UsdAmount.optional(),
  requireTelegramApproval: z.boolean().default(false),
  requireSimulation: z.boolean().default(true),
  /** Recipients that are never permitted, regardless of value. */
  blockedRecipients: z.array(z.string()).default([]),
  /** Only these recipients may receive funds when non-empty. */
  allowedRecipients: z.array(z.string()).default([]),
  /** Spenders that are never permitted for approvals. */
  blockedSpenders: z.array(z.string()).default([]),
  /** Disallow creating unlimited approvals without a separate consent step. */
  disallowUnlimitedApproval: z.boolean().default(true),
  /** Maximum number of calls in a multicall batch. */
  maxMulticallCalls: z.number().int().positive().default(20),
});
export type RiskPolicy = z.infer<typeof RiskPolicy>;

export const PolicyLimits = z.object({
  perUser: RiskPolicy,
  perStrategy: RiskPolicy,
  perToken: RiskPolicy.optional(),
  perRecipient: RiskPolicy.optional(),
  perChain: RiskPolicy.optional(),
});
export type PolicyLimits = z.infer<typeof PolicyLimits>;

export interface PolicyContext {
  /** USD value of native currency moved by the run. */
  nativeValueUsd?: string;
  /** Total USD exposure of the run. */
  totalUsd?: string;
  recipients: string[];
  spenders?: string[];
  /** Whether any step would set an unlimited ERC-20 approval. */
  createsUnlimitedApproval?: boolean;
  /** Number of calls in the largest multicall batch. */
  multicallCallCount?: number;
  /** Whether a successful simulation is attached to the run. */
  simulated?: boolean;
  /** Whether at least one valid approval exists for the run. */
  approvalsSatisfied?: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  /** Reasons the run is blocked, empty when allowed. */
  violations: string[];
  /** Whether out-of-band (Telegram) approval is required before execution. */
  requiresTelegramApproval: boolean;
  /** Whether a fresh simulation must precede execution. */
  requiresSimulation: boolean;
}

export interface PolicyEvaluationInput {
  policy: RiskPolicy;
  context: PolicyContext;
  /** Additional limits applied by higher scopes (user, token, chain). */
  additional?: RiskPolicy[];
}

const compareUsd = (a: string, b: string): number => Number(a) - Number(b);

function normalizeAddr(a: string): string {
  return a.toLowerCase();
}

/** Evaluate a single policy against a context, appending violations. */
function evaluateOne(policy: RiskPolicy, context: PolicyContext, violations: string[]): void {
  if (context.nativeValueUsd !== undefined) {
    if (compareUsd(context.nativeValueUsd, policy.maxNativeValueUsd) > 0) {
      violations.push(
        `native value ${context.nativeValueUsd} USD exceeds limit ${policy.maxNativeValueUsd} USD`,
      );
    }
  }
  if (policy.maxTotalUsd !== undefined && context.totalUsd !== undefined) {
    if (compareUsd(context.totalUsd, policy.maxTotalUsd) > 0) {
      violations.push(`total value ${context.totalUsd} USD exceeds limit ${policy.maxTotalUsd} USD`);
    }
  }

  const blocked = new Set(policy.blockedRecipients.map(normalizeAddr));
  for (const r of context.recipients) {
    if (blocked.has(normalizeAddr(r))) {
      violations.push(`recipient ${r} is blocked by policy`);
    }
  }
  if (policy.allowedRecipients.length > 0) {
    const allowed = new Set(policy.allowedRecipients.map(normalizeAddr));
    for (const r of context.recipients) {
      if (!allowed.has(normalizeAddr(r))) {
        violations.push(`recipient ${r} is not on the allowlist`);
      }
    }
  }

  if (context.spenders) {
    const blockedSpenders = new Set(policy.blockedSpenders.map(normalizeAddr));
    for (const s of context.spenders) {
      if (blockedSpenders.has(normalizeAddr(s))) {
        violations.push(`spender ${s} is blocked by policy`);
      }
    }
  }

  if (policy.disallowUnlimitedApproval && context.createsUnlimitedApproval) {
    violations.push('unlimited approval is disallowed without a separate consent step');
  }

  if (context.multicallCallCount !== undefined && context.multicallCallCount > policy.maxMulticallCalls) {
    violations.push(
      `multicall batch of ${context.multicallCallCount} calls exceeds limit ${policy.maxMulticallCalls}`,
    );
  }
}

/** Evaluate all applicable policies and return a decision. */
export function evaluatePolicy(input: PolicyEvaluationInput): PolicyDecision {
  const policies = [input.policy, ...(input.additional ?? [])];
  const violations: string[] = [];
  for (const p of policies) evaluateOne(p, input.context, violations);

  const requiresSimulation = policies.some((p) => p.requireSimulation);
  if (requiresSimulation && input.context.simulated === false) {
    violations.push('a successful simulation is required before execution');
  }

  const requiresTelegramApproval = policies.some((p) => p.requireTelegramApproval);
  if (requiresTelegramApproval && input.context.approvalsSatisfied === false) {
    violations.push('out-of-band approval is required before execution');
  }

  return {
    allowed: violations.length === 0,
    violations,
    requiresTelegramApproval,
    requiresSimulation,
  };
}

/** Default conservative policy used when a strategy omits riskPolicy. */
export const defaultRiskPolicy: RiskPolicy = RiskPolicy.parse({});
