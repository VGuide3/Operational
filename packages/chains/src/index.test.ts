import { describe, expect, it } from 'vitest';
import {
  defaultRegistry,
  explorerTxUrl,
  getChain,
  isProductionChain,
  isSupportedChain,
  listChains,
  tryGetChain,
  UnknownChainError,
} from './index.js';

describe('chain registry', () => {
  it('parses the bundled registry with a version', () => {
    expect(defaultRegistry.registryVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(defaultRegistry.chains.length).toBeGreaterThanOrEqual(2);
  });

  it('resolves known chains and throws for unknown', () => {
    expect(getChain(1).key).toBe('ethereum');
    expect(tryGetChain(999999)).toBeUndefined();
    expect(() => getChain(999999)).toThrow(UnknownChainError);
  });

  it('reports supported chains', () => {
    expect(isSupportedChain(1)).toBe(true);
    expect(isSupportedChain(2)).toBe(false);
  });

  it('marks sepolia as non-production and ethereum as production', () => {
    expect(isProductionChain(1)).toBe(true);
    expect(isProductionChain(11155111)).toBe(false);
  });

  it('lists every chain with a canonical Permit2 address', () => {
    for (const chain of listChains()) {
      expect(chain.permit2).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  it('builds explorer urls from the registry', () => {
    expect(explorerTxUrl(1, '0xabc')).toBe('https://etherscan.io/tx/0xabc');
  });
});
