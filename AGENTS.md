# AGENTS.md

Repository memory for the multi-chain operations dashboard.

## Commands

- Install: `npm ci` (npm workspaces; do not use pnpm install — `pnpm-workspace.yaml` exists but the lockfile/scripts are npm-based).
- Lint: `npm run lint` (eslint, `.ts/.tsx`).
- Typecheck: `npm run typecheck` (runs per workspace).
- Tests: `npm test` (vitest, single run). Filter: `npx vitest run <path>`.
- Build web: `npm --workspace @ops/web run build` (Next.js, static export of dashboard pages).
- Build embed: `npm --workspace @ops/embed run build` (esbuild -> `dist/script.js`).
- Contracts: Foundry — `cd contracts && forge build && forge test -vvv`.

## Layout

- `apps/web` — Next.js App Router dashboard. Framework-agnostic router lives in `services/api`; Next route handlers adapt it via `apps/web/lib/next-adapter.ts`.
- `apps/embed` — shadow-DOM `script.js` embed with postMessage bridge.
- `packages/*` — `@ops/core` (errors, RBAC, ids, canonical hashing), `chains`, `contracts` (manifest + CREATE2 + deployment store), `strategy-engine` (schema, compiler, simulation, store, delegation), `permit2`, `eip712`, `audit`, `approvals`, `telemetry`, `ui`.
- `services/*` — `api` (router, routes, session, migrations), `worker`, `scanner`, `relayer`, `telegram-approvals`, `indexer`.
- `contracts/` — Foundry sources, tests, deploy script, deployments.
- `infra/`, `docs/` — deployment scaffolding and architecture/threat-model/runbooks.

## Conventions

- Router is framework-agnostic: handlers take `HttpRequest` and return `HttpResponse`. Never import Next types into `services/api`.
- Every state-changing route needs `csrf: true` and a `permission`; every body is Zod-validated server-side. Errors use stable `ErrorCodes`.
- RBAC permissions are deliberately split (read/propose/approve/execute/deploy/import/audit). A proposer must not approve its own action (`assertNotSelfApproval`).
- Trust boundaries: browser/embed (no secrets), Next.js API (authz + orchestration), execution services (relayer keys, isolated).
- Audit log is append-only and hash-linked (`prev_event_hash` + `event_hash`); never mutate/delete.
- CREATE2: a deployment is only `verified` when on-chain bytecode hash matches expected; mismatch halts.
- Delegations are validated on every backend execution, never from UI state; revocation is immediate.
- Shared web DTOs live in `apps/web/lib/types.ts`; presentational components re-export those types. Keep the API client (`apps/web/lib/api-client.ts`) as the single typed entry point.
- Pages are written with `React.createElement` (no JSX) to match the existing dashboard style.

## Gotchas

- Next dev/start default port is 3000; pass `-p` to override. Kill stale `next-server` PIDs before restarting to avoid port conflicts.
- `create2` route: pass `predictedAddress` to have the server verify the computation; a mismatch returns 422 `bytecode_hash_mismatch`.
