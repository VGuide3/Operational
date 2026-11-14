Product scope
Build a multi-chain operations dashboard that lets an authorized operator import contract ABIs, inspect wallet balances and token allowances, define reusable strategies, simulate and execute transaction batches, deploy deterministic contracts, manage delegations, and require Telegram approval for privileged backend jobs.

The system must separate three trust boundaries:

Boundary	Responsibility
Browser / embed runtime	Wallet connection, consent, signing, local display; never holds backend secrets
Next.js application / API	Authentication, authorization, strategy compilation, simulation, audit records, job orchestration
Execution services	Private transaction submission, relayer keys, indexers, notification delivery; isolated credentials and least-privilege access
The dashboard must never accept, store, transmit, or display a user private key or seed phrase. Wallet signing occurs in the user’s wallet; backend execution uses separately controlled service keys or a policy-constrained relayer.

Core user journeys
Connect and consent: User connects a wallet, selects a chain, reviews the application domain, requested signing scope, and data-sharing terms, then grants a session-scoped consent record.

Import contracts: Operator uploads a contract manifest JSON containing chain, address, ABI, name, version, and optional deployment metadata; the system validates and indexes it.

Inspect portfolio: User scans native balance, ERC-20 balances, ERC-721/1155 holdings where configured, and ERC-20 allowances to selected spenders.

Create strategy: Operator composes a strategy from typed actions: token transfer, Permit2 transfer, contract call, multicall batch, approval revocation, or deployment.

Review and approve: The UI renders a human-readable intent, decoded calldata, recipient, amount, chain, gas estimate, simulation result, and risk flags before signature or backend execution.

Execute: The system either requests an EIP-712 signature, submits a wallet transaction, or queues an approved backend job for a relayer.

Audit and monitor: Every request, signature, approval, execution, failure, and state transition is written to an append-only audit log.

Non-functional requirements
Chains: Ethereum mainnet plus configurable EVM L2s; all chain-specific contracts, explorers, RPCs, and Permit2 addresses must come from a versioned registry.

Availability: Target 99.9% monthly availability for dashboard read paths and job API.

Latency: Portfolio scan p95 under 3 seconds for up to 50 tokens; strategy simulation p95 under 5 seconds.

Security: No client-trusted authorization; all privileged actions require server-side policy evaluation and audit records.

Observability: Structured logs, OpenTelemetry traces, Prometheus metrics, error tracking, and job dead-letter queues.

Accessibility: WCAG 2.2 AA for the dashboard; keyboard-operable modals and clear error states.

Test coverage: Unit, integration, E2E, contract-interaction fixture, load, and adversarial/security tests.

Canonical wallet-connect and consent modal
Use wagmi with a wallet connector layer such as WalletConnect-compatible connectors. The application wraps the Next.js App Router in WagmiProvider, then exposes connect/disconnect and connection state through wagmi hooks.

Modal requirements
The modal must be a single canonical component used by both the dashboard and script.js embed runtime.

Required states:

Discovery: Wallet options, installed-wallet detection, deep links, QR code for mobile wallets.

Connection: Connecting, chain switch, signature request, rejected, timeout, unsupported chain.

Consent: Plain-language scope disclosure, destination domain, connected address, selected chain, requested capabilities, privacy notice, and explicit Approve/Cancel controls.

Post-connect: Address, ENS where available, chain badge, disconnect, account switch, and session expiry.

Consent payload
Persist a signed or hash-bound consent record before enabling privileged operations:

json
{
  "consentId": "cns_01J...",
  "userId": "usr_01J...",
  "walletAddress": "0x...",
  "chainId": 1,
  "appOrigin": "https://ops.example.com",
  "embedOrigin": "https://partner.example.com",
  "scopes": [
    "wallet:connect",
    "balance:read",
    "allowance:read",
    "strategy:propose",
    "signature:request",
    "transaction:submit"
  ],
  "policyVersion": "2026-11-01",
  "termsHash": "0x...",
  "expiresAt": "2026-11-14T18:43:00Z",
  "createdAt": "2026-11-14T10:43:00Z",
  "revokedAt": null
}
Acceptance criteria
A user cannot reach balance, allowance, strategy, or signing surfaces without an unexpired consent record.

Changing wallet address, chain, or originating embed domain invalidates the prior consent and requires re-consent.

The modal explicitly identifies the requesting origin for embedded use and does not inherit trust from the host page.

