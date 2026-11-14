import { getAddress, isAddress, keccak256, toHex } from 'viem';
import { z } from 'zod';
import { isSupportedChain } from '@ops/chains';
import { AppError, ErrorCodes, canonicalKeccak256, type ErrorDetail } from '@ops/core';

/**
 * Contract Manifest format (versioned) validated with Zod on client and server.
 * See README "Contract import via JSON".
 */

export const KNOWN_ABI_ENTRY_TYPES = [
  'function',
  'constructor',
  'event',
  'error',
  'fallback',
  'receive',
] as const;

export const SUPPORTED_MANIFEST_VERSIONS = ['1.0.0'] as const;

const checksummedAddress = z
  .string()
  .refine((v) => isAddress(v), 'not a valid address')
  .transform((v) => getAddress(v))
  .refine((v) => v === getAddress(v), 'address must be checksummed');

export const AbiSource = z.object({
  type: z.enum(['etherscan_v2', 'sourcify', 'manual', 'solc_output']),
  url: z.string().url().optional(),
});

export const AbiEntry = z
  .object({
    type: z.string(),
    name: z.string().optional(),
    inputs: z.array(z.any()).optional(),
    outputs: z.array(z.any()).optional(),
    stateMutability: z.string().optional(),
    anonymous: z.boolean().optional(),
  })
  .passthrough()
  .refine(
    (entry) => (KNOWN_ABI_ENTRY_TYPES as readonly string[]).includes(entry.type),
    (entry) => ({ message: `unknown ABI entry type: ${entry.type}` }),
  );

export const ContractRisk = z.object({
  owner: checksummedAddress.optional(),
  upgradeable: z.boolean().optional(),
  proxyImplementation: checksummedAddress.optional(),
  notes: z.string().optional(),
});

export const ContractEntry = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/, 'key must be lowercase alphanumeric with - or _'),
  name: z.string().min(1),
  chainId: z.number().int().positive(),
  address: checksummedAddress,
  abi: z.array(AbiEntry).min(1, 'abi must contain at least one entry'),
  abiSource: AbiSource.optional(),
  deployer: checksummedAddress.optional(),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  blockNumber: z.number().int().nonnegative().optional(),
  verified: z.boolean(),
  tags: z.array(z.string()).default([]),
  risk: ContractRisk.optional(),
  /** Marks an intentional (chainId, address) alias for a known contract. */
  alias: z.boolean().default(false),
  /** Compiler + verification provenance for verified-source imports. */
  verification: z
    .object({
      compilerVersion: z.string().optional(),
      sourceHash: z.string().optional(),
      provider: z.string().optional(),
      verifiedAt: z.string().datetime().optional(),
    })
    .optional(),
});

export const ContractManifest = z.object({
  manifestVersion: z.string().refine(
    (v) => (SUPPORTED_MANIFEST_VERSIONS as readonly string[]).includes(v),
    (v) => ({ message: `unsupported manifestVersion: ${v}` }),
  ),
  contracts: z.array(ContractEntry).min(1),
});

export type ContractEntry = z.infer<typeof ContractEntry>;
export type ContractManifest = z.infer<typeof ContractManifest>;

/** Canonical ABI hash used for immutability and revision detection. */
export function abiHash(abi: unknown): string {
  return canonicalKeccak256(abi);
}

export function contractHash(entry: Pick<ContractEntry, 'chainId' | 'address' | 'abi'>): string {
  return keccak256(
    toHex(
      JSON.stringify({ chainId: entry.chainId, address: entry.address.toLowerCase(), abi: entry.abi }),
    ),
  );
}

export interface ValidationOptions {
  /** Chains with bytecode verified via RPC/indexer. */
  bytecodeVerified?: Set<string>; // `${chainId}:${address.toLowerCase()}`
  /** Chains the operator is allowed to import unverified contracts on. */
  allowUnverifiedChainIds?: number[];
  /** Whether the submitter has explicitly acknowledged unverified risk. */
  acknowledgeUnverified?: boolean;
  /** Existing (chainId:address) pairs, for duplicate detection. */
  existing?: Set<string>;
}

