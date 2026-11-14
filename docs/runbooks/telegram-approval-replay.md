# Runbook: Telegram approval replay or quorum anomaly

## Alert

`ops_approval_replay_total > 0`, `ops_telegram_invalid_secret_total > 0`, or a
quorum anomaly (approvals recorded from fewer distinct approvers than required).

## Impact

An attacker may be attempting to reuse an approval callback, forge a webhook, or
satisfy a quorum with duplicate approvers. If successful, a high-risk backend
job could execute without valid authorization.

## Diagnosis

1. Inspect audit events for `approval.approve` / `approval.reject` around the
   alert window, grouped by `jobId` and `actorId`.
2. Confirm each approval came from a distinct `approverId` and was bound to a
   single-use token.
3. Check `ops_telegram_unknown_approver_total` and
   `ops_telegram_ratelimited_total` for probing patterns.
4. Verify the webhook secret has not leaked and that the secret path was rotated
   on schedule.

## Remediation

- Reject the affected job and require re-request. `assertExecutable` will refuse
  execution while quorum is unmet.
- Rotate the Telegram webhook secret and update the secret token header.
- If approver lockout triggered, review and clear via the dashboard.
- Add compensating audit events documenting the rejected callbacks.

## Verification

- Confirm no job in `queued` state was created from the suspicious callbacks.
- Confirm replay attempts now return `409 approval_replayed`.
