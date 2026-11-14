'use client';

import * as React from 'react';
import { useApiClient } from '../../../app/providers';
import { ApprovalQueue, type PendingJob } from '../../../components/approvals/ApprovalQueue';

/**
 * Dashboard (fallback) approval surface.
 *
 * High-risk backend jobs require a quorum-satisfying approval delivered either
 * through Telegram or, as a non-weakening fallback, through this dual-control
 * workflow. The server enforces quorum, self-approval prevention, expiry, and
 * single-use tokens; this page only issues the decision.
 */
export default function ApprovalsPage() {
  const api = useApiClient();
  const [jobs, setJobs] = React.useState<PendingJob[]>([]);
  const [jobId, setJobId] = React.useState('');
  const [state, setState] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await api.listJobs('awaiting_approval');
      setJobs(res.items as PendingJob[]);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const decide = React.useCallback(
    async (id: string, decision: 'approve' | 'reject') => {
      if (!id) return;
      setBusy(true);
      setError(null);
      try {
        const res = await api.approveJob(id, decision);
        setState(res.state);
        await load();
      } catch (e) {
        setError((e as Error).message);
        setState(null);
      } finally {
        setBusy(false);
      }
    },
    [api, load],
  );

  return React.createElement(
    'section',
    null,
    React.createElement('h2', null, 'Approvals'),
    React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement('p', { className: 'ops-fresh' }, 'Dual control: a requester may not approve their own job.'),
      React.createElement('label', { htmlFor: 'jobId' }, 'Job ID'),
      React.createElement('input', {
        id: 'jobId',
        value: jobId,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setJobId(e.target.value),
        style: { width: '100%', marginBottom: 8 },
      }),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 8 } },
        React.createElement(
          'button',
          { className: 'ops-primary', onClick: () => void decide(jobId, 'approve'), disabled: !jobId || busy },
          'Approve',
        ),
        React.createElement('button', { onClick: () => void decide(jobId, 'reject'), disabled: !jobId || busy }, 'Reject'),
      ),
      error ? React.createElement('p', { role: 'alert', className: 'ops-danger' }, error) : null,
      state ? React.createElement('p', { className: 'ops-ok' }, `Job state: ${state}`) : null,
    ),
    React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement('h3', null, 'Awaiting approval'),
      React.createElement(ApprovalQueue, { jobs, onDecide: decide, busy }),
    ),
  );
}
