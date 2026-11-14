# Runbook: relayer balance depletion

## Alert

Relayer native-token balance below the configured threshold on any production
chain.

## Impact

Queued jobs that require backend submission will stall or fail. Read paths are
unaffected. Do not bypass approval controls to "catch up" — approvals are
independent of relayer health.

## Diagnosis

1. Check relayer balance per chain and recent gas consumption.
2. Inspect the worker dead-letter queue for submission failures and their
   `error` field.
3. Confirm the relayer key has not been rotated or compromised (compare against
   expected key id in the KMS/HSM).

## Remediation

- Top up the relayer account from the treasury with an audited transfer.
- If a key compromise is suspected, rotate the key, update the relayer
  configuration, and re-verify the new address is the only signer.
- Drain and re-queue affected jobs after confirming policy and approvals remain
  intact.

## Verification

- Confirm a test job submits and its receipt is recorded.
- Confirm relayer balance alert clears.