Rejecting connection or consent leaves no authenticated session and records an audit event.

The modal supports disconnect, account switch, chain switch, expiry, and revocation without stale UI state.

Contract import via JSON
Support a versioned Contract Manifest format, validated with Zod on the client and server.

json
{
  "manifestVersion": "1.0.0",
  "contracts": [
    {
      "key": "treasury",
      "name": "Treasury",
      "chainId": 1,
      "address": "0x...",
      "abi": [],
      "abiSource": {
        "type": "etherscan_v2",
        "url": "https://api.etherscan.io/v2/api"
      },
      "deployer": "0x...",
      "txHash": "0x...",
      "blockNumber": 21000000,
      "verified": true,
      "tags": ["treasury", "production"],
      "risk": {
        "owner": "0x...",
        "upgradeable": true,
        "proxyImplementation": "0x..."
      }
    }
  ]
}
Validation rules
Require checksummed addresses and supported chainId.

Require ABI arrays to contain only known ABI entry types.

Reject duplicate (chainId, address) pairs unless explicitly marked as an alias.

Verify contract bytecode existence through an RPC or indexer before activation.

For verified-source imports, store compiler version, source hash, verification provider, and verification timestamp.

Treat ABIs as immutable once imported; changes create a new manifest revision rather than mutating prior records.

Require role contracts:import and two-person approval for production-chain contract registration.

Acceptance criteria
A malformed manifest fails with field-level errors and does not create partial records.

Importing an unverified contract is allowed only in staging or with explicit risk acknowledgement.

Contract ABI revisions preserve historical call definitions and audit references.

Imported contracts are searchable by name, address, chain, tag, deployer, and ABI function.

The dashboard can render readable function arguments from imported ABIs.

Balance and allowance scanning
Build a scanner service that queries RPC providers, token metadata caches, and indexer data. It must tolerate partial indexer failures and distinguish “not indexed” from “zero balance.”

Scan capabilities
Native currency balance.

ERC-20 balances, decimals, symbol, name, and total supply where available.

ERC-20 allowances for a selected spender, including Permit2 allowances where applicable.

ERC-721 and ERC-1155 holdings for configured collections.

Token risk metadata: contract verification, honeypot/heuristic flags, liquidity depth, blacklist status, and known exploit associations.

Historical snapshots for portfolio change detection.

Allowance model
For every (owner, token, spender, chainId), store:

json
{
  "owner": "0x...",
  "token": "0x...",
  "spender": "0x...",
  "chainId": 1,
  "allowanceRaw": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
  "allowanceIsMax": true,
  "permit2Allowance": {
    "amount": "0",
    "expiration": 0,
    "nonce": 0
  },
  "scannedAt": "2026-11-14T10:43:00Z",
  "source": "rpc_multicall"
}
Permit2 separates signature-based transfers from allowance-based transfers. SignatureTransfer authorizes one nonce-scoped transfer and does not create a persistent allowance; AllowanceTransfer supports time-bounded allowances and expirations.

Acceptance criteria
The scanner batches read calls where possible and respects provider rate limits.

A user can filter allowances by token, spender, chain, amount, approval date, and risk score.

Unlimited approvals are clearly labeled and can be queued for revocation with explicit confirmation.

Scan results include source, block number or timestamp, and freshness indicator.

The system detects and flags approvals to untrusted or newly created spender contracts.

Strategy engine
A strategy is a declarative, versioned execution plan. It must compile into one or more transaction intents, be simulated before approval, and support dry-run execution.

