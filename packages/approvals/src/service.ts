import { randomBytes } from 'node:crypto';
import { AppError, ErrorCodes, canonicalKeccak256, newId } from '@ops/core';

/**
 * Approval lifecycle + quorum engine.
 *
 * awaiting_approval -> (approve*) -> queued | rejected | expired
 *
 * Guarantees:
 *  - a job cannot execute without a valid, unexpired, quorum-satisfying approval
 *  - a replayed callback is rejected (single-use tokens)
 *  - expiry automatically cancels the job
 *  - self-approval is prevented
 */

export type JobState =
  | 'awaiting_approval'
  | 'queued'
  | 'rejected'
  | 'expired'
  | 'executing'
  | 'completed'
  | 'failed';

export type Decision = 'approve' | 'reject' | 'changes' | 'details';

export interface ApprovalToken {
  token: string;
  jobId: string;
  decision: Decision;
  expiresAt: string;
  used: boolean;
}

export interface ApprovalRecord {
  approverId: string;
  decision: Decision;
  at: string;
  ipHash?: string;
  userAgentHash?: string;
}

export interface ApprovalJob {
  id: string;
  runId: string;
  jobHash: string;
  state: JobState;
  requestedBy: string;
  /** Number of distinct approvers required. */
  quorum: number;
  /** Approvers bound to this job (from Telegram identity mapping). */
  eligibleApprovers: string[];
  approvals: ApprovalRecord[];
  rejections: ApprovalRecord[];
  createdAt: string;
  expiresAt: string;
  /** Single-use tokens keyed by token string. */
  tokens: Map<string, ApprovalToken>;
  /** Callback ids already processed, to reject replays. */
  processedCallbackIds: Set<string>;
}

export interface CreateJobInput {
  runId: string;
  jobHash: string;
  requestedBy: string;
  quorum?: number;
  eligibleApprovers: string[];
  ttlSeconds?: number;
}

export class ApprovalService {
  private jobs = new Map<string, ApprovalJob>();
  /** Lockout counter per approver for repeated invalid callbacks. */
  private invalidAttempts = new Map<string, number>();
  private readonly maxInvalidAttempts: number;

  constructor(opts: { maxInvalidAttempts?: number } = {}) {
    this.maxInvalidAttempts = opts.maxInvalidAttempts ?? 10;
  }

