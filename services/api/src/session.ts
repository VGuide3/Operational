import { randomBytes, createHash } from 'node:crypto';
import { recoverMessageAddress, type Address } from 'viem';
import { AppError, ErrorCodes, newId } from '@ops/core';
import { checkConsent, type ConsentPayload, type ConsentScope } from '@ops/ui';

/**
 * Authentication + session management.
 *
 * Wallet authentication uses a SIWE-style challenge: the server issues a nonce,
 * the wallet signs it, the server recovers the address and issues a session.
 * No client-trusted authorization: every privileged route re-checks consent
 * server-side.
 */

export interface Session {
  id: string;
  userId: string;
  walletAddress: Address;
  chainId: number;
  roles: string[];
  createdAt: string;
  expiresAt: string;
  csrfToken: string;
  /** Embed origin bound to this session, if the session came from an embed. */
  embedOrigin: string | null;
}

export interface WalletChallenge {
  nonce: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
  domain: string;
  chainId: number;
}

export class AuthService {
  private challenges = new Map<string, WalletChallenge>();
  private sessions = new Map<string, Session>();
  /** userId lookup by wallet address (lowercased). */
  private userByWallet = new Map<string, string>();

  constructor(private readonly domain: string, private readonly sessionTtlSeconds = 8 * 3600) {}

  /** Register a user for a wallet address (normally done by an identity sync). */
  linkUser(walletAddress: string, userId: string): void {
    this.userByWallet.set(walletAddress.toLowerCase(), userId);
  }

  /** Issue a SIWE-style challenge for a wallet + chain. */
  createChallenge(walletAddress: string, chainId: number, ttlSeconds = 300): WalletChallenge {
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const message = [
      `${this.domain} wants you to sign in with your wallet:`,
      walletAddress,
      '',
      'This request will not trigger a blockchain transaction or cost any gas.',
      '',
      `Chain ID: ${chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
    ].join('\n');
    const challenge: WalletChallenge = {
      nonce,
      message,
      issuedAt,
      expiresAt,
      domain: this.domain,
      chainId,
    };
    this.challenges.set(`${walletAddress.toLowerCase()}:${nonce}`, challenge);
    return challenge;
  }

  getChallenge(walletAddress: string, nonce: string): WalletChallenge | undefined {
    return this.challenges.get(`${walletAddress.toLowerCase()}:${nonce}`);
  }

  /** Verify a challenge signature and create a session. */
  async verifySignature(input: {
    walletAddress: Address;
    chainId: number;
    nonce: string;
    signature: `0x${string}`;
    roles?: string[];
    embedOrigin?: string | null;
    now?: number;
  }): Promise<Session> {
    const now = input.now ?? Date.now();
    const challenge = this.getChallenge(input.walletAddress, input.nonce);
    if (!challenge) {
      throw new AppError(ErrorCodes.UNAUTHENTICATED, 'unknown or expired challenge', 401);
    }
    if (new Date(challenge.expiresAt).getTime() <= now) {
      this.challenges.delete(`${input.walletAddress.toLowerCase()}:${input.nonce}`);
      throw new AppError(ErrorCodes.UNAUTHENTICATED, 'challenge has expired', 401);
    }
    if (challenge.chainId !== input.chainId) {
      throw new AppError(ErrorCodes.CHAIN_MISMATCH, 'challenge chain does not match', 401);
    }

    let recovered: Address;
    try {
      recovered = await recoverMessageAddress({ message: challenge.message, signature: input.signature });
    } catch {
      throw new AppError(ErrorCodes.UNAUTHENTICATED, 'signature could not be recovered', 401);
    }
    if (recovered.toLowerCase() !== input.walletAddress.toLowerCase()) {
      throw new AppError(ErrorCodes.UNAUTHENTICATED, 'signature does not match wallet address', 401);
    }

    // Single-use nonce.
    this.challenges.delete(`${input.walletAddress.toLowerCase()}:${input.nonce}`);

    const userId = this.userByWallet.get(input.walletAddress.toLowerCase()) ?? newId('user');
    this.userByWallet.set(input.walletAddress.toLowerCase(), userId);

    const session: Session = {
      id: newId('consent').replace('cns', 'ses'),
      userId,
      walletAddress: input.walletAddress,
      chainId: input.chainId,
      roles: input.roles ?? ['viewer'],
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.sessionTtlSeconds * 1000).toISOString(),
      csrfToken: randomBytes(24).toString('base64url'),
      embedOrigin: input.embedOrigin ?? null,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): Session | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      this.sessions.delete(id);
      return undefined;
    }
    return session;
  }

  destroySession(id: string): void {
    this.sessions.delete(id);
  }

  /** Hash an API key for storage; never store the raw key. */
  static hashApiKey(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}

/**
 * Consent gate. A user cannot reach balance, allowance, strategy, or signing
 * surfaces without an unexpired consent record that matches the current
 * wallet, chain, and (for embeds) origin.
 */
export function requireConsent(input: {
  consent: ConsentPayload | undefined;
  session: Session;
  scope: ConsentScope;
  now?: number;
}): void {
  const result = checkConsent({
    consent: input.consent,
    walletAddress: input.session.walletAddress,
    chainId: input.session.chainId,
    embedOrigin: input.session.embedOrigin,
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  if (!result.ok) {
    const code =
      result.reason === 'expired'
        ? ErrorCodes.CONSENT_EXPIRED
        : result.reason === 'revoked'
          ? ErrorCodes.CONSENT_REVOKED
          : result.reason === 'wallet_changed' || result.reason === 'chain_changed' || result.reason === 'origin_changed'
            ? ErrorCodes.CONSENT_INVALIDATED
            : ErrorCodes.CONSENT_REQUIRED;
    throw new AppError(code, `consent is required (${result.reason})`, 403);
  }
  if (!input.consent!.scopes.includes(input.scope)) {
    throw new AppError(ErrorCodes.FORBIDDEN, `consent does not grant scope ${input.scope}`, 403);
  }
}