Strategy document
json
{
  "strategyId": "str_01J...",
  "name": "Weekly treasury rebalance",
  "version": 3,
  "chainId": 1,
  "owner": "usr_01J...",
  "trigger": {
    "type": "manual",
    "allowedRoles": ["treasury_operator"]
  },
  "preconditions": [
    {
      "type": "token_balance",
      "token": "0x...",
      "wallet": "$connectedWallet",
      "gte": "1000000"
    },
    {
      "type": "allowance",
      "token": "0x...",
      "spender": "0x...",
      "gte": "500000"
    }
  ],
  "steps": [
    {
      "id": "revoke",
      "type": "erc20_approve",
      "token": "0x...",
      "spender": "0x...",
      "amount": "0"
    },
    {
      "id": "permit2_transfer",
      "type": "permit2_signature_transfer",
      "token": "0x...",
      "amount": "500000",
      "recipient": "0x...",
      "deadlineSeconds": 600
    },
    {
      "id": "batch",
      "type": "multicall",
      "calls": [
        {
          "target": "0x...",
          "allowFailure": false,
          "calldata": "0x..."
        }
      ]
    }
  ],
  "riskPolicy": {
    "maxNativeValueUsd": "25000",
    "requireTelegramApproval": true,
    "requireSimulation": true,
    "blockedRecipients": []
  }
}
Supported actions
Action	Execution model	Approval requirement
erc20_approve	Direct wallet transaction	Explicit user confirmation
erc20_revoke	Direct wallet transaction	Explicit user confirmation
permit2_signature_transfer	EIP-712 signature plus executor transaction	Explicit signature and policy check
contract_call	ABI-encoded call	Decoded calldata review
multicall	Batched calls in one transaction	Per-call decoded review
create2_deploy	Deterministic deployment transaction	Deployment review and address verification
delegation_grant	Smart-account or session-key delegation	Policy-specific approval
backend_job	Queued privileged server action	Telegram approval where required
Compilation rules
Resolve $connectedWallet, token metadata, decimals, and addresses at proposal time.

Reject strategies containing unresolved addresses, invalid decimals, expired deadlines, or unknown contract functions.

Convert human amounts to integer base units using token decimals; never round silently.

Enforce global per-user, per-strategy, per-token, per-recipient, and per-chain limits.

Require simulation before execution for any state-changing action.

Produce a canonical intent hash before signing or queueing.

Permit2 transfers and multicall batching
Permit2 supports one-time signature-based token movement without long-lived ERC-20 allowances. A user first approves the Permit2 contract for a token; subsequent SignatureTransfer permits authorize individual transfers without leaving a standing allowance.

Permit2 transfer flow
Verify that the connected wallet owns the token balance.

Check the token’s allowance to the canonical Permit2 contract.

If insufficient, prompt a standard ERC-20 approval transaction to Permit2, with a clear explanation and optional non-maximum amount where supported.

Generate a PermitTransferFrom message containing token, maximum permitted amount, unique nonce, and deadline.

Request an EIP-712 signature from the connected wallet.

Submit the permit, transfer details, owner, and signature to the authorized executor contract or relayer.

Record the signature digest, nonce, deadline, chain, intent hash, and execution result.

Permit2’s permitTransferFrom validates deadline, requested amount, nonce use, and EIP-712 signature before transferring; batch variants support multiple token permissions and transfer details.

Witness requirements
For strategies that bind a Permit2 authorization to a specific operational intent, use permitWitnessTransferFrom. The witness must include a strategy ID, intent hash, expiry, and executor contract address; the witness type string must follow EIP-712 struct-ordering requirements.

Multicall batching
Use a vetted multicall contract or application-owned executor with:

Explicit allowFailure per call.

Per-call gas caps.

A maximum number of calls per batch.

Reversion-safe ordering.

Simulation of the complete batch, not merely individual calls.

A decoded human-readable preview for every call.

Prohibition of arbitrary delegatecall targets unless explicitly allowlisted and approved.

Acceptance criteria
A Permit2 signature cannot be reused: the system records nonce consumption and rejects duplicate intent hashes.

Expired signatures are rejected before submission.

The UI displays token, amount, recipient, spender, deadline, chain, and decoded calldata before signing.

A multicall simulation failure prevents execution unless the user explicitly approves a partial-failure policy.

No strategy may silently obtain unlimited token approval without an explicit, separately labeled consent step.

Embeddable script.js runtime
Provide a sandboxed, versioned embed script for partner sites:

xml
<script
  src="https://cdn.ops.example.com/embed/v1/script.js"
  data-api-key="pk_live_..."
  data-chain-id="1"
  data-theme="dark"
  data-mode="portfolio"
  defer
></script>
<div id="ops-dashboard"></div>
Runtime requirements
Load only from a pinned, immutable CDN origin with Subresource Integrity.

Render inside a shadow DOM to prevent host-page CSS interference.

Communicate with the parent only through a strict postMessage protocol.

Validate event.origin against an allowlist configured per API key.

Never expose backend tokens, admin capabilities, or unrestricted RPC credentials to the host page.

Present the same canonical wallet-connect/consent modal, with the embed origin clearly disclosed.

Support modes: portfolio, allowances, strategy, and approval.

