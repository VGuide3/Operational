# Runbook: audit-chain discontinuity

## Alert

`ops_audit_chain_discontinuity_total > 0`, or the `GET /api/v1/audit-events`
response reports `chain.ok = false`.

## Impact

The append-only audit log failed its hash-link verification. Because the log
underpins repudiation and tamper-evidence guarantees, treat this as a potential
integrity incident until proven otherwise.

## Diagnosis

1. Identify the first event where `event_hash != keccak256(canonical_fields + prev_event_hash)`.
2. Compare `prev_event_hash` against the preceding event's `event_hash`.
3. Check for a partial restore, a schema migration that altered canonical
   fields, or an out-of-band database write.
4. Confirm whether any external anchor (periodic published hash) exists for the
   window in question.

## Remediation

- Do **not** rewrite or delete events. Add a compensating `audit.integrity` event
  documenting the discontinuity.
- If a migration changed canonical serialization, ship a migration that restores
  the canonical form and re-verify from the last known-good anchor.
- If tampering is confirmed, escalate via `incident-response.md`, rotate the
  affected credentials, and re-anchor from the last verified hash.

## Verification

- Re-run the chain verification endpoint until `chain.ok = true`.
- Confirm the discontinuity window is bounded and documented.
