'use client';

import * as React from 'react';

export interface PendingJob {
  jobId: string;
  runId: string;
  state: string;
  requestedBy: string;
  quorum: number;
  approvals: number;
  expiresAt: string;
  riskFlags?: string[];
}

/**
 * Dual-control approval queue.
 *
 * A requester may not approve their own job. The server enforces quorum,
 * expiry, self-approval prevention, and single-use tokens; this component only
 * issues the decision and renders server state.
 */
export function ApprovalQueue({
  jobs,
  onDecide,
  busy,
}: {
  jobs: PendingJob[];
  onDecide: (jobId: string, decision: 'approve' | 'reject') => void;
  busy?: boolean;
}) {
  return React.createElement(
    'table',
    null,
    React.createElement(
      'thead',
      null,
      React.createElement(
        'tr',
        null,
        React.createElement('th', null, 'Job'),
        React.createElement('th', null, 'Run'),
        React.createElement('th', null, 'Requested by'),
        React.createElement('th', null, 'Approvals'),
        React.createElement('th', null, 'Expires'),
        React.createElement('th', null, ''),
      ),
    ),
    React.createElement(
      'tbody',
      null,
      jobs.length === 0
        ? React.createElement('tr', null, React.createElement('td', { colSpan: 6 }, 'No jobs awaiting approval.'))
        : jobs.map((j) =>
            React.createElement(
              'tr',
              { key: j.jobId },
              React.createElement('td', null, j.jobId),
              React.createElement('td', null, j.runId),
              React.createElement('td', null, j.requestedBy),
              React.createElement(
                'td',
                null,
                React.createElement('span', { className: j.approvals >= j.quorum ? 'ops-ok' : 'ops-badge' }, `${j.approvals}/${j.quorum}`),
              ),
              React.createElement('td', null, j.expiresAt),
              React.createElement(
                'td',
                null,
                React.createElement(
                  'div',
                  { style: { display: 'flex', gap: 8 } },
                  React.createElement(
                    'button',
                    { className: 'ops-primary', disabled: busy, onClick: () => onDecide(j.jobId, 'approve') },
                    'Approve',
                  ),
                  React.createElement('button', { disabled: busy, onClick: () => onDecide(j.jobId, 'reject') }, 'Reject'),
                ),
              ),
            ),
          ),
    ),
  );
}