Enforce a strict JSON-RPC bridge allowlist; do not expose generic eth_sendTransaction to the host page.

PostMessage protocol
json
{
  "type": "ops:request",
  "requestId": "req_01J...",
  "action": "open_allowances",
  "payload": {
    "chainId": 1,
    "spender": "0x..."
  }
}
json
{
  "type": "ops:response",
  "requestId": "req_01J...",
  "ok": true,
  "data": {
    "view": "allowances"
  }
}
Acceptance criteria
A malicious parent page cannot invoke privileged actions, read wallet state, or forge consent.

The embed refuses to initialize on unregistered origins.

The embed displays its own application identity and does not rely on host-page branding for security decisions.

Script integrity, version, and API-key restrictions are observable in telemetry.

The embed gracefully handles ad blockers, unsupported browsers, and wallet-extension absence.

EIP-712 structured signing
Use EIP-712 for every off-chain authorization: Permit2 permits, delegation grants, backend-job approvals, and strategy intents. EIP-712 domain separators should include the application name, version, chain ID, and verifying contract; this prevents cross-domain and cross-chain replay.

Canonical signing envelope
json
{
  "domain": {
    "name": "Web3 Operations Dashboard",
    "version": "1",
    "chainId": 1,
    "verifyingContract": "0x..."
  },
  "primaryType": "StrategyIntent",
  "types": {
    "EIP712Domain": [],
    "StrategyIntent": [
      { "name": "strategyId", "type": "bytes32" },
      { "name": "version", "type": "uint256" },
      { "name": "chainId", "type": "uint256" },
      { "name": "executor", "type": "address" },
      { "name": "intentHash", "type": "bytes32" },
      { "name": "expiresAt", "type": "uint256" }
    ]
  },
  "message": {
    "strategyId": "0x...",
    "version": 3,
    "chainId": 1,
    "executor": "0x...",
    "intentHash": "0x...",
    "expiresAt": 1760000000
  }
}
Requirements
Generate intentHash from a canonical JSON serialization with sorted keys and deterministic encoding.

Include chain ID, executor, strategy version, nonce, expiry, and full action digest in the signed message.

Verify signatures server-side using the recovered address and domain.

Reject signatures with mismatched chain ID, expired deadline, unknown strategy version, or reused nonce.

Support EOA signatures, EIP-1271 contract signatures where applicable, and wallet-specific signing limitations.

Display the decoded message in the wallet and dashboard; never ask users to sign opaque blobs for privileged actions.

CREATE2 deployment
Support deterministic deployment for operations contracts, safe module proxies, strategy executors, and partner-specific instances.

Deployment inputs
json
{
  "chainId": 1,
  "factory": "0x...",
  "salt": "0x...",
  "bytecodeHash": "0x...",
  "constructorArgs": [],
  "predictedAddress": "0x...",
  "expectedBytecodeHash": "0x...",
  "verification": {
    "provider": "etherscan",
    "status": "pending"
  }
}
Requirements
Compute and display the predicted CREATE2 address before submission.

Derive the address from factory, salt, initialization code, and constructor arguments; never present a predicted address without a reproducible computation.

Pin compiler version, optimizer settings, EVM version, metadata hash, and source files.

Verify deployed bytecode matches the expected on-chain code hash before marking deployment complete.

Prevent deployment if the predicted address is already occupied.

Require production deployment approval from at least two authorized roles.

Store deployment artifacts immutably: source, ABI, bytecode, salt, factory, tx hash, deployer, block, and verification status.

Acceptance criteria
The same salt, factory, and bytecode always produce the same predicted address.

A failed deployment leaves a traceable incident record and does not mark the contract active.

The dashboard can distinguish pending, deployed, verified, and failed deployments.

Deployment to an unexpected address triggers an automatic halt and security alert.

Delegation flows
Support scoped delegation for operational wallets, smart accounts, session keys, and backend executors. Delegation must be explicit, revocable, time-bound, and policy-constrained.

Delegation record
json
{
  "delegationId": "dlg_01J...",
  "grantor": "0x...",
  "delegate": "0x...",
  "chainId": 1,
  "scope": {
    "tokens": ["0x..."],
    "maxPerTx": "1000000",
    "maxDailyUsd": "50000",
    "allowedContracts": ["0x..."],
    "allowedFunctions": ["transfer", "swapExactTokensForTokens"],
    "blockedRecipients": []
  },
  "validFrom": "2026-11-14T00:00:00Z",
  "validUntil": "2026-11-21T00:00:00Z",
  "signature": "0x...",
  "status": "active",
  "revokedAt": null
}
Requirements
Request an EIP-712 delegation signature that binds grantor, delegate, chain, scope hash, expiry, and nonce.

