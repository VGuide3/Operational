# API reference (v1)

All routes are served by Next.js Route Handlers under `/api/v1` and implemented
by `services/api` (`ApiRouter`). Every route requires an authenticated session,
applies CSRF protection for cookie-based requests, enforces rate limits, returns
a request id, and writes a structured audit event.

## Conventions

- **Errors** are stable machine-readable codes (see `packages/core/src/errors.ts`).
  Raw stack traces are never returned.
- **Validation** uses server-side Zod schemas for every request body. Failures
  return `422` with `error.details[]` of `{ path, message }`.
- **Pagination** on list endpoints is cursor-based (`cursor`, `limit`).
- **Idempotency**: execution and job-creation endpoints accept an
  `idempotencyKey`; replaying the same key returns the original result.
- **Permissions** are separated for read / propose / approve / execute / deploy /
  import / audit-access. See `packages/core/src/rbac.ts`.

## Authentication

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/v1/auth/wallet-challenge` | Issue a nonce and SIWE-style challenge |
| POST | `/api/v1/auth/wallet-verify` | Verify the signature and create a session |
| POST | `/api/v1/consent` | Create a wallet/connect consent record |
| DELETE | `/api/v1/consent/:consentId` | Revoke consent |
| GET | `/api/v1/me` | Return user, roles, wallets, and active consent |

### Consent gate

Privileged surfaces require an unexpired consent record that matches the current
wallet, chain, and (for embeds) origin. Changing any of those invalidates the
prior consent and returns `403` with `consent_invalidated` or `consent_required`.

## Contracts

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/v1/contracts/import` | Validate and stage a contract manifest |
| POST | `/api/v1/contracts/:id/approve` | Approve a staged contract import (two-person for production) |
| GET | `/api/v1/contracts` | List contracts with filters |

## Portfolio and allowances

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/v1/portfolio/:chainId/:address` | Native and token balances |
| POST | `/api/v1/allowances/scan` | Scan allowances for owner and spenders |
| POST | `/api/v1/allowances/revoke` | Create a revocation intent |

## Strategies and runs

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/v1/strategies` | List strategies |
| POST | `/api/v1/strategies` | Create a strategy draft |
| POST | `/api/v1/strategies/:id/compile` | Compile and validate a strategy |
| POST | `/api/v1/strategies/:id/simulate` | Simulate a compiled strategy |
| POST | `/api/v1/strategies/:id/execute` | Create a run and request approval/signature |
| GET | `/api/v1/runs/:runId` | Run status, steps, receipts, and errors |

## Signatures

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/v1/signatures/permit2` | Stage a Permit2 signature payload |
| POST | `/api/v1/signatures/verify` | Verify an EIP-712 signature |

## Approvals and jobs

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/v1/jobs/:jobId/approve` | Dashboard (dual-control) approval endpoint |
| POST | `/api/v1/integrations/telegram/webhook` | Telegram callback receiver |

## Delegations and deployments

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/v1/delegations` | List delegations |
| POST | `/api/v1/delegations` | Create a delegation proposal |
| POST | `/api/v1/delegations/:id/revoke` | Revoke a delegation |
| POST | `/api/v1/deployments/create2` | Create a deterministic deployment request |
| GET | `/api/v1/deployments/:id` | Deployment status and verification |

## Operations

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/v1/audit-events` | Admin-scoped audit search |
| GET | `/api/v1/health` | Liveness probe |
| GET | `/api/v1/ready` | Readiness probe including dependencies |

## Example: execute a strategy

```bash
curl -X POST https://ops.example.com/api/v1/strategies/str_01J/execute \
  -H 'content-type: application/json' \
  -H 'x-csrf-token: <token>' \
  --cookie 'ops_session=<cookie>' \
  -d '{"dryRun": false, "idempotencyKey": "str_01J:2026-11-14T10:43Z"}'
```

The response is `202` with `{ runId, intentHash, status, jobId?, assessment }`.
When the risk policy requires Telegram approval, `status` is
`awaiting_approval` and `jobId` is present.
