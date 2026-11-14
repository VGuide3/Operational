import {
  EMBED_VERSION,
  isAllowedOrigin,
  isValidApiKey,
  makeError,
  makeResponse,
  parseMessage,
  type EmbedAction,
  type EmbedResponse,
  type OriginPolicy,
} from './postmessage.js';
import { createShadowRoot, renderIdentityBanner, type MountOptions } from './shadow-root.js';
import { detectProvider, RpcBridge } from './wallet-bridge.js';

/**
 * Embed runtime entry point.
 *
 * Loaded via `<script src=".../embed/v1/script.js" data-api-key="pk_live_..."
 * data-chain-id="1" data-mode="portfolio" defer>`.
 *
 * Security posture:
 *  - refuses to initialize without a valid API key and a registered origin
 *  - only accepts postMessage traffic from allowlisted origins
 *  - exposes a read-only RPC bridge, never eth_sendTransaction
 *  - renders inside a shadow DOM with its own identity
 */

export interface EmbedConfig {
  apiKey: string;
  chainId: number;
  mode: MountOptions['mode'];
  theme: 'light' | 'dark';
  appOrigin: string;
  /** Target element id; defaults to ops-dashboard. */
  mountId: string;
}

export interface EmbedInitResult {
  ok: boolean;
  reason?: string;
  shadow?: ShadowRoot;
}

export function readConfig(script: HTMLScriptElement): Partial<EmbedConfig> {
  const ds = script.dataset;
  return {
    apiKey: ds.apiKey ?? '',
    chainId: ds.chainId ? Number(ds.chainId) : 1,
    mode: (ds.mode as MountOptions['mode']) ?? 'portfolio',
    theme: (ds.theme as 'light' | 'dark') ?? 'dark',
    appOrigin: ds.appOrigin ?? new URL(script.src).origin,
    mountId: ds.mountId ?? 'ops-dashboard',
  };
}

/**
 * Registry lookup: resolves the allowed origins for an API key. In production
 * this is fetched from the backend; here the host page supplies it out of band
 * so the embed never trusts an origin it was not told about.
 */
export type OriginRegistry = (apiKey: string) => Promise<OriginPolicy | null>;

export interface EmbedRuntimeDeps {
  document: Document;
  window: Window;
  originRegistry: OriginRegistry;
}

const VIEW_BY_ACTION: Record<EmbedAction, string> = {
  open_portfolio: 'portfolio',
  open_allowances: 'allowances',
  open_strategy: 'strategy',
  open_approval: 'approval',
  get_view: 'current',
  disconnect: 'disconnected',
  set_theme: 'themed',
};

export class EmbedRuntime {
  private policy: OriginPolicy | null = null;
  private shadow: ShadowRoot | null = null;
  private config: EmbedConfig | null = null;
  private parentOrigin: string | null = null;

  constructor(private readonly deps: EmbedRuntimeDeps) {}

  /** Initialize the embed. Returns a result describing why it failed, if so. */
  async init(script: HTMLScriptElement): Promise<EmbedInitResult> {
    const config = readConfig(script) as EmbedConfig;

    if (!isValidApiKey(config.apiKey)) {
      return { ok: false, reason: 'invalid_api_key' };
    }

    const policy = await this.deps.originRegistry(config.apiKey);
    if (!policy) return { ok: false, reason: 'unregistered_api_key' };
    this.policy = policy;
    this.config = config;

    const host = this.deps.document.getElementById(config.mountId);
    if (!host) return { ok: false, reason: 'mount_point_missing' };

    this.shadow = createShadowRoot(host);
    renderIdentityBanner(this.shadow, {
      hostElement: host,
      theme: config.theme,
      apiKey: config.apiKey,
      chainId: config.chainId,
      mode: config.mode,
      appOrigin: config.appOrigin,
    });

    this.deps.window.addEventListener('message', this.onMessage);
    return { ok: true, shadow: this.shadow };
  }

  private onMessage = (event: MessageEvent): void => {
    // Reject messages from unregistered origins before parsing.
    if (!this.policy || !isAllowedOrigin(event.origin, this.policy)) return;
    if (!this.config) return;

    const message = parseMessage(event.data);
    if (!message || message.type !== 'ops:request') return;

    // The first allowlisted origin becomes the bound parent for responses.
    if (!this.parentOrigin) this.parentOrigin = event.origin;

    this.handleRequest(message.requestId, message.action, message.payload);
  };

  private handleRequest(requestId: string, action: EmbedAction, payload?: Record<string, unknown>): void {
    // Only the bound parent origin may drive the embed.
    if (!this.parentOrigin) return;
    const respond = (body: EmbedResponse) => {
      this.deps.window.parent?.postMessage(JSON.stringify(body), this.parentOrigin!);
    };

    // Privileged wallet actions are never exposed to the host page.
    if (action === 'disconnect') {
      respond(makeResponse(requestId, { view: 'disconnected' }));
      return;
    }

    // Read-only bridge capability is surfaced but not executed on behalf of the host.
    const bridge = new RpcBridge({
      chainId: this.config!.chainId,
      provider: detectProvider(this.deps.window as unknown as { ethereum?: unknown }),
    });
    respond(makeResponse(requestId, { view: VIEW_BY_ACTION[action], rpcAvailable: bridge.available, payload: payload ?? {} }));
  }

  /** Send an event to the bound parent origin. */
  emit(event: string, data?: Record<string, unknown>): void {
    if (!this.parentOrigin) return;
    this.deps.window.parent?.postMessage(JSON.stringify({ type: 'ops:event', event, data }), this.parentOrigin);
  }

  destroy(): void {
    this.deps.window.removeEventListener('message', this.onMessage);
    this.shadow = null;
    this.parentOrigin = null;
  }
}

/** Auto-initialize when the script executes in a browser. */
export async function bootstrap(deps?: Partial<EmbedRuntimeDeps>): Promise<EmbedInitResult | null> {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[data-api-key]'));
  const script = scripts[scripts.length - 1];
  if (!script) return null;

  const runtime = new EmbedRuntime({
    document,
    window,
    originRegistry: deps?.originRegistry ?? (async () => null),
  });
  (window as unknown as { __opsEmbed?: EmbedRuntime }).__opsEmbed = runtime;
  return runtime.init(script);
}

if (typeof window !== 'undefined') {
  void bootstrap();
}

export { EMBED_VERSION, makeError };
