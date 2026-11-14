import { z } from 'zod';

/**
 * Versioned chain registry.
 *
 * All chain-specific contracts, explorers, RPCs, and Permit2 addresses come
 * from this registry. Nothing in the application may hardcode a chain constant;
 * callers resolve everything through `getChain` / `listChains`.
 */

export const Address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 20-byte hex address');

export const HexData = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, 'expected hex data');

export const ChainRegistryEntry = z.object({
  chainId: z.number().int().positive(),
  /** Stable slug used in URLs and manifests. */
  key: z.string().min(1),
  name: z.string().min(1),
  /** CAIP-2 identifier, e.g. eip155:1. */
  caip2: z.string().regex(/^eip155:\d+$/),
  nativeCurrency: z.object({
    name: z.string().min(1),
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(36),
  }),
  rpcUrls: z.array(z.string().url()).min(1),
  explorer: z.object({
    name: z.string().min(1),
    url: z.string().url(),
    apiUrl: z.string().url().optional(),
  }),
  /** Canonical Permit2 deployment for this chain. */
  permit2: Address.optional(),
  /** Multicall3 deployment for this chain. */
  multicall3: Address.optional(),
  /** Application-owned executor used for permit-driven transfers. */
  executor: Address.optional(),
  /** CREATE2 deterministic deployment proxy/factory. */
  create2Factory: Address.optional(),
  /** Whether the chain is considered production for two-person rules. */
  production: z.boolean().default(true),
  /** Whether unverified contract imports are permitted here. */
  allowUnverifiedImports: z.boolean().default(false),
  /** Approximate seconds per block, used for freshness heuristics. */
  blockTimeSeconds: z.number().positive().default(12),
});

export type ChainRegistryEntry = z.infer<typeof ChainRegistryEntry>;

export const ChainRegistry = z.object({
  registryVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'registryVersion must be semver'),
  /** Policy version this registry was published under. */
  policyVersion: z.string(),
  chains: z.array(ChainRegistryEntry).min(1),
});

export type ChainRegistry = z.infer<typeof ChainRegistry>;

const PERMIT2_CANONICAL = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;
const MULTICALL3_CANONICAL = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

/**
 * The bundled registry. Chain-specific constants live here and nowhere else.
 * Deployments can override this by loading a newer registry document at boot.
 */
export const defaultRegistry: ChainRegistry = ChainRegistry.parse({
  registryVersion: '1.0.0',
  policyVersion: '2026-11-01',
  chains: [
    {
      chainId: 1,
      key: 'ethereum',
      name: 'Ethereum Mainnet',
      caip2: 'eip155:1',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth'],
      explorer: {
        name: 'Etherscan',
        url: 'https://etherscan.io',
        apiUrl: 'https://api.etherscan.io/v2/api',
      },
      permit2: PERMIT2_CANONICAL,
      multicall3: MULTICALL3_CANONICAL,
      production: true,
      allowUnverifiedImports: false,
      blockTimeSeconds: 12,
    },
    {
      chainId: 10,
      key: 'optimism',
      name: 'OP Mainnet',
      caip2: 'eip155:10',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://mainnet.optimism.io'],
      explorer: {
        name: 'Optimistic Etherscan',
        url: 'https://optimistic.etherscan.io',
        apiUrl: 'https://api.etherscan.io/v2/api',
      },
      permit2: PERMIT2_CANONICAL,
      multicall3: MULTICALL3_CANONICAL,
      production: true,
      allowUnverifiedImports: false,
      blockTimeSeconds: 2,
    },
    {
      chainId: 137,
      key: 'polygon',
      name: 'Polygon PoS',
      caip2: 'eip155:137',
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: ['https://polygon-rpc.com'],
      explorer: {
        name: 'Polygonscan',
        url: 'https://polygonscan.com',
        apiUrl: 'https://api.etherscan.io/v2/api',
      },
      permit2: PERMIT2_CANONICAL,
      multicall3: MULTICALL3_CANONICAL,
      production: true,
      allowUnverifiedImports: false,
      blockTimeSeconds: 2,
    },
    {
      chainId: 42161,
      key: 'arbitrum',
      name: 'Arbitrum One',
      caip2: 'eip155:42161',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://arb1.arbitrum.io/rpc'],
      explorer: {
        name: 'Arbiscan',
        url: 'https://arbiscan.io',
        apiUrl: 'https://api.etherscan.io/v2/api',
      },
      permit2: PERMIT2_CANONICAL,
      multicall3: MULTICALL3_CANONICAL,
      production: true,
      allowUnverifiedImports: false,
      blockTimeSeconds: 1,
    },
    {
      chainId: 8453,
      key: 'base',
      name: 'Base',
      caip2: 'eip155:8453',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://mainnet.base.org'],
      explorer: {
        name: 'Basescan',
        url: 'https://basescan.org',
        apiUrl: 'https://api.etherscan.io/v2/api',
      },
      permit2: PERMIT2_CANONICAL,
      multicall3: MULTICALL3_CANONICAL,
      production: true,
      allowUnverifiedImports: false,
      blockTimeSeconds: 2,
    },
    {
      chainId: 11155111,
      key: 'sepolia',
      name: 'Sepolia',
      caip2: 'eip155:11155111',
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://rpc.sepolia.org'],
      explorer: {
        name: 'Etherscan Sepolia',
        url: 'https://sepolia.etherscan.io',
        apiUrl: 'https://api.etherscan.io/v2/api',
      },
      permit2: PERMIT2_CANONICAL,
      multicall3: MULTICALL3_CANONICAL,
      production: false,
      allowUnverifiedImports: true,
      blockTimeSeconds: 12,
    },
  ],
});

export class UnknownChainError extends Error {
  readonly code = 'unknown_chain';
  constructor(chainId: number) {
    super(`chainId ${chainId} is not present in the active chain registry`);
  }
}

export interface ChainRegistryLike {
  chains: ChainRegistryEntry[];
  registryVersion: string;
}

/** Resolve a chain entry or throw `UnknownChainError`. */
export function getChain(chainId: number, registry: ChainRegistryLike = defaultRegistry): ChainRegistryEntry {
  const found = registry.chains.find((c) => c.chainId === chainId);
  if (!found) throw new UnknownChainError(chainId);
  return found;
}

export function tryGetChain(
  chainId: number,
  registry: ChainRegistryLike = defaultRegistry,
): ChainRegistryEntry | undefined {
  return registry.chains.find((c) => c.chainId === chainId);
}

export function listChains(registry: ChainRegistryLike = defaultRegistry): ChainRegistryEntry[] {
  return [...registry.chains];
}

export function isSupportedChain(
  chainId: number,
  registry: ChainRegistryLike = defaultRegistry,
): boolean {
  return registry.chains.some((c) => c.chainId === chainId);
}

/** Production chains require two-person approval for contract registration. */
export function isProductionChain(
  chainId: number,
  registry: ChainRegistryLike = defaultRegistry,
): boolean {
  return getChain(chainId, registry).production;
}

export function explorerTxUrl(
  chainId: number,
  txHash: string,
  registry: ChainRegistryLike = defaultRegistry,
): string {
  const chain = getChain(chainId, registry);
  return `${chain.explorer.url}/tx/${txHash}`;
}

export function explorerAddressUrl(
  chainId: number,
  address: string,
  registry: ChainRegistryLike = defaultRegistry,
): string {
  const chain = getChain(chainId, registry);
  return `${chain.explorer.url}/address/${address}`;
}
