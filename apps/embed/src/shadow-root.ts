import { EMBED_VERSION } from './postmessage.js';

/**
 * Shadow-DOM renderer.
 *
 * The embed mounts into a shadow root so host-page CSS cannot interfere and the
 * embed's styles cannot leak out. The host page never receives the embed's
 * internal DOM.
 */

export interface MountOptions {
  hostElement: HTMLElement;
  theme?: 'light' | 'dark';
  apiKey: string;
  chainId: number;
  mode: 'portfolio' | 'allowances' | 'strategy' | 'approval';
  appOrigin: string;
}

export const EMBED_STYLES = `
:host { all: initial; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
.ops-embed { border: 1px solid #2a2f45; border-radius: 12px; padding: 16px; background: #0f1320; color: #e6e8f0; }
.ops-embed[data-theme="light"] { background: #ffffff; color: #10131c; border-color: #d7dbe7; }
.ops-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; }
.ops-modal { background: inherit; color: inherit; border-radius: 12px; padding: 20px; max-width: 420px; width: 100%; }
.ops-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #1e2540; font-size: 12px; }
`;

/** Create a shadow root and inject the embed stylesheet. */
export function createShadowRoot(hostElement: HTMLElement): ShadowRoot {
  const shadow = hostElement.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = EMBED_STYLES;
  shadow.appendChild(style);
  const root = document.createElement('div');
  root.className = 'ops-embed';
  root.setAttribute('data-version', EMBED_VERSION);
  shadow.appendChild(root);
  return shadow;
}

/** Render the embed identity banner. The embed never relies on host branding. */
export function renderIdentityBanner(shadow: ShadowRoot, options: MountOptions): void {
  const root = shadow.querySelector('.ops-embed');
  if (!root) return;
  root.setAttribute('data-theme', options.theme ?? 'dark');
  const banner = document.createElement('div');
  banner.className = 'ops-identity';
  banner.setAttribute('data-testid', 'embed-identity');
  // Build with textContent to avoid HTML injection from configuration.
  const title = document.createElement('strong');
  title.textContent = 'Web3 Operations Dashboard';
  const meta = document.createElement('span');
  meta.className = 'ops-badge';
  meta.textContent = `v${EMBED_VERSION} · chain ${options.chainId} · ${options.mode}`;
  banner.appendChild(title);
  banner.appendChild(meta);
  root.appendChild(banner);
}