export interface ValidatedContract extends ContractEntry {
  abiHash: string;
  contractHash: string;
  sourceHash: string;
}

export interface ValidationOutcome {
  manifestVersion: string;
  contracts: ValidatedContract[];
  /** Non-fatal warnings surfaced to the operator. */
  warnings: string[];
}

function fail(details: ErrorDetail[]): never {
  throw new AppError(ErrorCodes.VALIDATION_FAILED, 'manifest validation failed', 422, details);
}

/**
 * Validate a manifest document. Field-level errors are aggregated so the
 * operator sees everything wrong at once; nothing is partially persisted.
 */
export function validateManifest(input: unknown, options: ValidationOptions = {}): ValidationOutcome {
  const parsed = ContractManifest.safeParse(input);
  if (!parsed.success) {
    const details: ErrorDetail[] = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    fail(details);
  }

  const manifest = parsed.data;
  const warnings: string[] = [];
  const seen = new Map<string, string>();
  const contracts: ValidatedContract[] = [];
  const allowUnverified = new Set(options.allowUnverifiedChainIds ?? []);

  for (const [i, entry] of manifest.contracts.entries()) {
    const prefix = `contracts.${i}`;
    if (!isSupportedChain(entry.chainId)) {
      fail([{ path: `${prefix}.chainId`, message: `unsupported chainId: ${entry.chainId}` }]);
    }

    const pair = `${entry.chainId}:${entry.address.toLowerCase()}`;
    const priorKey = seen.get(pair);
    if (priorKey && !entry.alias) {
      fail([
        {
          path: `${prefix}.address`,
          message: `duplicate (chainId, address) also used by "${priorKey}"; mark as alias to allow`,
        },
      ]);
    }
    if (options.existing?.has(pair) && !entry.alias) {
      warnings.push(
        `${entry.key}: (chainId, address) already imported; a new revision will be created`,
      );
    }
    seen.set(pair, entry.key);

    // Bytecode existence is verified before activation.
    const verifiedBytecode = options.bytecodeVerified?.has(pair) ?? false;
    if (!verifiedBytecode) {
      const permitted = allowUnverified.has(entry.chainId) && options.acknowledgeUnverified === true;
      if (!permitted) {
        fail([
          {
            path: `${prefix}.address`,
            message: 'no bytecode found at address; import requires staging chain and explicit risk acknowledgement',
          },
        ]);
      }
      warnings.push(`${entry.key}: imported without on-chain bytecode verification`);
    }

    if (!entry.verified) {
      const permitted = allowUnverified.has(entry.chainId) && options.acknowledgeUnverified === true;
      if (!permitted) {
        fail([
          {
            path: `${prefix}.verified`,
            message: 'unverified contract import requires staging chain and explicit risk acknowledgement',
          },
        ]);
      }
      warnings.push(`${entry.key}: ABI is unverified`);
    }

    if (entry.verified && !entry.verification?.compilerVersion) {
      warnings.push(`${entry.key}: verified import is missing compiler version provenance`);
    }

    contracts.push({
      ...entry,
      abiHash: abiHash(entry.abi),
      contractHash: contractHash(entry),
      sourceHash: canonicalKeccak256({ key: entry.key, chainId: entry.chainId, address: entry.address }),
    });
  }

  return { manifestVersion: manifest.manifestVersion, contracts, warnings };
}

/** Extract callable function signatures from an ABI for search indexing. */
export function abiFunctionSelectors(abi: unknown[]): string[] {
  const out: string[] = [];
  for (const raw of abi) {
    const entry = raw as { type?: string; name?: string };
    if (entry.type === 'function' && entry.name) out.push(entry.name);
  }
  return [...new Set(out)];
}
