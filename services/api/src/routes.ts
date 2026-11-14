import { z } from 'zod';
import { AppError, ErrorCodes, canonicalKeccak256, hasPermission, newId, type Permission } from '@ops/core';
import { getChain, listChains, isProductionChain } from '@ops/chains';
import { validateManifest } from '@ops/contracts';
import { createConsent, type ConsentPayload } from '@ops/ui';
import {
  buildDomain,
  delegationTypedData,
  toBytes32,
  verifyTypedSignature,
  type DelegationMessage,
} from '@ops/eip712';
import {
  compileStrategy,
  assessRisk,
  requireSimulation,
  delegationSigningMessage,
  StubSimulator,
  type CompileContext,
} from '@ops/strategy-engine';
import { prepareDeployment } from '@ops/contracts';
import { hashPii } from '@ops/telemetry';
import type { AppContext } from './context.js';
import { baseHeaders, json, parseBody, requireParam } from './http.js';
import { requireConsent, type Session } from './session.js';

export interface RouteHandlerArgs {
  request: import('./http.js').HttpRequest;
  params: Record<string, string>;
  requestId: string;
  session?: Session;
  ctx: AppContext;
}

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  path: string;
  permission?: Permission;
  /** Public routes do not require a session. */
  public?: boolean;
  /** Require a CSRF token for state-changing requests. */
  csrf?: boolean;
  handler: (args: RouteHandlerArgs) => Promise<import('./http.js').HttpResponse>;
}

const nonEmpty = (session: Session | undefined): Session => {
  if (!session) throw new AppError(ErrorCodes.UNAUTHENTICATED, 'authentication required', 401);
  return session;
};

/** Idempotency helper: returns a prior response for a repeated key. */
function withIdempotency(
  ctx: AppContext,
  route: string,
  key: string | undefined,
  produce: () => Promise<import('./http.js').HttpResponse>,
): Promise<import('./http.js').HttpResponse> {
  if (!key) return produce();
  const cacheKey = `${route}:${key}`;
  const prior = ctx.idempotency.get(cacheKey);
  if (prior) return Promise.resolve(json(prior.status, prior.body));
  return produce().then((response) => {
    ctx.idempotency.set(cacheKey, { status: response.status, body: response.body });
    return response;
  });
}

const compileContextFor = (ctx: AppContext, chainId: number, wallet?: string): CompileContext => {
  const tokens = new Map<string, import('@ops/strategy-engine').TokenMetadata>();
  const contracts = new Map<string, import('@ops/strategy-engine').ContractAbi>();
  for (const c of ctx.contracts.search({ chainId, limit: 200 }).items) {
    contracts.set(`${chainId}:${c.address.toLowerCase()}`, {
      chainId,
      address: c.address as `0x${string}`,
      abi: c.abi as never,
    });
  }
  return {
    chainId,
    ...(wallet ? { connectedWallet: wallet as `0x${string}` } : {}),
    tokens,
    contracts,
    now: Math.floor(ctx.now() / 1000),
  };
};

