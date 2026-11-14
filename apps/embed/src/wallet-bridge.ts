import { isRpcAllowed } from './postmessage.js';

/**
 * Wallet bridge.
 *
 * The embed talks to the wallet only through a scoped JSON-RPC bridge that
 * permits read-only methods. Signing and transaction submission always happen
 * inside the canonical modal + user wallet, never through a host-page request.
 */

export interface RpcProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface RpcBridgeOptions {
  provider?: RpcProvider;
  /** Chain the bridge is pinned to; cross-chain requests are rejected. */
  chainId: number;
}

export class RpcBridge {
  constructor(private readonly options: RpcBridgeOptions) {}

  get available(): boolean {
    return this.options.provider !== undefined;
  }

  /** Forward a read-only RPC call, rejecting anything outside the allowlist. */
  async request(method: string, params?: unknown[]): Promise<unknown> {
    if (!isRpcAllowed(method)) {
      throw new Error(`rpc method not allowed: ${method}`);
    }
    if (!this.options.provider) {
      throw new Error('no wallet provider available');
    }
    return this.options.provider.request({ method, params });
  }
}

/** Detect an injected EIP-1193 provider, tolerating its absence. */
export function detectProvider(win: { ethereum?: unknown }): RpcProvider | undefined {
  const eth = win.ethereum as RpcProvider | undefined;
  if (eth && typeof eth.request === 'function') return eth;
  return undefined;
}
