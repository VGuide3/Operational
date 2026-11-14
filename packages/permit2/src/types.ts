import { z } from 'zod';

/**
 * Permit2 model.
 *
 * Permit2 separates signature-based transfers (SignatureTransfer: one nonce-
 * scoped transfer, no persistent allowance) from allowance-based transfers
 * (AllowanceTransfer: time-bounded allowances and expirations).
 */

export const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const UintString = z.string().regex(/^\d+$/);

export const Permit2Allowance = z.object({
  amount: UintString,
  expiration: z.number().int().nonnegative(),
  nonce: z.number().int().nonnegative(),
});
export type Permit2Allowance = z.infer<typeof Permit2Allowance>;

/** The allowance record stored per (owner, token, spender, chainId). */
export const AllowanceRecord = z.object({
  owner: Address,
  token: Address,
  spender: Address,
  chainId: z.number().int().positive(),
  allowanceRaw: UintString,
  allowanceIsMax: z.boolean(),
  permit2Allowance: Permit2Allowance.optional(),
  scannedAt: z.string().datetime(),
  source: z.enum(['rpc_multicall', 'indexer', 'permit2', 'cache']),
  blockNumber: z.number().int().nonnegative().optional(),
});
export type AllowanceRecord = z.infer<typeof AllowanceRecord>;

export const MAX_UINT256_DEC =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

export function isMaxAllowance(raw: string): boolean {
  return raw === MAX_UINT256_DEC;
}

/** A Permit2 SignatureTransfer permit (permitTransferFrom). */
export const PermitTransferFrom = z.object({
  chainId: z.number().int().positive(),
  permit2: Address,
  token: Address,
  amount: UintString,
  nonce: UintString,
  deadline: z.number().int().nonnegative(),
  /** Witness-bound permits include the operational intent. */
  witness: z
    .object({
      strategyId: z.string(),
      intentHash: z.string(),
      expiresAt: z.number().int().nonnegative(),
      executor: Address,
    })
    .optional(),
});
export type PermitTransferFrom = z.infer<typeof PermitTransferFrom>;

export const PermitTransferDetails = z.object({
  to: Address,
  requestedAmount: UintString,
});
export type PermitTransferDetails = z.infer<typeof PermitTransferDetails>;
