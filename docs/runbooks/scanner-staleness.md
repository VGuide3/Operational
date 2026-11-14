# Runbook: scanner staleness

## Alert

Scanner data freshness beyond threshold (portfolio or allowance results older
than the configured window).

## Impact

Operators may act on stale balances or allowances. The UI labels stale data, but
stale data must not silently be treated as current.

## Diagnosis

1. Check RPC provider health and rate-limit responses.
2. Inspect indexer lag and partial-failure handling. "Not indexed" must be
   distinguished from "zero balance".
3. Confirm the scanner's per-chain worker is running and not circuit-broken.

## Remediation

- Fail over to a secondary RPC provider from the chain registry.
- Increase provider quota if rate limited.
- If the indexer is behind, allow the scanner to fall back to direct RPC reads
  and mark results `source: rpc_multicall`.

## Verification

- Trigger a fresh scan and confirm the freshness indicator returns to fresh.
- Confirm the `source` and `blockNumber` are attributed on each reading.