Validate delegation on every backend execution; do not rely only on UI state.

Support immediate revocation through both an off-chain registry update and, where applicable, an on-chain revocation transaction.

Alert on delegation usage approaching limits.

Require Telegram approval for first use of a new delegate, high-value execution, or scope expansion.

Never allow a delegate to modify its own scope, extend expiry, or grant further delegations unless explicitly permitted.

Telegram approval service
Use Telegram as an out-of-band approval channel for backend jobs that exceed automated policy limits.

Approval lifecycle
A job enters awaiting_approval.

The service renders a structured Telegram message with job ID, strategy, chain, actor, decoded actions, USD exposure, simulation result, and expiry.

Authorized approvers use inline buttons: Approve, Reject, Request changes, or View details.

Telegram delivers a callback to a dedicated HTTPS webhook endpoint.

The backend verifies Telegram’s signature, checks approver identity and role, validates job state, and records the decision.

Approved jobs move to queued; rejected jobs move to rejected; expired jobs move to expired.

Security requirements
Validate Telegram webhook signatures and timestamps.

Use a secret, unguessable webhook path; rotate it regularly.

Bind each approval button to a single-use, short-lived token.

Require a quorum for high-risk actions, such as two distinct approvers.

Prevent self-approval where the requester and approver are the same user.

Do not place raw private keys, full calldata, or secrets in Telegram messages.

Rate-limit approval endpoints and lock accounts after repeated invalid callbacks.

Maintain a fallback approval path that does not weaken policy—for example, an in-dashboard dual-control workflow.

Acceptance criteria
A job cannot execute without a valid, unexpired, quorum-satisfying approval.

A replayed Telegram callback is rejected.

Approval expiry automatically cancels the job.

Every approval decision includes approver identity, timestamp, IP/device metadata where lawful, and job hash.

Telegram outages do not create an unauthenticated execution path.

Data models
Use PostgreSQL for transactional operational data, Redis for short-lived cache and rate limits, and an append-only audit store such as PostgreSQL partitioned tables or an immutable log sink.

Users and access
sql
users (
  id uuid primary key,
  external_id text unique,
  email text unique,
  role text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

wallet_links (
  id uuid primary key,
  user_id uuid references users(id),
  address text not null,
  chain_id integer not null,
  verified_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, address, chain_id)
);

roles (
  id text primary key,
  description text,
  permissions jsonb not null
);

user_roles (
  user_id uuid references users(id),
  role_id text references roles(id),
  granted_by uuid,
  granted_at timestamptz,
  primary key (user_id, role_id)
);
Contracts and tokens
sql
contract_manifests (
  id uuid primary key,
  manifest_version text not null,
  submitted_by uuid references users(id),
  status text not null,
  source_hash text not null,
  created_at timestamptz not null
);

contracts (
  id uuid primary key,
  manifest_id uuid references contract_manifests(id),
  key text not null,
  name text not null,
  chain_id integer not null,
  address text not null,
  abi jsonb not null,
  abi_hash text not null,
  verified boolean not null,
  risk jsonb,
  created_at timestamptz not null,
  unique (chain_id, address, abi_hash)
);

tokens (
  id uuid primary key,
  chain_id integer not null,
  address text not null,
  symbol text,
  decimals integer,
  name text,
  metadata jsonb,
  risk jsonb,
  updated_at timestamptz not null,
  unique (chain_id, address)
);
Strategies and jobs
sql
strategies (
  id uuid primary key,
  owner_id uuid references users(id),
  name text not null,
  version integer not null,
  chain_id integer not null,
  definition jsonb not null,
  definition_hash text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (owner_id, name, version)
);

strategy_runs (
  id uuid primary key,
  strategy_id uuid references strategies(id),
  initiated_by uuid references users(id),
  wallet_address text not null,
  chain_id integer not null,
  intent_hash text not null,
  status text not null,
  simulation jsonb,
  risk_assessment jsonb,
  created_at timestamptz not null,
  completed_at timestamptz
);

