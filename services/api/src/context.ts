import { AuditLog } from '@ops/audit';
import { ApprovalService } from '@ops/approvals';
import { ContractStore, DeploymentStore } from '@ops/contracts';
import { DelegationStore, StrategyStore } from '@ops/strategy-engine';
import { NonceStore } from '@ops/permit2';
import { MetricsRegistry } from '@ops/telemetry';
import { AuthService } from './session.js';

/**
 * Application container. Route handlers depend on this rather than on concrete
 * singletons, so tests can build an isolated instance per case.
 */
export interface AppContext {
  auth: AuthService;
  audit: AuditLog;
  contracts: ContractStore;
  deployments: DeploymentStore;
  strategies: StrategyStore;
  delegations: DelegationStore;
  approvals: ApprovalService;
  nonces: NonceStore;
  metrics: MetricsRegistry;
  /** Active consent records keyed by consentId. */
  consents: Map<string, import('@ops/ui').ConsentPayload>;
  /** Idempotency results keyed by `${route}:${key}`. */
  idempotency: Map<string, { status: number; body: unknown }>;
  /** Persisted runs keyed by runId (mirrors StrategyStore runs). */
  now: () => number;
}

export interface CreateContextOptions {
  domain?: string;
  now?: () => number;
}

export function createAppContext(options: CreateContextOptions = {}): AppContext {
  const now = options.now ?? (() => Date.now());
  return {
    auth: new AuthService(options.domain ?? 'ops.example.com'),
    audit: new AuditLog(),
    contracts: new ContractStore(),
    deployments: new DeploymentStore(),
    strategies: new StrategyStore(),
    delegations: new DelegationStore(),
    approvals: new ApprovalService(),
    nonces: new NonceStore(),
    metrics: new MetricsRegistry(),
    consents: new Map(),
    idempotency: new Map(),
    now,
  };
}
