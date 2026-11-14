# Threat model (STRIDE)

Reviewed with STRIDE and revisited after every new privileged capability. Each
row maps a threat to concrete controls and the code that implements them.

| Threat | Example | Controls | Where |
| --- | --- | --- | --- |
| Spoofing | Attacker impersonates an operator or Telegram approver | Wallet signature auth, role checks, webhook signature validation, approver identity binding | `services/api/src/session.ts`, `services/telegram-approvals/src/webhook.ts`, `packages/core/src/rbac.ts` |
| Tampering | Attacker alters a strategy after approval | Immutable strategy versions, intent hash, signed EIP-712 envelope, append-only audit chain | `packages/strategy-engine/src/store.ts`, `packages/eip712/src/index.ts`, `packages/audit/src/log.ts` |
| Repudiation | User denies authorizing a transfer | Signature digest, consent record, audit event, request id, wallet address, timestamp | `packages/audit/src/event.ts`, `services/api/src/session.ts` |
| Information disclosure | Embed leaks balances or API credentials | Origin allowlist, scoped API keys, minimal response fields, no secrets in client bundles | `apps/embed/src/postmessage.ts`, `apps/web/next.config.mjs` |
| Denial of service | Scanner or webhook flooding | Rate limits, queues, circuit breakers, provider quotas, replay protection | `services/telegram-approvals/src/webhook.ts`, `services/scanner/src/scanner.ts` |
| Elevation of privilege | Operator grants themselves execution rights | Separation of duties, dual control, immutable role grants, approval quorum, audit alerts | `packages/core/src/rbac.ts`, `packages/approvals/src/service.ts` |
| Approval phishing | User signs a malicious Permit2 or EIP-712 message | Human-readable decoded message, domain/chain display, spender/recipient display, intent hash, allowlists | `packages/eip712/src/index.ts`, `apps/web/app/(dashboard)/strategies/page.tsx` |
| Replay | Reused Permit2 signature or API request | Nonce tracking, idempotency keys, deadline checks, signature digest uniqueness | `packages/permit2/src/permit2.ts`, `services/api/src/routes.ts` |
| Front-running | Attacker copies a pending transaction | Private mempool where appropriate, deadline bounds, simulation, slippage controls, executor allowlist | `services/relayer/src/relayer.ts`, `packages/strategy-engine/src/simulation.ts` |
| Supply-chain compromise | Malicious dependency or CDN script | Lockfiles, SBOM, dependency scanning, signed releases, SRI, pinned CDN versions | `package-lock.json`, `.github/workflows/ci.yml`, embed SRI |
| Key compromise | Relayer or backend key leakage | HSM/KMS, least privilege, spending limits, rotation, no keys in frontend, anomaly detection | `services/relayer/src/relayer.ts`, `infra/terraform/` |
| Contract risk | Malicious token or upgradeable contract | Verification checks, risk scoring, allowlists, simulation, value caps, emergency pause | `packages/contracts/src/manifest.ts`, `packages/strategy-engine/src/simulation.ts` |
| Cross-site scripting | Host page attacks embedded UI | Shadow DOM, strict CSP, sanitized rendering, no `dangerouslySetInnerHTML` | `apps/embed/src/shadow-root.ts`, `apps/web/next.config.mjs` |
| Telegram compromise | Attacker intercepts approval channel | Signature validation, short-lived tokens, quorum, out-of-band dashboard confirmation, alerting | `services/telegram-approvals/src/webhook.ts`, `packages/approvals/src/service.ts` |

## High-risk invariants

These must never regress. Each is asserted by tests in the suite.

1. No frontend input may authorize a backend privileged action by itself.
2. No backend job may execute without policy evaluation, simulation where
   applicable, and required approvals.
3. No signature may be accepted without domain, chain, expiry, nonce, and intent
   validation.
4. No contract deployment may be marked complete without on-chain bytecode
   verification.
5. No audit event may be silently mutated or deleted.
6. No embed origin may receive capabilities beyond its explicitly granted scope.

## Alerts

- Repeated signature-verification failures.
- Unexpected contract upgrades or bytecode changes.
- Unlimited approval creation.
- High-value transfer attempts.
- Telegram approval replay or quorum anomalies.
- Relayer balance depletion.
- Scanner data staleness beyond threshold.
- Audit-chain hash discontinuity.