jobs (
  id uuid primary key,
  run_id uuid references strategy_runs(id),
  type text not null,
  payload jsonb not null,
  status text not null,
  attempts integer not null default 0,
  requires_telegram_approval boolean not null,
  approval_state text,
  scheduled_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null
);
Audit log
sql
audit_events (
  id bigserial primary key,
  event_id uuid unique not null,
  occurred_at timestamptz not null,
  actor_type text not null,
  actor_id text,
  wallet_address text,
  impersonated_by uuid,
  action text not null,
  resource_type text not null,
  resource_id text,
  chain_id integer,
  before_state jsonb,
  after_state jsonb,
  request_id text,
  ip_hash text,
  user_agent_hash text,
  signature_digest text,
  prev_event_hash text,
  event_hash text not null
);
The audit writer must compute event_hash from canonical event fields plus prev_event_hash, enabling tamper-evidence and periodic external anchoring.

API routes
Use Next.js Route Handlers under /api/v1. All routes require authenticated sessions, CSRF protection for cookie-based requests, rate limits, request IDs, and structured audit logging.

Method	Route	Purpose
POST	/api/v1/auth/wallet-challenge	Issue nonce and SIWE-style challenge
POST	/api/v1/auth/wallet-verify	Verify signature and create session
POST	/api/v1/consent	Create wallet/connect consent
DELETE	/api/v1/consent/:consentId	Revoke consent
GET	/api/v1/me	Return user, roles, wallets, and active consent
POST	/api/v1/contracts/import	Validate and stage a contract manifest
POST	/api/v1/contracts/:id/approve	Approve staged contract import
GET	/api/v1/contracts	List contracts with filters
GET	/api/v1/portfolio/:chainId/:address	Native and token balances
POST	/api/v1/allowances/scan	Scan allowances for owner and spenders
POST	/api/v1/allowances/revoke	Create revocation intent
GET	/api/v1/strategies	List strategies
POST	/api/v1/strategies	Create strategy draft
POST	/api/v1/strategies/:id/compile	Compile and validate strategy
POST	/api/v1/strategies/:id/simulate	Simulate compiled strategy
POST	/api/v1/strategies/:id/execute	Create run and request approval/signature
POST	/api/v1/signatures/permit2	Stage Permit2 signature payload
POST	/api/v1/signatures/verify	Verify EIP-712 signature
GET	/api/v1/runs/:runId	Run status, steps, receipts, and errors
POST	/api/v1/jobs/:jobId/approve	Dashboard approval endpoint
POST	/api/v1/integrations/telegram/webhook	Telegram callback receiver
GET	/api/v1/delegations	List delegations
POST	/api/v1/delegations	Create delegation proposal
POST	/api/v1/delegations/:id/revoke	Revoke delegation
POST	/api/v1/deployments/create2	Create deterministic deployment request
GET	/api/v1/deployments/:id	Deployment status and verification
GET	/api/v1/audit-events	Admin-scoped audit search
GET	/api/v1/health	Liveness probe
GET	/api/v1/ready	Readiness probe including dependencies
Route rules
Use cursor pagination for list endpoints.

Return idempotency keys for all execution and job-creation endpoints.

Use server-side Zod validation for every request body.

Return stable machine-readable error codes, never raw stack traces.

Require separate permissions for read, propose, approve, execute, deploy, import, and audit-access operations.