  createJob(input: CreateJobInput): ApprovalJob {
    const now = Date.now();
    const job: ApprovalJob = {
      id: newId('job'),
      runId: input.runId,
      jobHash: input.jobHash,
      state: 'awaiting_approval',
      requestedBy: input.requestedBy,
      quorum: input.quorum ?? 1,
      eligibleApprovers: input.eligibleApprovers,
      approvals: [],
      rejections: [],
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (input.ttlSeconds ?? 900) * 1000).toISOString(),
      tokens: new Map(),
      processedCallbackIds: new Set(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  getJob(id: string): ApprovalJob | undefined {
    return this.jobs.get(id);
  }

  /** Issue a single-use, short-lived token bound to a job + decision. */
  issueToken(jobId: string, decision: Decision, ttlSeconds = 900): ApprovalToken {
    const job = this.jobs.get(jobId);
    if (!job) throw new AppError(ErrorCodes.NOT_FOUND, `job ${jobId} not found`, 404);
    const token: ApprovalToken = {
      token: randomBytes(24).toString('base64url'),
      jobId,
      decision,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      used: false,
    };
    job.tokens.set(token.token, token);
    return token;
  }

  /**
   * Record a decision delivered via a Telegram callback.
   *
   * Enforces: token validity + single-use, expiry, callback-id replay
   * protection, approver eligibility, and self-approval prevention.
   */
  recordDecision(input: {
    jobId: string;
    token: string;
    decision: Decision;
    approverId: string;
    callbackId: string;
    now?: number;
    ipHash?: string;
    userAgentHash?: string;
  }): ApprovalJob {
    const now = input.now ?? Date.now();
    const job = this.jobs.get(input.jobId);
    if (!job) throw new AppError(ErrorCodes.NOT_FOUND, `job ${input.jobId} not found`, 404);

    if (job.processedCallbackIds.has(input.callbackId)) {
      throw new AppError(ErrorCodes.APPROVAL_REPLAYED, 'this callback has already been processed', 409);
    }

    this.expireIfNeeded(job, now);
    if (job.state === 'expired') {
      throw new AppError(ErrorCodes.APPROVAL_EXPIRED, 'approval request has expired', 410);
    }

    const token = job.tokens.get(input.token);
    if (!token) {
      this.noteInvalid(input.approverId);
      throw new AppError(ErrorCodes.SIGNATURE_INVALID, 'approval token is not valid', 400);
    }
    if (token.used) {
      throw new AppError(ErrorCodes.APPROVAL_REPLAYED, 'approval token has already been used', 409);
    }
    if (new Date(token.expiresAt).getTime() <= now) {
      throw new AppError(ErrorCodes.APPROVAL_EXPIRED, 'approval token has expired', 410);
    }
    if (token.decision !== input.decision) {
      throw new AppError(ErrorCodes.SIGNATURE_INVALID, 'token decision does not match callback', 400);
    }
    if (!job.eligibleApprovers.includes(input.approverId)) {
      this.noteInvalid(input.approverId);
      throw new AppError(ErrorCodes.FORBIDDEN, 'approver is not authorized for this job', 403);
    }
    if (input.approverId === job.requestedBy) {
      throw new AppError(ErrorCodes.SELF_APPROVAL_FORBIDDEN, 'the requester may not approve their own job', 403);
    }

    // Consume the token and callback id atomically.
    token.used = true;
    job.processedCallbackIds.add(input.callbackId);

    const record: ApprovalRecord = {
      approverId: input.approverId,
      decision: input.decision,
      at: new Date(now).toISOString(),
      ...(input.ipHash ? { ipHash: input.ipHash } : {}),
      ...(input.userAgentHash ? { userAgentHash: input.userAgentHash } : {}),
    };

    if (input.decision === 'reject') {
      job.rejections.push(record);
      job.state = 'rejected';
      return job;
    }
    if (input.decision === 'changes' || input.decision === 'details') {
      // Informational: does not change state.
      return job;
    }

    // approve
    const alreadyApproved = job.approvals.some((a) => a.approverId === input.approverId);
    if (!alreadyApproved) job.approvals.push(record);

    if (job.approvals.length >= job.quorum) {
      job.state = 'queued';
    }
    return job;
  }

  /** Dashboard (fallback) approval path — same guarantees, no Telegram. */
  recordDashboardApproval(input: {
    jobId: string;
    approverId: string;
    decision: Decision;
    now?: number;
  }): ApprovalJob {
    const now = input.now ?? Date.now();
    const job = this.jobs.get(input.jobId);
    if (!job) throw new AppError(ErrorCodes.NOT_FOUND, `job ${input.jobId} not found`, 404);
    this.expireIfNeeded(job, now);
    if (job.state === 'expired') {
      throw new AppError(ErrorCodes.APPROVAL_EXPIRED, 'approval request has expired', 410);
    }
    if (!job.eligibleApprovers.includes(input.approverId)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'approver is not authorized for this job', 403);
    }
    if (input.approverId === job.requestedBy) {
      throw new AppError(ErrorCodes.SELF_APPROVAL_FORBIDDEN, 'the requester may not approve their own job', 403);
    }
    const record: ApprovalRecord = { approverId: input.approverId, decision: input.decision, at: new Date(now).toISOString() };
    if (input.decision === 'reject') {
      job.rejections.push(record);
      job.state = 'rejected';
    } else if (input.decision === 'approve') {
      if (!job.approvals.some((a) => a.approverId === input.approverId)) job.approvals.push(record);
      if (job.approvals.length >= job.quorum) job.state = 'queued';
    }
    return job;
  }

  /** Assert a job is cleared to execute. */
  assertExecutable(jobId: string, now = Date.now()): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new AppError(ErrorCodes.NOT_FOUND, `job ${jobId} not found`, 404);
    this.expireIfNeeded(job, now);
    if (job.state === 'expired') {
      throw new AppError(ErrorCodes.APPROVAL_EXPIRED, 'approval request expired', 410);
    }
    if (job.state === 'rejected') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'job was rejected', 403);
    }
    if (job.approvals.length < job.quorum) {
      throw new AppError(
        ErrorCodes.QUORUM_NOT_MET,
        `quorum not met: ${job.approvals.length}/${job.quorum} approvals`,
        403,
      );
    }
    if (job.state !== 'queued' && job.state !== 'executing') {
      throw new AppError(ErrorCodes.APPROVAL_REQUIRED, `job is not cleared to execute (state: ${job.state})`, 403);
    }
  }

  /** List jobs, optionally filtered by state (for the approval queue UI). */
  listJobs(filter: { state?: JobState } = {}): ApprovalJob[] {
    const items = [...this.jobs.values()];
    return filter.state ? items.filter((j) => j.state === filter.state) : items;
  }

  /** Sweep for expired jobs (called by the worker scheduler). */
  sweep(now = Date.now()): string[] {
    const expired: string[] = [];
    for (const job of this.jobs.values()) {
      if (this.expireIfNeeded(job, now)) expired.push(job.id);
    }
    return expired;
  }

  private expireIfNeeded(job: ApprovalJob, now: number): boolean {
    if (job.state === 'awaiting_approval' && new Date(job.expiresAt).getTime() <= now) {
      job.state = 'expired';
      return true;
    }
    return false;
  }

  private noteInvalid(approverId: string): void {
    const count = (this.invalidAttempts.get(approverId) ?? 0) + 1;
    this.invalidAttempts.set(approverId, count);
    if (count >= this.maxInvalidAttempts) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'approver locked out after repeated invalid callbacks', 403);
    }
  }

  /** Job hash used for audit binding and Telegram display. */
  static jobHash(input: { runId: string; jobId: string; payload: unknown }): string {
    return canonicalKeccak256(input);
  }
}
