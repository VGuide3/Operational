import { AppError, ErrorCodes } from '@ops/core';
import { ApprovalService } from '@ops/approvals';

/**
 * Job worker.
 *
 * Backend jobs may only execute after policy evaluation, simulation, and any
 * required approvals. Failures retry with backoff and land in a dead-letter
 * queue after the attempt limit; a dead-lettered job never executes.
 */

export type JobType =
  | 'permit2_executor_transfer'
  | 'multicall_execute'
  | 'create2_deploy'
  | 'delegation_revoke'
  | 'scanner_refresh'
  | 'notification_send';

export type JobStatus =
  | 'awaiting_approval'
  | 'queued'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'dead_letter'
  | 'rejected'
  | 'expired';

export interface JobRecord {
  id: string;
  runId: string;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  requiresTelegramApproval: boolean;
  approvalJobId?: string;
  scheduledAt?: string;
  executedAt?: string;
  result?: Record<string, unknown>;
  error?: string;
  idempotencyKey: string;
  createdAt: string;
}

export type JobHandler = (job: JobRecord) => Promise<Record<string, unknown>>;

export interface WorkerOptions {
  approvals?: ApprovalService;
  handlers: Partial<Record<JobType, JobHandler>>;
  maxAttempts?: number;
  /** Backoff schedule in ms per attempt. */
  backoffMs?: number[];
  onDeadLetter?: (job: JobRecord) => void;
}

export class JobWorker {
  private jobs = new Map<string, JobRecord>();
  private byIdempotency = new Map<string, string>();
  private deadLetters: JobRecord[] = [];
  private readonly approvals?: ApprovalService;
  private readonly handlers: Partial<Record<JobType, JobHandler>>;
  private readonly maxAttempts: number;
  private readonly backoffMs: number[];
  private readonly onDeadLetter?: (job: JobRecord) => void;

  constructor(options: WorkerOptions) {
    this.approvals = options.approvals;
    this.handlers = options.handlers;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.backoffMs = options.backoffMs ?? [1000, 5000, 15000];
    if (options.onDeadLetter) this.onDeadLetter = options.onDeadLetter;
  }

  enqueue(input: {
    runId: string;
    type: JobType;
    payload: Record<string, unknown>;
    requiresTelegramApproval?: boolean;
    idempotencyKey: string;
    approvalJobId?: string;
  }): JobRecord {
    const existingId = this.byIdempotency.get(input.idempotencyKey);
    if (existingId) return this.jobs.get(existingId)!;

    const requiresApproval = input.requiresTelegramApproval ?? false;
    const job: JobRecord = {
      id: `job_${(this.jobs.size + 1).toString().padStart(6, '0')}`,
      runId: input.runId,
      type: input.type,
      payload: input.payload,
      status: requiresApproval ? 'awaiting_approval' : 'queued',
      attempts: 0,
      maxAttempts: this.maxAttempts,
      requiresTelegramApproval: requiresApproval,
      ...(input.approvalJobId ? { approvalJobId: input.approvalJobId } : {}),
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    this.byIdempotency.set(input.idempotencyKey, job.id);
    return job;
  }

  getJob(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  listDeadLetters(): readonly JobRecord[] {
    return this.deadLetters;
  }

  /**
   * Run a job. Refuses to execute while approval is outstanding. Retries on
   * failure, then dead-letters.
   */
  async run(jobId: string, now = Date.now()): Promise<JobRecord> {
    const job = this.jobs.get(jobId);
    if (!job) throw new AppError(ErrorCodes.NOT_FOUND, `job ${jobId} not found`, 404);

    if (job.status === 'completed' || job.status === 'dead_letter' || job.status === 'rejected' || job.status === 'expired') {
      return job;
    }

    if (job.requiresTelegramApproval) {
      if (!this.approvals || !job.approvalJobId) {
        throw new AppError(ErrorCodes.APPROVAL_REQUIRED, 'job requires approval but no approval record exists', 403);
      }
      this.approvals.assertExecutable(job.approvalJobId, now);
      job.status = 'queued';
    }

    const handler = this.handlers[job.type];
    if (!handler) {
      job.status = 'dead_letter';
      job.error = `no handler registered for job type ${job.type}`;
      this.deadLetters.push(job);
      this.onDeadLetter?.(job);
      return job;
    }

    job.status = 'executing';
    job.attempts += 1;
    try {
      job.result = await handler(job);
      job.status = 'completed';
      job.executedAt = new Date().toISOString();
    } catch (e) {
      job.error = (e as Error).message;
      if (job.attempts >= job.maxAttempts) {
        job.status = 'dead_letter';
        this.deadLetters.push(job);
        this.onDeadLetter?.(job);
      } else {
        job.status = 'failed';
        job.scheduledAt = new Date(now + (this.backoffMs[job.attempts - 1] ?? 15000)).toISOString();
      }
    }
    return job;
  }

  /** Retry all failed jobs whose backoff has elapsed. */
  async retryDue(now = Date.now()): Promise<JobRecord[]> {
    const retried: JobRecord[] = [];
    for (const job of this.jobs.values()) {
      if (job.status === 'failed' && job.scheduledAt && new Date(job.scheduledAt).getTime() <= now) {
        retried.push(await this.run(job.id, now));
      }
    }
    return retried;
  }
}