Repository layout
text
web3-ops-dashboard/
├─ apps/
│  ├─ web/
│  │  ├─ app/
│  │  │  ├─ (dashboard)/
│  │  │  │  ├─ portfolio/
│  │  │  │  ├─ allowances/
│  │  │  │  ├─ contracts/
│  │  │  │  ├─ strategies/
│  │  │  │  ├─ runs/
│  │  │  │  ├─ delegations/
│  │  │  │  └─ deployments/
│  │  │  ├─ api/
│  │  │  │  └─ v1/
│  │  │  ├─ layout.tsx
│  │  │  └─ providers.tsx
│  │  ├─ components/
│  │  │  ├─ wallet/
│  │  │  │  ├─ WalletConnectModal.tsx
│  │  │  │  ├─ ConsentPanel.tsx
│  │  │  │  └─ ChainSwitcher.tsx
│  │  │  ├─ contracts/
│  │  │  ├─ portfolio/
│  │  │  ├─ strategy/
│  │  │  ├─ approvals/
│  │  │  └─ audit/
│  │  ├─ lib/
│  │  ├─ hooks/
│  │  └─ tests/
│  └─ embed/
│     ├─ src/
│     │  ├─ script.ts
│     │  ├─ shadow-root.ts
│     │  ├─ postmessage.ts
│     │  └─ wallet-bridge.ts
│     └─ tests/
├─ packages/
│  ├─ ui/
│  ├─ core/
│  ├─ chains/
│  ├─ contracts/
│  ├─ strategy-engine/
│  ├─ permit2/
│  ├─ eip712/
│  ├─ audit/
│  ├─ approvals/
│  └─ telemetry/
├─ services/
│  ├─ api/
│  ├─ worker/
│  ├─ scanner/
│  ├─ relayer/
│  ├─ telegram-approvals/
│  └─ indexer/
├─ contracts/
│  ├─ src/
│  ├─ test/
│  ├─ script/
│  └─ deployments/
├─ infra/
│  ├─ terraform/
│  ├─ k8s/
│  ├─ docker/
│  └─ observability/
├─ docs/
│  ├─ architecture.md
│  ├─ threat-model.md
│  ├─ runbooks/
│  └─ api/
├─ .github/
│  └─ workflows/
├─ package.json
├─ pnpm-workspace.yaml
└─ turbo.json
Build phases
Phase 0: Foundations
Establish monorepo, TypeScript strict mode, linting, formatting, CI, preview environments, secrets management, and observability.

Implement chain registry, wallet abstraction, database migrations, audit schema, and health/readiness endpoints.

Define role-based access control and policy engine interfaces.

Exit criteria: CI runs unit and integration tests; a local environment can authenticate a test wallet and write an audit event.

Phase 1: Wallet, consent, and contracts
Build the canonical wallet-connect/consent modal.

Integrate wagmi providers and connectors.

Implement wallet challenge, session issuance, consent creation, revocation, and expiry.

Implement contract manifest import, validation, storage, and search.

Exit criteria: A user can connect, consent, disconnect, import a valid contract manifest, and see imported contracts.

Phase 2: Portfolio and allowances
Implement balance scanner, token metadata cache, allowance scanner, and risk enrichment.

Build portfolio and allowance UI with filters, freshness indicators, and revocation proposals.

Add scheduled scans and change alerts.

Exit criteria: The dashboard accurately displays balances and allowances for at least two chains, including Permit2 allowance state where configured.

Phase 3: Strategy engine
Implement strategy schema, compiler, validation, simulation adapter, risk policy engine, and intent hashing.

Build strategy editor, preview, decoded calldata, simulation results, and execution controls.

Implement direct wallet transactions and basic job queueing.

Exit criteria: A user can create, simulate, approve, and execute a simple transfer or contract-call strategy with full audit coverage.

Phase 4: Permit2 and batching
Implement Permit2 allowance checks, EIP-712 permit generation, signature verification, nonce tracking, and executor integration.

Implement multicall compilation, simulation, decoding, and batch execution.

Add witness-bound permits for strategy-specific authorization.

Exit criteria: A Permit2 transfer executes only after a valid, unexpired, single-use signature; a multicall strategy simulates and executes with per-call visibility.

Phase 5: Embed runtime
Build script.js, shadow-DOM renderer, postMessage bridge, origin allowlist, API-key scoping, and embed consent flow.

Add CDN publishing, integrity checks, version rollout, and embed telemetry.

Exit criteria: A partner page can embed the dashboard without gaining privileged capabilities, and cross-origin messages outside the allowlist are rejected.

Phase 6: Delegation and CREATE2
Implement delegation proposals, EIP-712 delegation signing, policy enforcement, revocation, and delegate monitoring.

Implement CREATE2 address computation, deployment workflow, bytecode verification, and deployment audit trail.

Exit criteria: A scoped delegate can execute only authorized actions within limits; a deterministic deployment produces and verifies the expected address.

Phase 7: Telegram approvals and hardening
Implement Telegram approval service, webhook validation, quorum rules, expiry, retries, and dead-letter handling.

Conduct threat modeling, penetration testing, chaos tests, load tests, and incident-response drills.

Complete runbooks, on-call alerts, backup/restore tests, and production readiness review.

Exit criteria: High-risk backend jobs cannot execute without valid approval; security tests and operational runbooks pass.

Threat model
Use STRIDE as the review framework and revisit it after every new privileged capability.

