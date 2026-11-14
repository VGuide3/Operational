import { canonicalKeccak256, AppError, ErrorCodes, evaluatePolicy, type RiskPolicy } from '@ops/core';
import type { CompiledStrategy, CompiledCall } from './compiler.js';

/**
 * Simulation adapter.
 *
 * Simulation is required before execution of any state-changing action. The
 * adapter is transport-agnostic: a real deployment injects an eth_call-based
 * simulator (Tenderly / anvil / node `eth_call`); tests inject a deterministic
 * stub. The complete batch is simulated, not merely individual calls.
 */

export interface SimulationRequest {
  chainId: number;
  from: string;
  calls: CompiledCall[];
  /** Block tag or number to simulate against. */
  blockNumber?: number;
}

export interface CallResult {
  target: string;
  success: boolean;
  gasUsed?: string;
  returnData?: string;
  revertReason?: string;
}

export interface SimulationResult {
  success: boolean;
  blockNumber: number;
  /** Per-call visibility. */
  calls: CallResult[];
  gasEstimate: string;
  /** Native balance changes attributed to `from`, in wei (decimal string). */
  nativeDelta: string;
  /** Token balance deltas keyed by `${token}:${account}`. */
  tokenDeltas: Record<string, string>;
  /** Whether any call reverted under an allowFailure=false policy. */
  hadRevert: boolean;
  /** Adapter that produced this result. */
  source: string;
  simulatedAt: string;
}

export interface Simulator {
  simulate(req: SimulationRequest): Promise<SimulationResult>;
}

/**
 * Deterministic in-process simulator used for local dev and tests. It executes
 * no EVM; it reports success unless a call is explicitly marked to fail via a
 * well-known revert selector, letting tests exercise failure paths.
 */
export class StubSimulator implements Simulator {
  constructor(private readonly opts: { blockNumber?: number; forceRevertTargets?: string[] } = {}) {}

  async simulate(req: SimulationRequest): Promise<SimulationResult> {
    const forceRevert = new Set((this.opts.forceRevertTargets ?? []).map((t) => t.toLowerCase()));
    const calls: CallResult[] = req.calls.map((c) => {
      const revert = forceRevert.has(c.target.toLowerCase());
      return {
        target: c.target,
        success: !revert,
        gasUsed: revert ? '0' : '45000',
        ...(revert ? { revertReason: 'execution reverted (stub)' } : { returnData: '0x' }),
      };
    });
    const hadRevert = calls.some((c, i) => !c.success && req.calls[i]!.allowFailure === false);
    return {
      success: !hadRevert,
      blockNumber: this.opts.blockNumber ?? 21000000,
      calls,
      gasEstimate: String(calls.reduce((sum, c) => sum + Number(c.gasUsed ?? 0), 21000)),
      nativeDelta: '0',
      tokenDeltas: {},
      hadRevert,
      source: 'stub',
      simulatedAt: new Date().toISOString(),
    };
  }
}

export interface RiskAssessment {
  /** Deterministic hash of the simulation result, bound into the intent. */
  simulationHash: string;
  riskFlags: RiskFlag[];
  /** Policy decision derived from the compiled strategy. */
  policy: ReturnType<typeof evaluatePolicy>;
  /** Total USD exposure, decimal string. */
  totalUsd: string;
}

export interface RiskFlag {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface RiskAssessmentInput {
  strategy: CompiledStrategy;
  simulation: SimulationResult;
  policy: RiskPolicy;
  additionalPolicies?: RiskPolicy[];
  /** Known-risk spender addresses (untrusted / newly created contracts). */
  untrustedSpenders?: Set<string>;
  /** Whether an approval already exists for the run. */
  approvalsSatisfied?: boolean;
}

/**
 * Build a risk assessment from a compiled strategy and its simulation.
 *
 * The assessment is deterministic given its inputs so the simulation hash can
 * be bound into the signed intent.
 */
export function assessRisk(input: RiskAssessmentInput): RiskAssessment {
  const { strategy, simulation, policy } = input;
  const flags: RiskFlag[] = [];

  if (simulation.hadRevert) {
    flags.push({
      code: 'simulation_revert',
      severity: 'critical',
      message: 'one or more calls reverted under a fail-closed policy',
    });
  }
  if (strategy.createsUnlimitedApproval) {
    flags.push({
      code: 'unlimited_approval',
      severity: 'warning',
      message: 'strategy creates an unlimited ERC-20 approval',
    });
  }
  for (const spender of strategy.spenders) {
    if (input.untrustedSpenders?.has(spender.toLowerCase())) {
      flags.push({
        code: 'untrusted_spender',
        severity: 'critical',
        message: `spender ${spender} is untrusted or newly created`,
      });
    }
  }
  if (Number(strategy.totalUsd) >= 10000) {
    flags.push({
      code: 'high_value',
      severity: 'warning',
      message: `run moves ${strategy.totalUsd} USD`,
    });
  }

  const policyDecision = evaluatePolicy({
    policy,
    context: {
      totalUsd: strategy.totalUsd,
      recipients: strategy.recipients,
      spenders: strategy.spenders,
      createsUnlimitedApproval: strategy.createsUnlimitedApproval,
      multicallCallCount: strategy.multicallCallCount,
      simulated: simulation.success,
      approvalsSatisfied: input.approvalsSatisfied,
    },
    ...(input.additionalPolicies ? { additional: input.additionalPolicies } : {}),
  });

  return {
    simulationHash: canonicalKeccak256({
      blockNumber: simulation.blockNumber,
      calls: simulation.calls,
      gasEstimate: simulation.gasEstimate,
    }),
    riskFlags: flags,
    policy: policyDecision,
    totalUsd: strategy.totalUsd,
  };
}

/** Require a successful simulation before a run may be approved/executed. */
export function requireSimulation(assessment: RiskAssessment): void {
  if (assessment.riskFlags.some((f) => f.code === 'simulation_revert')) {
    throw new AppError(
      ErrorCodes.SIMULATION_FAILED,
      'simulation reverted under a fail-closed policy',
      400,
    );
  }
  if (!assessment.policy.allowed) {
    throw new AppError(
      ErrorCodes.POLICY_LIMIT_EXCEEDED,
      `policy evaluation failed: ${assessment.policy.violations.join('; ')}`,
      403,
    );
  }
}
