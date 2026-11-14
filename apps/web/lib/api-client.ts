/**
 * Typed API client for the dashboard.
 *
 * Every call goes to /api/v1 and includes the CSRF token from the session.
 * The client never holds backend secrets; the session cookie is httpOnly.
 */

import type {
  AllowanceReading,
  BalanceReading,
  ContractRow,
  Delegation,
  Intent,
} from './types';

export interface ApiError {
  code: string;
  message: string;
  details?: Array<{ path: string; message: string }>;
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
    this.name = 'ApiClientError';
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  /** Called to obtain the current CSRF token for state-changing requests. */
  getCsrfToken?: () => string | undefined;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getCsrfToken?: () => string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api/v1';
    this.getCsrfToken = options.getCsrfToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (method !== 'GET') {
      const token = this.getCsrfToken?.();
      if (token) headers['x-csrf-token'] = token;
    }
    const response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new ApiClientError(response.status, (parsed as { error?: ApiError }).error ?? { code: 'unknown', message: 'request failed' });
    }
    return parsed as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
  del<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  // ---- Typed helpers ----------------------------------------------------
  me() {
    return this.get<{
      user: { id: string };
      wallet: { address: string; chainId: number };
      roles: string[];
      consents?: Array<{ consentId: string; chainId: number; scopes: string[]; expiresAt: string }>;
    }>('me');
  }
  createConsent(body: { chainId: number; termsHash: string; scopes?: string[] }) {
    return this.post<{ consentId: string; scopes: string[]; expiresAt: string }>('consent', body);
  }
  listContracts(query = '') {
    return this.get<{ items: ContractRow[]; nextCursor: string | null }>(`contracts${query}`);
  }
  importContracts(body: unknown) {
    return this.post<{ manifestId: string; status: string }>('contracts/import', body);
  }
  portfolio(chainId: number, address: string) {
    return this.get<{ readings: BalanceReading[]; source: string }>(`portfolio/${chainId}/${address}`);
  }
  scanAllowances(body: { chainId: number; owner: string; tokens: string[]; spenders: string[] }) {
    return this.post<{ readings: AllowanceReading[] }>('allowances/scan', body);
  }
  revokeAllowance(body: { chainId: number; token: string; spender: string; confirm: true }) {
    return this.post<{ strategyId: string; status: string }>('allowances/revoke', body);
  }
  createStrategy(body: unknown) {
    return this.post<{ id: string; version: number }>('strategies', body);
  }
  compileStrategy(id: string) {
    return this.post<{ intentHash: string; intents: Intent[] }>(`strategies/${id}/compile`);
  }
  simulateStrategy(id: string) {
    return this.post<{ runId: string; assessment: { riskFlags: string[] } }>(`strategies/${id}/simulate`);
  }
  executeStrategy(id: string, body: { dryRun?: boolean; idempotencyKey?: string }) {
    return this.post<{ runId: string; status: string; jobId?: string }>(`strategies/${id}/execute`, body);
  }
  approveJob(jobId: string, decision: 'approve' | 'reject' | 'changes' | 'details') {
    return this.post<{ jobId: string; state: string }>(`jobs/${jobId}/approve`, { decision });
  }
  listJobs(state = 'awaiting_approval') {
    return this.get<{
      items: Array<{
        jobId: string;
        runId: string;
        state: string;
        requestedBy: string;
        quorum: number;
        approvals: number;
        expiresAt: string;
      }>;
      nextCursor: string | null;
    }>(`jobs?state=${encodeURIComponent(state)}`);
  }
  create2(body: unknown) {
    return this.post<{ predictedAddress: string; artifactHash: string }>('deployments/create2', body);
  }
  auditEvents(query = '') {
    return this.get<{ items: unknown[]; chain: { ok: boolean } }>(`audit-events${query}`);
  }
  listDelegations(chainId?: number) {
    return this.get<{ items: Delegation[] }>(`delegations${chainId ? `?chainId=${chainId}` : ''}`);
  }
  createDelegation(body: {
    delegate: string;
    chainId: number;
    scope: Record<string, unknown>;
    validFrom: string;
    validUntil: string;
  }) {
    return this.post<{ delegation: Delegation; signingPayload: unknown }>('delegations', body);
  }
  revokeDelegation(id: string) {
    return this.post<{ delegationId: string; status: string }>(`delegations/${id}/revoke`);
  }
  deployment(id: string) {
    return this.get<{ id: string; status: string; predictedAddress: string; deployedAddress?: string }>(`deployments/${id}`);
  }
}
