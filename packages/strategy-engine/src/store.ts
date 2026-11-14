import { AppError, ErrorCodes, canonicalKeccak256, newId } from '@ops/core';
import { Strategy } from './schema.js';
import type { CompiledStrategy } from './compiler.js';
import type { RiskAssessment, SimulationResult } from './simulation.js';

/**
 * Strategy + run store.
 *
 * Strategies are immutable versions: editing creates a new version, never a
 * mutation. Runs capture the intent hash and simulation that was reviewed so a
 * later tamper is detectable.
 */

export type StrategyStatus = 'draft' | 'compiled' | 'simulated' | 'approved' | 'archived';

export interface StrategyRecord {
  id: string;
  ownerId: string;
  name: string;
  version: number;
  chainId: number;
  definition: Strategy;
  definitionHash: string;
  status: StrategyStatus;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus =
  | 'created'
  | 'simulated'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'reverted'
  | 'expired';

export interface StrategyRun {
  id: string;
  strategyId: string;
  strategyVersion: number;
  initiatedBy: string;
  walletAddress: string;
  chainId: number;
  intentHash: string;
  status: RunStatus;
  compiled?: CompiledStrategy;
  simulation?: SimulationResult;
  riskAssessment?: RiskAssessment;
  createdAt: string;
  completedAt?: string;
}

export class StrategyStore {
  private strategies = new Map<string, StrategyRecord>();
  /** `${ownerId}:${name}` -> latest version number. */
  private latestVersion = new Map<string, number>();
  private runs = new Map<string, StrategyRun>();

  createStrategy(ownerId: string, input: unknown): StrategyRecord {
    const definition = Strategy.parse(input);
    const key = `${ownerId}:${definition.name}`;
    const version = (this.latestVersion.get(key) ?? 0) + 1;
    const record: StrategyRecord = {
      id: newId('strategy'),
      ownerId,
      name: definition.name,
      version,
      chainId: definition.chainId,
      definition: { ...definition, version },
      definitionHash: canonicalKeccak256(definition),
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.latestVersion.set(key, version);
    this.strategies.set(record.id, record);
    return record;
  }

  /** Editing always produces a new immutable version. */
  updateStrategy(id: string, input: unknown): StrategyRecord {
    const prior = this.strategies.get(id);
    if (!prior) throw new AppError(ErrorCodes.NOT_FOUND, `strategy ${id} not found`, 404);
    return this.createStrategy(prior.ownerId, input);
  }

  getStrategy(id: string): StrategyRecord | undefined {
    return this.strategies.get(id);
  }

  listStrategies(ownerId?: string, cursor?: string, limit = 50): { items: StrategyRecord[]; nextCursor: string | null } {
    let items = [...this.strategies.values()];
    if (ownerId) items = items.filter((s) => s.ownerId === ownerId);
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const startIndex = cursor ? items.findIndex((s) => s.id === cursor) + 1 : 0;
    const slice = items.slice(startIndex, startIndex + limit);
    const last = slice[slice.length - 1];
    return { items: slice, nextCursor: last && startIndex + limit < items.length ? last.id : null };
  }

  setStatus(id: string, status: StrategyStatus): void {
    const record = this.strategies.get(id);
    if (!record) throw new AppError(ErrorCodes.NOT_FOUND, `strategy ${id} not found`, 404);
    record.status = status;
    record.updatedAt = new Date().toISOString();
  }

  createRun(input: {
    strategyId: string;
    strategyVersion: number;
    initiatedBy: string;
    walletAddress: string;
    chainId: number;
    intentHash: string;
  }): StrategyRun {
    const run: StrategyRun = {
      id: newId('run'),
      ...input,
      status: 'created',
      createdAt: new Date().toISOString(),
    };
    this.runs.set(run.id, run);
    return run;
  }

  getRun(id: string): StrategyRun | undefined {
    return this.runs.get(id);
  }

  updateRun(id: string, patch: Partial<StrategyRun>): StrategyRun {
    const run = this.runs.get(id);
    if (!run) throw new AppError(ErrorCodes.NOT_FOUND, `run ${id} not found`, 404);
    Object.assign(run, patch);
    return run;
  }

  /**
   * Guard against intent-hash reuse: a run may only be executed once per
   * (intentHash, wallet, chain) tuple.
   */
  assertIntentHashFresh(intentHash: string, walletAddress: string, chainId: number): void {
    for (const run of this.runs.values()) {
      if (
        run.intentHash === intentHash &&
        run.walletAddress.toLowerCase() === walletAddress.toLowerCase() &&
        run.chainId === chainId &&
        ['executing', 'completed'].includes(run.status)
      ) {
        throw new AppError(
          ErrorCodes.INTENT_HASH_REUSED,
          'this intent has already been executed',
          409,
        );
      }
    }
  }
}
