import {
  createPublicClient,
  http,
  getAddress,
  parseAbi,
  type PublicClient,
  type Address,
} from 'viem';
import { getChain, type ChainRegistryLike } from '@ops/chains';
import type { ChainReader, TokenMetadata } from './scanner.js';

const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
]);

const permit2Abi = parseAbi([
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]);

/** Real chain reader backed by a viem public client. */
export class ViemChainReader implements ChainReader {
  readonly chainId: number;
  private readonly client: PublicClient;

  constructor(
    chainId: number,
    options: { rpcUrl?: string; registry?: ChainRegistryLike } = {},
  ) {
    const chain = getChain(chainId, options.registry);
    this.chainId = chainId;
    const rpcUrl = options.rpcUrl ?? chain.rpcUrls[0]!;
    this.client = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;
  }

  async getBlockNumber(): Promise<number> {
    return Number(await this.client.getBlockNumber());
  }

  async getNativeBalance(owner: string): Promise<bigint> {
    return this.client.getBalance({ address: getAddress(owner) });
  }

  async getErc20Balance(token: string, owner: string): Promise<bigint> {
    return this.client.readContract({
      address: getAddress(token),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [getAddress(owner)],
    }) as Promise<bigint>;
  }

  async getErc20Allowance(token: string, owner: string, spender: string): Promise<bigint> {
    return this.client.readContract({
      address: getAddress(token),
      abi: erc20Abi,
      functionName: 'allowance',
      args: [getAddress(owner), getAddress(spender)],
    }) as Promise<bigint>;
  }

  async getTokenMetadata(token: string): Promise<TokenMetadata | null> {
    const address = getAddress(token);
    const read = async <T>(functionName: 'symbol' | 'name' | 'decimals' | 'totalSupply'): Promise<T | null> => {
      try {
        return (await this.client.readContract({ address, abi: erc20Abi, functionName })) as T;
      } catch {
        return null;
      }
    };
    const [symbol, name, decimals, totalSupply] = await Promise.all([
      read<string>('symbol'),
      read<string>('name'),
      read<number>('decimals'),
      read<bigint>('totalSupply'),
    ]);
    if (symbol === null && decimals === null) return null;
    return {
      chainId: this.chainId,
      address,
      symbol,
      name,
      decimals: decimals === null ? null : Number(decimals),
      totalSupply: totalSupply === null ? null : totalSupply.toString(),
    };
  }

  async getCode(address: string): Promise<string> {
    return (await this.client.getCode({ address: getAddress(address) })) ?? '0x';
  }

  /** Read the Permit2 allowance for (owner, token, spender). */
  async getPermit2Allowance(
    token: string,
    owner: string,
    spender: string,
  ): Promise<{ amount: bigint; expiration: number; nonce: number }> {
    const chain = getChain(this.chainId);
    if (!chain.permit2) throw new Error(`no Permit2 on chain ${this.chainId}`);
    const [amount, expiration, nonce] = (await this.client.readContract({
      address: chain.permit2 as Address,
      abi: permit2Abi,
      functionName: 'allowance',
      args: [getAddress(owner), getAddress(token), getAddress(spender)],
    })) as readonly [bigint, number, number];
    return { amount, expiration: Number(expiration), nonce: Number(nonce) };
  }
}
