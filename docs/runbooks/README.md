# Runbooks

Operational procedures for the dashboard. Each runbook states the alert, the
impact, the diagnostic steps, and the remediation. Keep these current whenever a
privileged capability changes.

| Runbook | Trigger |
| --- | --- |
| [audit-chain-discontinuity.md](./audit-chain-discontinuity.md) | `ops_audit_chain_discontinuity_total` > 0 |
| [telegram-approval-replay.md](./telegram-approval-replay.md) | `ops_approval_replay_total` > 0 or quorum anomaly |
| [relayer-balance-depletion.md](./relayer-balance-depletion.md) | Relayer native balance below threshold |
| [scanner-staleness.md](./scanner-staleness.md) | Scan freshness beyond threshold |
| [create2-address-mismatch.md](./create2-address-mismatch.md) | Deployed bytecode hash does not match expected |
| [incident-response.md](./incident-response.md) | Any security incident |

## General principles

- The audit log is append-only. Never delete or rewrite events during an
  incident; add compensating events.
- Prefer pausing the affected capability (relayer, scanner, embed key) over
  disabling audit or approval controls.
- Record every action taken with timestamps, actor, and request ids.
