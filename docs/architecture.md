# Architecture

The dashboard is a monorepo (npm workspaces) that separates three trust
boundaries. Each boundary holds different credentials and is deployable on its
own.

| Boundary | Code | Holds | Never holds |
| --- | --- | --- | --- |
| Browser / embed runtime | `apps/web` (client components), `apps/embed` | Wallet connection, consent, signing, local display | Backend secrets, relayer keys |
| Next.js application / API | `apps/web` Route Handlers, `services/api`, `packages/*` | Auth, consent, strategy compilation, simulation, audit, job orchestration | User private keys |
| Execution services | `services/relayer`, `services/worker`, `services/scanner`, `services/indexer`, `services/telegram-approvals` | Relayer keys, RPC credentials, Telegram bot token | User keys |

The dashboard never accepts, stores, transmits, or displays a user private key
or seed phrase. Wallet signing happens in the user's wallet; backend execution
uses separately controlled service keys or a policy-constrained relayer.

## Packages

- `@ops/core` - errors, hashing, ids, RBAC, policy engine.
- `@ops/chains` - the versioned chain registry. Every chain-specific contract,
  explorer, RPC, and Permit2 address comes from here and nowhere else.
- `@ops/contracts` - contract manifest schema/validation and the contract store.
- `@ops/strategy-engine` - strategy schema, compiler, simulation adapter, risk
  assessment, and the strategy/run store.
- `@ops/permit2` - Permit2 typed data, nonce store, allowance model.
- `@ops/eip712` - canonical signing envelope, typed data builders, verification.
- `@ops/audit` - append-only, hash-linked audit log.
- `@ops/approvals` - approval lifecycle, quorum engine, Telegram callbacks.
- `@ops/telemetry` - structured logs, metrics, PII hashing.
- `@ops/ui` - the canonical wallet-connect/consent modal and state machine,
  shared by the dashboard and the embed runtime.

## Request flow

```
Browser / Embed
   |  (wallet signature, consent)
   v
Next.js Route Handlers  ->  services/api (ApiRouter)
   |                              |
   |                              +--> RBAC (permission per route)
   |                              +--> Consent gate (wallet + chain + origin)
   |                              +--> Zod validation
   |                              +--> Audit append (hash-linked)
   |                              +--> Policy evaluation
   v
Execution services (relayer / worker / scanner / indexer / telegram)
```

No frontend input authorizes a backend privileged action by itself. Every
privileged route re-derives permission, consent, and policy server-side.

## Determinism and replay resistance

- Strategy compilation produces a canonical intent hash (sorted keys, keccak256).
- EIP-712 domain binds name, version, chain ID, and verifying contract, so a
  signature cannot be replayed across domains or chains.
- Permit2 and job approvals consume single-use nonces/tokens; replayed
  callbacks and reused intent hashes are rejected.
- The audit log computes `event_hash` from canonical fields plus
  `prev_event_hash`, enabling tamper evidence and periodic external anchoring.

## Availability and latency targets

- 99.9% monthly availability for dashboard read paths and the job API.
- Portfolio scan p95 under 3 seconds for up to 50 tokens.
- Strategy simulation p95 under 5 seconds.

See `docs/runbooks/` for operational procedures and `docs/threat-model.md` for
the STRIDE review.