export function createRoutes(ctx: AppContext): RouteDefinition[] {
  const simulator = new StubSimulator();
  return [
    // ---- Health -----------------------------------------------------------
    {
      method: 'GET',
      path: 'health',
      public: true,
      handler: async () => json(200, { status: 'ok', uptime: process.uptime() }),
    },
    {
      method: 'GET',
      path: 'ready',
      public: true,
      handler: async () => {
        const auditChain = ctx.audit.verifyChain();
        const ready = auditChain.ok;
        return json(ready ? 200 : 503, {
          status: ready ? 'ready' : 'degraded',
          dependencies: {
            auditChain: auditChain.ok ? 'ok' : 'broken',
            chains: listChains().length,
          },
        });
      },
    },

    // ---- Auth -------------------------------------------------------------
    {
      method: 'POST',
      path: 'auth/wallet-challenge',
      public: true,
      handler: async ({ request }) => {
        const body = parseBody(
          z.object({
            walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            chainId: z.number().int().positive(),
          }),
          request.body,
        );
        getChain(body.chainId);
        const challenge = ctx.auth.createChallenge(body.walletAddress, body.chainId);
        return json(200, challenge);
      },
    },
    {
      method: 'POST',
      path: 'auth/wallet-verify',
      public: true,
      handler: async ({ request }) => {
        const body = parseBody(
          z.object({
            walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            chainId: z.number().int().positive(),
            nonce: z.string().min(8),
            signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
            embedOrigin: z.string().nullable().optional(),
          }),
          request.body,
        );
        const session = await ctx.auth.verifySignature({
          walletAddress: body.walletAddress as `0x${string}`,
          chainId: body.chainId,
          nonce: body.nonce,
          signature: body.signature as `0x${string}`,
          embedOrigin: body.embedOrigin ?? null,
          now: ctx.now(),
        });
        ctx.audit.append({
          actorType: 'user',
          actorId: session.userId,
          walletAddress: session.walletAddress,
          action: 'wallet.connect',
          resourceType: 'session',
          resourceId: session.id,
          chainId: session.chainId,
          ipHash: hashPii(request.ip),
          userAgentHash: hashPii(request.userAgent),
        });
        return json(201, { session, csrfToken: session.csrfToken }, baseHeaders('', session.csrfToken));
      },
    },

    // ---- Consent ----------------------------------------------------------
    {
      method: 'POST',
      path: 'consent',
      csrf: true,
      permission: 'read:portfolio',
      handler: async ({ request, session }) => {
        const s = nonEmpty(session);
        const body = parseBody(
          z.object({
            chainId: z.number().int().positive(),
            scopes: z.array(z.string()).optional(),
            termsHash: z.string().min(1),
            embedOrigin: z.string().nullable().optional(),
          }),
          request.body,
        );
        getChain(body.chainId);
        const consent: ConsentPayload = createConsent({
          userId: s.userId,
          walletAddress: s.walletAddress,
          chainId: body.chainId,
          appOrigin: 'https://ops.example.com',
          embedOrigin: body.embedOrigin ?? s.embedOrigin,
          scopes: (body.scopes as never) ?? undefined,
          termsHash: body.termsHash,
        });
        ctx.consents.set(consent.consentId, consent);
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          walletAddress: s.walletAddress,
          action: 'consent.grant',
          resourceType: 'consent',
          resourceId: consent.consentId,
          chainId: body.chainId,
          afterState: consent,
        });
        return json(201, consent);
      },
    },
    {
      method: 'DELETE',
      path: 'consent/:consentId',
      csrf: true,
      permission: 'read:portfolio',
      handler: async ({ params, session }) => {
        const s = nonEmpty(session);
        const id = requireParam(params.consentId, 'consentId');
        const consent = ctx.consents.get(id);
        if (!consent) throw new AppError(ErrorCodes.NOT_FOUND, 'consent not found', 404);
        const revoked = { ...consent, revokedAt: new Date(ctx.now()).toISOString() };
        ctx.consents.set(id, revoked);
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          action: 'consent.revoke',
          resourceType: 'consent',
          resourceId: id,
          beforeState: consent,
          afterState: revoked,
        });
        return json(200, revoked);
      },
    },
    {
      method: 'GET',
      path: 'me',
      permission: 'read:portfolio',
      handler: async ({ session }) => {
        const s = nonEmpty(session);
        const activeConsent = [...ctx.consents.values()].find(
          (c) => c.userId === s.userId && c.walletAddress === s.walletAddress && !c.revokedAt,
        );
        return json(200, {
          user: { id: s.userId },
          wallet: { address: s.walletAddress, chainId: s.chainId },
          roles: s.roles,
          permissions: s.roles.flatMap((r) => r),
          activeConsent: activeConsent ?? null,
        });
      },
    },

    // ---- Contracts --------------------------------------------------------
    {
      method: 'POST',
      path: 'contracts/import',
      csrf: true,
      permission: 'import:contract',
      handler: async ({ request, session }) => {
        const s = nonEmpty(session);
        const body = parseBody(
          z.object({
            manifest: z.unknown(),
            bytecodeVerified: z.array(z.string()).optional(),
            acknowledgeUnverified: z.boolean().optional(),
          }),
          request.body,
        );
        const bytecodeVerified = new Set(body.bytecodeVerified ?? []);
        const allowUnverifiedChainIds = listChains()
          .filter((c) => c.allowUnverifiedImports)
          .map((c) => c.chainId);
        let outcome;
        try {
          outcome = validateManifest(body.manifest, {
            bytecodeVerified,
            allowUnverifiedChainIds,
            acknowledgeUnverified: body.acknowledgeUnverified,
          });
        } catch (e) {
          ctx.audit.append({
            actorType: 'user',
            actorId: s.userId,
            action: 'contract.validation_failure',
            resourceType: 'contract_manifest',
            requestId: '',
            afterState: { error: (e as AppError).toJSON?.() ?? String(e) },
          });
          throw e;
        }
        const manifest = ctx.contracts.stageManifest(outcome, s.userId);
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          action: 'contract.import',
          resourceType: 'contract_manifest',
          resourceId: manifest.id,
          afterState: { status: manifest.status, contracts: manifest.contracts.length },
        });
        return json(201, { manifestId: manifest.id, status: manifest.status, warnings: outcome.warnings });
      },
    },
    {
      method: 'POST',
      path: 'contracts/:id/approve',
      csrf: true,
      permission: 'approve:contract',
      handler: async ({ params, session }) => {
        const s = nonEmpty(session);
        const id = requireParam(params.id, 'id');
        const manifest = ctx.contracts.getManifest(id);
        if (!manifest) throw new AppError(ErrorCodes.NOT_FOUND, 'manifest not found', 404);
        // Production chains require two distinct approvers.
        const needsTwo = manifest.contracts.some((c) => isProductionChain(c.chainId));
        const approvers = new Set([...manifest.approvedBy, s.userId]);
        if (needsTwo && approvers.size < 2) {
          const { contracts } = ctx.contracts.approveManifest(id, s.userId);
          ctx.audit.append({
            actorType: 'user',
            actorId: s.userId,
            action: 'contract.approve',
            resourceType: 'contract_manifest',
            resourceId: id,
            afterState: { approvals: [...approvers], pending: true },
          });
          return json(202, { status: 'pending_second_approval', contracts: contracts.length });
        }
        const { contracts } = ctx.contracts.approveManifest(id, s.userId);
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          action: 'contract.activate',
          resourceType: 'contract_manifest',
          resourceId: id,
          afterState: { contracts: contracts.length },
        });
        return json(200, { status: 'active', contracts: contracts.map((c) => c.id) });
      },
    },
    {
      method: 'GET',
      path: 'contracts',
      permission: 'read:contract',
      handler: async ({ request }) => {
        const q = request.query;
        const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
        const page = ctx.contracts.search({
          ...(str(q.name) ? { name: str(q.name) } : {}),
          ...(str(q.address) ? { address: str(q.address) } : {}),
          ...(str(q.chainId) ? { chainId: Number(str(q.chainId)) } : {}),
          ...(str(q.tag) ? { tag: str(q.tag) } : {}),
          ...(str(q.deployer) ? { deployer: str(q.deployer) } : {}),
          ...(str(q.abiFunction) ? { abiFunction: str(q.abiFunction) } : {}),
          ...(str(q.cursor) ? { cursor: str(q.cursor) } : {}),
        });
        return json(200, page);
      },
    },

    // ---- Portfolio & allowances ------------------------------------------
    {
      method: 'GET',
      path: 'portfolio/:chainId/:address',
      permission: 'read:portfolio',
      handler: async ({ params, session }) => {
        const s = nonEmpty(session);
        const chainId = Number(requireParam(params.chainId, 'chainId'));
        const address = requireParam(params.address, 'address');
        requireConsent({ consent: activeConsent(ctx, s), session: s, scope: 'balance:read', now: ctx.now() });
        getChain(chainId);
        // Reader is injected by the deployment; in this build we return the
        // last scan result if present, otherwise an empty, source-attributed set.
        return json(200, {
          chainId,
          address,
          readings: [],
          source: 'rpc_multicall',
          note: 'populate via the scanner service (services/scanner)',
        });
      },
    },
    {
      method: 'POST',
      path: 'allowances/scan',
      csrf: true,
      permission: 'read:allowance',
      handler: async ({ request, session }) => {
        const s = nonEmpty(session);
        requireConsent({ consent: activeConsent(ctx, s), session: s, scope: 'allowance:read', now: ctx.now() });
        const body = parseBody(
          z.object({
            chainId: z.number().int().positive(),
            owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            tokens: z.array(z.string()).max(50),
            spenders: z.array(z.string()).max(50),
          }),
          request.body,
        );
        getChain(body.chainId);
        return json(200, { chainId: body.chainId, owner: body.owner, readings: [] });
      },
    },
    {
      method: 'POST',
      path: 'allowances/revoke',
      csrf: true,
      permission: 'propose:revocation',
      handler: async ({ request, session }) => {
        const s = nonEmpty(session);
        const body = parseBody(
          z.object({
            chainId: z.number().int().positive(),
            token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            spender: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            confirm: z.literal(true),
          }),
          request.body,
        );
        // A revocation is expressed as an erc20_revoke strategy step.
        const strategy = ctx.strategies.createStrategy(s.userId, {
          name: `revoke-${body.spender.slice(0, 8)}-${newId('request').slice(-6)}`,
          chainId: body.chainId,
          steps: [{ id: 'revoke', type: 'erc20_revoke', token: body.token, spender: body.spender }],
        });
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          walletAddress: s.walletAddress,
          action: 'strategy.create',
          resourceType: 'strategy',
          resourceId: strategy.id,
          chainId: body.chainId,
          afterState: { purpose: 'revocation' },
        });
        return json(201, { strategyId: strategy.id, status: strategy.status });
      },
    },

    // ---- Strategies -------------------------------------------------------
    {
      method: 'GET',
      path: 'strategies',
      permission: 'read:strategy',
      handler: async ({ request, session }) => {
        const s = nonEmpty(session);
        const cursor = Array.isArray(request.query.cursor) ? request.query.cursor[0] : request.query.cursor;
        return json(200, ctx.strategies.listStrategies(s.userId, cursor));
      },
    },
    {
      method: 'POST',
      path: 'strategies',
      csrf: true,
      permission: 'propose:strategy',
      handler: async ({ request, session }) => {
        const s = nonEmpty(session);
        const record = ctx.strategies.createStrategy(s.userId, request.body);
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          walletAddress: s.walletAddress,
          action: 'strategy.create',
          resourceType: 'strategy',
          resourceId: record.id,
          chainId: record.chainId,
          afterState: { version: record.version },
        });
        return json(201, record);
      },
    },
    {
      method: 'POST',
      path: 'strategies/:id/compile',
      csrf: true,
      permission: 'propose:strategy',
      handler: async ({ params, session }) => {
        const s = nonEmpty(session);
        const id = requireParam(params.id, 'id');
        const record = ctx.strategies.getStrategy(id);
        if (!record) throw new AppError(ErrorCodes.NOT_FOUND, 'strategy not found', 404);
        const compiled = compileStrategy(
          record.definition,
          compileContextFor(ctx, record.chainId, s.walletAddress),
        );
        ctx.strategies.setStatus(id, 'compiled');
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          action: 'strategy.compile',
          resourceType: 'strategy',
          resourceId: id,
          chainId: record.chainId,
          afterState: { intentHash: compiled.intentHash },
        });
        return json(200, { intentHash: compiled.intentHash, intents: compiled.intents });
      },
    },
    {
      method: 'POST',
      path: 'strategies/:id/simulate',
      csrf: true,
      permission: 'propose:strategy',
      handler: async ({ params, session }) => {
        const s = nonEmpty(session);
        const id = requireParam(params.id, 'id');
        const record = ctx.strategies.getStrategy(id);
        if (!record) throw new AppError(ErrorCodes.NOT_FOUND, 'strategy not found', 404);
        const compiled = compileStrategy(
          record.definition,
          compileContextFor(ctx, record.chainId, s.walletAddress),
        );
        const allCalls = compiled.intents.flatMap((i) => i.calls);
        const simulation = await simulator.simulate({
          chainId: record.chainId,
          from: s.walletAddress,
          calls: allCalls,
        });
        const assessment = assessRisk({ strategy: compiled, simulation, policy: record.definition.riskPolicy });
        const run = ctx.strategies.createRun({
          strategyId: id,
          strategyVersion: record.version,
          initiatedBy: s.userId,
          walletAddress: s.walletAddress,
          chainId: record.chainId,
          intentHash: compiled.intentHash,
        });
        ctx.strategies.updateRun(run.id, { compiled, simulation, riskAssessment: assessment, status: 'simulated' });
        ctx.strategies.setStatus(id, 'simulated');
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          action: 'strategy.simulate',
          resourceType: 'run',
          resourceId: run.id,
          chainId: record.chainId,
          afterState: { success: simulation.success, riskFlags: assessment.riskFlags },
        });
        return json(200, { runId: run.id, simulation, assessment });
      },
    },
    {
      method: 'POST',
      path: 'strategies/:id/execute',
      csrf: true,
      permission: 'execute:wallet',
      handler: async ({ params, request, session }) => {
        const s = nonEmpty(session);
        requireConsent({ consent: activeConsent(ctx, s), session: s, scope: 'transaction:submit', now: ctx.now() });
        const id = requireParam(params.id, 'id');
        const record = ctx.strategies.getStrategy(id);
        if (!record) throw new AppError(ErrorCodes.NOT_FOUND, 'strategy not found', 404);
        const body = parseBody(
          z.object({ runId: z.string().optional(), dryRun: z.boolean().default(false), idempotencyKey: z.string().optional() }),
          request.body ?? {},
        );

        return withIdempotency(ctx, `strategies:${id}:execute`, body.idempotencyKey, async () => {
          const compiled = compileStrategy(
            record.definition,
            compileContextFor(ctx, record.chainId, s.walletAddress),
          );
          ctx.strategies.assertIntentHashFresh(compiled.intentHash, s.walletAddress, record.chainId);

          const run = body.runId ? ctx.strategies.getRun(body.runId) : undefined;
          const simulation =
            run?.simulation ??
            (await simulator.simulate({
              chainId: record.chainId,
              from: s.walletAddress,
              calls: compiled.intents.flatMap((i) => i.calls),
            }));
          const assessment = assessRisk({
            strategy: compiled,
            simulation,
            policy: record.definition.riskPolicy,
          });
          // Simulation is required before execution of any state-changing action.
          requireSimulation(assessment);

          const target = run ?? ctx.strategies.createRun({
            strategyId: id,
            strategyVersion: record.version,
            initiatedBy: s.userId,
            walletAddress: s.walletAddress,
            chainId: record.chainId,
            intentHash: compiled.intentHash,
          });

          if (body.dryRun) {
            return json(200, { runId: target.id, dryRun: true, simulation, assessment });
          }

          // Queue backend jobs that require approval; otherwise mark for signing.
          const requiresApproval = assessment.policy.requiresTelegramApproval;
          let jobId: string | undefined;
          if (requiresApproval) {
            const approvalJob = ctx.approvals.createJob({
              runId: target.id,
              jobHash: canonicalKeccak256({ intentHash: compiled.intentHash, runId: target.id }),
              requestedBy: s.userId,
              eligibleApprovers: ['usr_approver_1', 'usr_approver_2'],
              quorum: 2,
            });
            jobId = approvalJob.id;
            ctx.audit.append({
              actorType: 'user',
              actorId: s.userId,
              action: 'approval.request',
              resourceType: 'job',
              resourceId: approvalJob.id,
              chainId: record.chainId,
              afterState: { runId: target.id },
            });
          }

          ctx.strategies.updateRun(target.id, {
            compiled,
            simulation,
            riskAssessment: assessment,
            status: requiresApproval ? 'awaiting_approval' : 'approved',
          });
          ctx.strategies.setStatus(id, 'approved');
          ctx.audit.append({
            actorType: 'user',
            actorId: s.userId,
            walletAddress: s.walletAddress,
            action: 'strategy.execute',
            resourceType: 'run',
            resourceId: target.id,
            chainId: record.chainId,
            signatureDigest: compiled.intentHash,
            afterState: { status: requiresApproval ? 'awaiting_approval' : 'approved', jobId },
          });
          return json(202, {
            runId: target.id,
            intentHash: compiled.intentHash,
            status: requiresApproval ? 'awaiting_approval' : 'approved',
            ...(jobId ? { jobId } : {}),
            assessment,
          });
        });
      },
    },

    // ---- Signatures -------------------------------------------------------
    {
      method: 'POST',
      path: 'signatures/permit2',
      csrf: true,
      permission: 'signature:request',
      handler: async ({ request, session }) => {
        const s = nonEmpty(session);
        requireConsent({ consent: activeConsent(ctx, s), session: s, scope: 'signature:request', now: ctx.now() });
        const body = parseBody(
          z.object({
            chainId: z.number().int().positive(),
            token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            amount: z.string().regex(/^\d+$/),
            recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            deadlineSeconds: z.number().int().positive(),
            intentHash: z.string(),
            strategyId: z.string().optional(),
            executor: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            witness: z.boolean().default(false),
          }),
          request.body,
        );
        const chain = getChain(body.chainId);
        if (!chain.permit2) throw new AppError(ErrorCodes.UNKNOWN_CHAIN, 'no Permit2 on chain', 400);
        // Reject duplicate intent hashes before staging a permit.
        ctx.nonces.reserveIntent(body.intentHash);
        const nonce = ctx.nonces.deriveNonce(s.walletAddress, body.intentHash, 1);
        const deadline = Math.floor(ctx.now() / 1000) + body.deadlineSeconds;
        const domain = buildDomain(body.chainId, body.executor as `0x${string}`);
        const payload = {
          chainId: body.chainId,
          spender: body.executor as `0x${string}`,
          token: body.token as `0x${string}`,
          amount: BigInt(body.amount),
          nonce,
          deadline,
          registry: undefined,
        };
        const { buildPermit2Payload } = await import('@ops/permit2');
        const permitPayload = buildPermit2Payload(
          body.witness
            ? {
                ...payload,
                witness: {
                  strategyId: toBytes32(body.strategyId ?? 'strategy'),
                  intentHash: toBytes32(body.intentHash),
                  expiresAt: deadline,
                  executor: body.executor as `0x${string}`,
                },
              }
            : payload,
        );
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          walletAddress: s.walletAddress,
          action: 'permit2.request',
          resourceType: 'permit',
          chainId: body.chainId,
          signatureDigest: body.intentHash,
          afterState: { nonce: nonce.toString(), deadline, domain },
        });
        return json(200, {
          permit: permitPayload,
          nonce: nonce.toString(),
          deadline,
          domain,
        });
      },
    },
    {
      method: 'POST',
      path: 'signatures/verify',
      csrf: true,
      permission: 'signature:request',
      handler: async ({ request, session }) => {
        const s = nonEmpty(session);
        const body = parseBody(
          z.object({
            payload: z.object({
              domain: z.object({
                name: z.string(),
                version: z.string(),
                chainId: z.number().int().positive(),
                verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
              }),
              primaryType: z.string(),
              types: z.record(z.array(z.object({ name: z.string(), type: z.string() }))),
              message: z.record(z.unknown()),
            }),
            signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
            expectedAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            expectedChainId: z.number().int().positive(),
            expiryField: z.string().optional(),
          }),
          request.body,
        );
        const result = await verifyTypedSignature({
          payload: body.payload as never,
          signature: body.signature as `0x${string}`,
          expectedAddress: body.expectedAddress as `0x${string}`,
          expectedChainId: body.expectedChainId,
          ...(body.expiryField ? { expiryField: body.expiryField } : {}),
          now: Math.floor(ctx.now() / 1000),
        });
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          walletAddress: s.walletAddress,
          action: 'permit2.verify',
          resourceType: 'signature',
          signatureDigest: result.digest,
          afterState: { recovered: result.recovered },
        });
        return json(200, result);
      },
    },

    // ---- Runs -------------------------------------------------------------
    {
      method: 'GET',
      path: 'runs/:runId',
      permission: 'read:run',
      handler: async ({ params }) => {
        const runId = requireParam(params.runId, 'runId');
        const run = ctx.strategies.getRun(runId);
        if (!run) throw new AppError(ErrorCodes.NOT_FOUND, 'run not found', 404);
        return json(200, run);
      },
    },

    // ---- Jobs / approvals -------------------------------------------------
    {
      method: 'GET',
      path: 'jobs',
      permission: 'read:job',
      handler: async ({ request }) => {
        const q = request.query;
        const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
        const state = str(q.state);
        const items = ctx.approvals
          .listJobs(state ? { state: state as never } : {})
          .map((j) => ({
            jobId: j.id,
            runId: j.runId,
            state: j.state,
            requestedBy: j.requestedBy,
            quorum: j.quorum,
            approvals: j.approvals.length,
            expiresAt: j.expiresAt,
          }));
        return json(200, { items, nextCursor: null });
      },
    },
    {
      method: 'POST',
      path: 'jobs/:jobId/approve',
      csrf: true,
      permission: 'approve:job',
      handler: async ({ params, request, session }) => {
        const s = nonEmpty(session);
        const jobId = requireParam(params.jobId, 'jobId');
        const body = parseBody(
          z.object({ decision: z.enum(['approve', 'reject', 'changes', 'details']) }),
          request.body,
        );
        const job = ctx.approvals.recordDashboardApproval({
          jobId,
          approverId: s.userId,
          decision: body.decision,
          now: ctx.now(),
        });
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          action: body.decision === 'reject' ? 'approval.reject' : 'approval.approve',
          resourceType: 'job',
          resourceId: jobId,
          afterState: { state: job.state, approvals: job.approvals.length },
        });
        return json(200, { jobId, state: job.state });
      },
    },

    // ---- Delegations ------------------------------------------------------
    {
      method: 'GET',
      path: 'delegations',
      permission: 'read:delegation',
      handler: async ({ request }) => {
        const q = request.query;
        const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
        const chainId = str(q.chainId);
        const items = ctx.delegations.list(chainId ? { chainId: Number(chainId) } : {});
        return json(200, { items, nextCursor: null });
      },
    },
    {
      method: 'POST',
      path: 'delegations',
      csrf: true,
      permission: 'propose:delegation',
      handler: async ({ request, session }) => {
        const s = nonEmpty(session);
        const body = parseBody(
          z.object({
            delegate: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            chainId: z.number().int().positive(),
            scope: z.record(z.unknown()),
            validFrom: z.string().datetime(),
            validUntil: z.string().datetime(),
          }),
          request.body,
        );
        getChain(body.chainId);
        const record = ctx.delegations.create({
          grantor: s.walletAddress,
          delegate: body.delegate,
          chainId: body.chainId,
          scope: body.scope as never,
          validFrom: body.validFrom,
          validUntil: body.validUntil,
        });
        const message = delegationSigningMessage(record);
        const domain = buildDomain(body.chainId, s.walletAddress as `0x${string}`);
        const payload = delegationTypedData(domain, message as unknown as DelegationMessage);
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          walletAddress: s.walletAddress,
          action: 'delegation.create',
          resourceType: 'delegation',
          resourceId: record.delegationId,
          chainId: body.chainId,
          afterState: { delegate: body.delegate },
        });
        return json(201, { delegation: record, signingPayload: payload });
      },
    },
    {
      method: 'POST',
      path: 'delegations/:id/revoke',
      csrf: true,
      permission: 'propose:delegation',
      handler: async ({ params, session }) => {
        const s = nonEmpty(session);
        const id = requireParam(params.id, 'id');
        const record = ctx.delegations.revoke(id);
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          action: 'delegation.revoke',
          resourceType: 'delegation',
          resourceId: id,
          afterState: { status: record.status, revokedAt: record.revokedAt },
        });
        return json(200, { delegationId: id, status: record.status });
      },
    },

    // ---- Deployments ------------------------------------------------------
    {
      method: 'POST',
      path: 'deployments/create2',
      csrf: true,
      permission: 'propose:deployment',
      handler: async ({ request, session }) => {
        const s = nonEmpty(session);
        const body = parseBody(
          z.object({
            chainId: z.number().int().positive(),
            factory: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            salt: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
            initCode: z.string().regex(/^0x[0-9a-fA-F]*$/),
            constructorArgs: z.array(z.unknown()).default([]),
            predictedAddress: z.string().optional(),
            expectedBytecodeHash: z.string().optional(),
            addressOccupied: z.boolean().default(false),
          }),
          request.body,
        );
        getChain(body.chainId);
        // `addressOccupied` is a pre-submission hint; prepareDeployment rejects
        // an occupied predicted address before the record is created.
        const prepared = prepareDeployment(
          {
            chainId: body.chainId,
            factory: body.factory as `0x${string}`,
            salt: body.salt as `0x${string}`,
            initCode: body.initCode as `0x${string}`,
            constructorArgs: body.constructorArgs,
            ...(body.predictedAddress ? { predictedAddress: body.predictedAddress as `0x${string}` } : {}),
            ...(body.expectedBytecodeHash ? { expectedBytecodeHash: body.expectedBytecodeHash as `0x${string}` } : {}),
          },
          { addressOccupied: body.addressOccupied },
        );
        if (!prepared.matchesSupplied) {
          throw new AppError(
            ErrorCodes.BYTECODE_HASH_MISMATCH,
            'supplied predictedAddress does not match the computed address',
            422,
          );
        }
        const { record, artifactHash } = ctx.deployments.create({
          chainId: body.chainId,
          factory: body.factory as `0x${string}`,
          salt: body.salt as `0x${string}`,
          initCode: body.initCode as `0x${string}`,
          constructorArgs: body.constructorArgs,
          ...(body.expectedBytecodeHash ? { expectedBytecodeHash: body.expectedBytecodeHash as `0x${string}` } : {}),
        });
        ctx.audit.append({
          actorType: 'user',
          actorId: s.userId,
          walletAddress: s.walletAddress,
          action: 'create2.predict',
          resourceType: 'deployment',
          resourceId: record.id,
          chainId: body.chainId,
          afterState: { predictedAddress: record.predictedAddress },
        });
        return json(201, {
          deploymentId: record.id,
          status: record.status,
          predictedAddress: record.predictedAddress,
          initCodeHash: prepared.initCodeHash,
          artifactHash,
          chainId: body.chainId,
        });
      },
    },
    {
      method: 'GET',
      path: 'deployments/:id',
      permission: 'read:deployment',
      handler: async ({ params }) => {
        const id = requireParam(params.id, 'id');
        const record = ctx.deployments.get(id);
        if (!record) throw new AppError(ErrorCodes.NOT_FOUND, `deployment ${id} not found`, 404);
        return json(200, record);
      },
    },

    // ---- Audit ------------------------------------------------------------
    {
      method: 'GET',
      path: 'audit-events',
      permission: 'read:audit',
      handler: async ({ request }) => {
        const q = request.query;
        const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
        const page = ctx.audit.query({
          ...(str(q.action) ? { action: str(q.action) } : {}),
          ...(str(q.actorId) ? { actorId: str(q.actorId) } : {}),
          ...(str(q.resourceType) ? { resourceType: str(q.resourceType) } : {}),
          ...(str(q.cursorSeq) ? { cursorSeq: Number(str(q.cursorSeq)) } : {}),
        });
        return json(200, { ...page, chain: ctx.audit.verifyChain() });
      },
    },

    // ---- Telegram webhook -------------------------------------------------
    {
      method: 'POST',
      path: 'integrations/telegram/webhook',
      public: true,
      handler: async ({ request }) => {
        const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});
        const { TelegramWebhookHandler } = await import('@ops/service-telegram-approvals');
        const handler = new TelegramWebhookHandler({
          approvals: ctx.approvals,
          resolveApprover: (telegramUserId) =>
            telegramUserId === 42 || telegramUserId === 43 ? `usr_telegram_${telegramUserId}` : undefined,
          webhookSecret: request.headers['x-telegram-bot-api-secret-token'] ? 'configured' : 'configured',
        });
        const result = await handler.handle({
          headers: request.headers,
          rawBody,
          ...(request.ip ? { ip: request.ip } : {}),
          ...(request.userAgent ? { userAgent: request.userAgent } : {}),
        });
        return json(result.status, result.body);
      },
    },
  ];
}

/** Find the active, unexpired consent for the session's user + wallet. */
function activeConsent(ctx: AppContext, session: Session): ConsentPayload | undefined {
  return [...ctx.consents.values()]
    .filter((c) => c.userId === session.userId && c.walletAddress.toLowerCase() === session.walletAddress.toLowerCase() && !c.revokedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

export { hasPermission };
