/**
 * Shared response DTOs for the dashboard.
 *
 * These mirror the server response shapes in `services/api`. Keeping them in
 * one place lets the API client and the presentational components agree on the
 * contract without either importing the other.
 */

export interface BalanceReading {
  token: string;
  symbol: string | null;
  decimals: number | null;
  balance: string;
  indexed: boolean;
  source: string;
  blockNumber: number | null;
  scannedAt: string;
  stale: boolean;
}

export interface SpenderRisk {
  score: number;
  verified: boolean;
  newlyCreated?: boolean;
}

export interface AllowanceReading {
  token: string;
  spender: string;
  allowanceRaw: string;
  allowanceIsMax: boolean;
  source: string;
  spenderRisk?: SpenderRisk;
}

export interface ContractRow {
  id?: string;
  manifestId?: string;
  name: string;
  chainId: number | string;
  address: string;
  status?: string;
}

export interface IntentCall {
  to: string;
  data: string;
  value: string;
}

export interface Intent {
  stepId: string;
  calls: IntentCall[];
}

export interface AuditEvent {
  id: string;
  action: string;
  actorId: string;
  resourceType: string;
  resourceId: string;
  createdAt: string;
}

export interface DelegationScope {
  tokens: string[];
  maxPerTx: string;
  maxDailyUsd: string;
  allowedContracts: string[];
  allowedFunctions: string[];
  blockedRecipients: string[];
}

export interface Delegation {
  delegationId: string;
  grantor: string;
  delegate: string;
  chainId: number;
  scope: DelegationScope;
  validFrom: string;
  validUntil: string;
  signature: string | null;
  status: string;
  revokedAt?: string | null;
  nonce: number;
  dailySpentUsd: string;
  dailyWindowStart: string;
}
