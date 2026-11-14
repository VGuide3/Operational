# Runbook: CREATE2 address / bytecode mismatch

## Alert

A deployment's on-chain bytecode hash does not match the expected
`expectedBytecodeHash`, or the deployment landed at an address other than the
predicted one.

## Impact

A mismatch indicates either a broken deployment pipeline or an attack. The
deployment must not be marked active. The system halts and raises a security
alert automatically.

## Diagnosis

1. Recompute the predicted address from `factory`, `salt`, initialization code,
   and constructor arguments; confirm reproducibility.
2. Compare on-chain `eth_getCode` hash against `expectedBytecodeHash`.
3. Check compiler version, optimizer settings, EVM version, and metadata hash
   against the pinned build inputs.
4. Verify the transaction was submitted by the expected deployer and the factory
   is the pinned CREATE2 factory from the chain registry.

## Remediation

- Keep the deployment in `failed`; record a traceable incident.
- If the address was already occupied, do not redeploy to the same salt.
- If a supply-chain or key compromise is suspected, escalate via
  `incident-response.md` and rotate deployer credentials.

## Verification

- Re-run the deployment request in dry mode and confirm the predicted address is
  identical to the on-chain address for a known-good fixture.
