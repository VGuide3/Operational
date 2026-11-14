# Deployment artifacts

Immutable records of on-chain deployments. One file per deployment, named
`<chainId>-<contract>-<predictedAddress>.json`. Artifacts are never edited;
a redeploy is a new artifact.

## Schema

```json
{
  "chainId": 1,
  "contract": "OpsExecutor",
  "factory": "0x...",
  "salt": "0x...",
  "initCodeHash": "0x...",
  "predictedAddress": "0x...",
  "deployedAddress": "0x...",
  "expectedBytecodeHash": "0x...",
  "deployer": "0x...",
  "txHash": "0x...",
  "blockNumber": 21000000,
  "build": {
    "compilerVersion": "0.8.24",
    "optimizer": true,
    "optimizerRuns": 200,
    "evmVersion": "cancun",
    "metadataHash": "ipfs"
  },
  "verification": { "provider": "etherscan", "status": "verified" },
  "recordedAt": "2026-11-14T10:43:00Z"
}
```

## Rules

- A deployment is not marked `verified` until on-chain bytecode matches
  `expectedBytecodeHash`.
- If `deployedAddress != predictedAddress`, the deployment is `failed` and a
  security alert is raised (`docs/runbooks/create2-address-mismatch.md`).
- Production deployments require approval from at least two authorized roles.
