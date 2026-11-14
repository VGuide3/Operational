# On-chain contracts

Solidity sources for the application-owned executor, delegation registry, and
CREATE2 factory. These are the only contracts the dashboard deploys or calls by
default; everything else comes from the versioned chain registry.

## Toolchain

Foundry (`forge`). Pinned in `foundry.toml`:

- solc `0.8.24`, optimizer on (200 runs), EVM `cancun`.
- `bytecode_hash = "ipfs"` and metadata enabled so CREATE2 predictions are
  reproducible. Changing compiler, optimizer, EVM version, or metadata settings
  changes deployed bytecode and therefore the predicted address.

```bash
forge build
forge test
forge script script/Deploy.s.sol --broadcast
```

## Layout

- `src/` - Solidity sources.
- `test/` - Foundry tests.
- `script/` - deployment scripts.
- `deployments/` - immutable deployment artifacts (source, ABI, bytecode, salt,
  factory, tx hash, deployer, block, verification status).

## Invariants

- `OpsExecutor` executes only calls produced from a signed, unexpired intent;
  it never performs arbitrary delegatecall.
- The CREATE2 factory derives addresses from `(factory, salt, initCode)`; the
  same inputs always yield the same address.
- Deployments are not marked active until on-chain bytecode matches the expected
  code hash.