Threat	Example	Controls
Spoofing	Attacker impersonates an operator or Telegram approver	Wallet signature authentication, MFA, role checks, webhook signature validation, approver identity binding
Tampering	Attacker alters a strategy after approval	Immutable strategy versions, intent hash, signed EIP-712 envelope, append-only audit chain
Repudiation	User denies authorizing a transfer	Signature digest, consent record, audit event, request ID, wallet address, timestamp
Information disclosure	Embed leaks balances or API credentials	Origin allowlist, scoped API keys, minimal response fields, no secrets in client bundles
Denial of service	Scanner or webhook flooding	Rate limits, queues, circuit breakers, provider quotas, webhook replay protection
Elevation of privilege	Operator grants themselves execution rights	Separation of duties, dual control, immutable role grants, approval quorum, audit alerts
Approval phishing	User signs a malicious Permit2 or EIP-712 message	Human-readable decoded message, domain/chain display, spender/recipient display, intent hash, allowlists
Replay	Reused Permit2 signature or API request	Nonce tracking, idempotency keys, deadline checks, signature digest uniqueness
Front-running	Attacker observes pending transaction and copies it	Private mempool where appropriate, deadline bounds, simulation, slippage controls, executor allowlist
Supply-chain compromise	Malicious dependency or CDN script	Lockfiles, SBOM, dependency scanning, signed releases, SRI, pinned CDN versions
Key compromise	Relayer or backend key leakage	HSM/KMS, least privilege, spending limits, rotation, no keys in frontend, anomaly detection
Contract risk	Malicious token or upgradeable contract	Verification checks, risk scoring, allowlists, simulation, value caps, emergency pause
Cross-site scripting	Host page attacks embedded UI	Shadow DOM, strict CSP, sanitized rendering, no dangerouslySetInnerHTML, Trusted Types where supported
Telegram compromise	Attacker intercepts approval channel	Signature validation, short-lived tokens, quorum, out-of-band dashboard confirmation, alerting
High-risk invariants
No frontend input may authorize a backend privileged action by itself.

No backend job may execute without policy evaluation, simulation where applicable, and required approvals.

No signature may be accepted without domain, chain, expiry, nonce, and intent validation.

No contract deployment may be marked complete without on-chain bytecode verification.

No audit event may be silently mutated or deleted.

No embed origin may receive capabilities beyond its explicitly granted scope.

Observability and operations
Emit structured events for:

Wallet connect, disconnect, chain switch, consent grant/revoke.

Contract import, validation failure, approval, activation.

Balance/allowance scan start, completion, failure, and staleness.

Strategy creation, compilation, simulation, approval, execution, revert, and completion.

Permit2 signature request, verification, nonce use, expiry, and replay attempt.

CREATE2 prediction, deployment, verification, mismatch, and rollback.

Delegation creation, use, limit breach, revocation, and expiry.

Telegram approval request, callback, approval, rejection, expiry, and invalid signature.

Authentication failures, permission denials, rate-limit hits, and suspicious patterns.

Alert on:

Repeated signature-verification failures.

Unexpected contract upgrades or bytecode changes.

Unlimited approval creation.

High-value transfer attempts.

Telegram approval replay or quorum anomalies.

Relayer balance depletion.

Scanner data staleness beyond threshold.

Audit-chain hash discontinuity.

Final acceptance criteria
The system is production-ready when all of the following pass:

A user can connect through the canonical modal, grant scoped consent, and perform only authorized operations.

Contract JSON imports validate, version, index, and audit correctly.

Portfolio and allowance scans return source-attributed, freshness-labeled data across configured chains.

Strategies compile deterministically, simulate safely, display decoded intent, and enforce policy limits.

Permit2 transfers use valid EIP-712 signatures, deadlines, unique nonces, and witness binding where required.

Multicall batches expose per-call review, simulation, failure policy, and execution receipts.

The embed runtime is origin-scoped, sandboxed, versioned, and incapable of obtaining privileged host-side access.

EIP-712 messages include replay-resistant domain and intent data, and are verified server-side.

CREATE2 deployments compute, display, execute, and verify deterministic addresses.

Delegations are scoped, signed, time-bound, revocable, and enforced on every backend execution.

Telegram approvals are authenticated, single-use, quorum-aware, expiring, and fully audited.

Every security-relevant event is written to an append-only, hash-linked audit log.

Threat-model mitigations are tested, monitored, and documented in operational runbooks
