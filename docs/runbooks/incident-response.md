# Runbook: incident response

## Scope

Use for any security incident: suspected key compromise, forged approvals,
unauthorized execution, audit tampering, embed origin abuse, or data exposure.

## Severity

- **SEV1**: confirmed unauthorized execution, key compromise, or audit tampering.
- **SEV2**: attempted attack, forged webhook, or capability misconfiguration.
- **SEV3**: policy/alert anomaly with no confirmed impact.

## Steps

1. **Detect and declare.** Record the alert, time, and affected capability.
2. **Contain.** Pause the affected execution capability (relayer, scanner, embed
   API key) without disabling audit or approval controls.
3. **Preserve evidence.** Export audit events for the window; do not mutate the
   log. Capture request ids, wallet addresses, and signature digests.
4. **Assess.** Determine which invariants (see `docs/threat-model.md`) may have
   been violated.
5. **Eradicate.** Rotate affected credentials (relayer key, Telegram webhook
   secret, embed API keys, session signing key). Revoke delegations and
   consents as needed.
6. **Recover.** Re-enable capabilities with fresh credentials; re-verify the
   audit chain and approval quorum behavior.
7. **Review.** Produce a retrospective with a timeline, root cause, and action
   items. Add regression tests for the failure mode.

## Backups and restore

- Back up PostgreSQL (operational data + partitioned audit tables) and restore
  into a scratch environment at least quarterly.
- Verify restored audit-chain continuity before promoting a restore.

## Contacts

- On-call operator: paged via the standard rotation.
- Security lead: paged for SEV1/SEV2.
