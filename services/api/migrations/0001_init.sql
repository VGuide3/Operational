-- Initial schema. Mirrors the data model in README.md.
-- PostgreSQL holds transactional operational data; Redis holds short-lived
-- cache and rate limits; audit_events is an append-only, hash-linked store.

-- Users and access -----------------------------------------------------------

create table if not exists users (
  id uuid primary key,
  external_id text unique,
  email text unique,
  role text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists wallet_links (
  id uuid primary key,
  user_id uuid references users(id),
  address text not null,
  chain_id integer not null,
  verified_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, address, chain_id)
);

create table if not exists roles (
  id text primary key,
  description text,
  permissions jsonb not null
);

create table if not exists user_roles (
  user_id uuid references users(id),
  role_id text references roles(id),
  granted_by uuid,
  granted_at timestamptz,
  primary key (user_id, role_id)
);

-- Consent records bind a session to a wallet, chain, and scope set. Changing
-- wallet, chain, or embed origin invalidates the prior record.
create table if not exists consents (
  consent_id uuid primary key,
  user_id uuid references users(id),
  wallet_address text not null,
  chain_id integer not null,
  app_origin text not null,
  embed_origin text,
  scopes jsonb not null,
  policy_version text not null,
  terms_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  revoked_at timestamptz
);

-- Contracts and tokens --------------------------------------------------------

create table if not exists contract_manifests (
  id uuid primary key,
  manifest_version text not null,
  submitted_by uuid references users(id),
  status text not null,
  source_hash text not null,
  created_at timestamptz not null
);

create table if not exists contracts (
  id uuid primary key,
  manifest_id uuid references contract_manifests(id),
  key text not null,
  name text not null,
  chain_id integer not null,
  address text not null,
  abi jsonb not null,
  abi_hash text not null,
  deployer text,
  tx_hash text,
  block_number bigint,
  verified boolean not null default false,
  verification jsonb,
  tags jsonb,
  risk jsonb,
  created_at timestamptz not null,
  unique (chain_id, address)
);

create table if not exists tokens (
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

-- Allowances are keyed by owner, token, spender, and chain.
create table if not exists allowances (
  id uuid primary key,
  owner text not null,
  token text not null,
  spender text not null,
  chain_id integer not null,
  allowance_raw numeric not null,
  allowance_is_max boolean not null,
  permit2_allowance jsonb,
  scanned_at timestamptz not null,
  source text not null,
  unique (owner, token, spender, chain_id)
);

-- Strategies and jobs ---------------------------------------------------------

create table if not exists strategies (
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

create table if not exists strategy_runs (
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

create table if not exists jobs (
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

-- Delegations are scoped, signed, time-bound, and revocable.
create table if not exists delegations (
  id uuid primary key,
  grantor text not null,
  delegate text not null,
  chain_id integer not null,
  scope jsonb not null,
  scope_hash text not null,
  signature text not null,
  status text not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null,
  revoked_at timestamptz
);

-- Deterministic deployments; artifacts are immutable.
create table if not exists deployments (
  id uuid primary key,
  chain_id integer not null,
  factory text not null,
  salt text not null,
  init_code_hash text not null,
  predicted_address text not null,
  deployed_address text,
  expected_bytecode_hash text not null,
  deployer text,
  tx_hash text,
  block_number bigint,
  status text not null,
  verification jsonb,
  created_at timestamptz not null,
  unique (chain_id, factory, salt, init_code_hash)
);

-- Audit log -------------------------------------------------------------------

-- Append-only and hash-linked: event_hash is computed from canonical fields
-- plus prev_event_hash. Events are never updated or deleted.
create table if not exists audit_events (
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

create index if not exists audit_events_action_idx on audit_events (action);
create index if not exists audit_events_resource_idx on audit_events (resource_type, resource_id);
create index if not exists audit_events_occurred_at_idx on audit_events (occurred_at);

-- Deny mutation of the audit store.
create or replace rule audit_events_no_update as on update to audit_events do instead nothing;
create or replace rule audit_events_no_delete as on delete to audit_events do instead nothing;
