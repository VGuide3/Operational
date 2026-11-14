import { newId } from '@ops/core';
import type { ValidatedContract, ValidationOutcome } from './manifest.js';
import { abiFunctionSelectors } from './manifest.js';

/**
 * In-memory reference store for contract manifests and contracts.
 *
 * Production uses PostgreSQL (see README data models); this store mirrors the
 * same shapes and invariants so services and tests can run without a database.
 * ABIs are immutable: re-importing a changed ABI creates a new revision.
 */

export type ManifestStatus = 'staged' | 'approved' | 'rejected' | 'active';

export interface ManifestRecord {
  id: string;
  manifestVersion: string;
  submittedBy: string;
  status: ManifestStatus;
  sourceHash: string;
  createdAt: string;
  approvedBy: string[];
  contracts: ValidatedContract[];
}

export interface ContractRecord {
  id: string;
  manifestId: string;
  key: string;
  name: string;
  chainId: number;
  address: string;
  abi: unknown[];
  abiHash: string;
  contractHash: string;
  verified: boolean;
  tags: string[];
  deployer?: string;
  risk?: Record<string, unknown>;
  revision: number;
  functions: string[];
  createdAt: string;
}

export interface ContractQuery {
  name?: string;
  address?: string;
  chainId?: number;
  tag?: string;
  deployer?: string;
  abiFunction?: string;
  cursor?: string;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export class ContractStore {
  private manifests = new Map<string, ManifestRecord>();
  private contracts = new Map<string, ContractRecord>();
  /** key `${chainId}:${address.toLowerCase()}` -> contract id (latest revision). */
  private byAddress = new Map<string, string>();
  /** key `${chainId}:${address}:${abiHash}` -> contract id (revision guard). */
  private byRevision = new Map<string, string>();

  /** Stage a validated manifest. Does not activate contracts. */
  stageManifest(outcome: ValidationOutcome, submittedBy: string): ManifestRecord {
    const record: ManifestRecord = {
      id: newId('manifest'),
      manifestVersion: outcome.manifestVersion,
      submittedBy,
      status: 'staged',
      sourceHash: outcome.contracts.map((c) => c.sourceHash).join(','),
      createdAt: new Date().toISOString(),
      approvedBy: [],
      contracts: outcome.contracts,
    };
    this.manifests.set(record.id, record);
    return record;
  }

  getManifest(id: string): ManifestRecord | undefined {
    return this.manifests.get(id);
  }

  /**
   * Approve a staged manifest, creating contract records.
   * Re-imports of the same ABI are idempotent; a changed ABI creates a new
   * revision (immutability rule).
   */
  approveManifest(id: string, approverId: string): { manifest: ManifestRecord; contracts: ContractRecord[] } {
    const manifest = this.manifests.get(id);
    if (!manifest) throw new Error(`manifest ${id} not found`);
    if (!manifest.approvedBy.includes(approverId)) manifest.approvedBy.push(approverId);

    const created: ContractRecord[] = [];
    for (const entry of manifest.contracts) {
      const pair = `${entry.chainId}:${entry.address.toLowerCase()}`;
      const revisionKey = `${pair}:${entry.abiHash}`;
      const existingRevision = this.byRevision.get(revisionKey);
      if (existingRevision) {
        const existing = this.contracts.get(existingRevision)!;
        created.push(existing);
        continue;
      }
      const priorId = this.byAddress.get(pair);
      const revision = priorId ? (this.contracts.get(priorId)?.revision ?? 0) + 1 : 1;
      const record: ContractRecord = {
        id: newId('contract'),
        manifestId: manifest.id,
        key: entry.key,
        name: entry.name,
        chainId: entry.chainId,
        address: entry.address,
        abi: entry.abi,
        abiHash: entry.abiHash,
        contractHash: entry.contractHash,
        verified: entry.verified,
        tags: entry.tags,
        ...(entry.deployer ? { deployer: entry.deployer } : {}),
        ...(entry.risk ? { risk: entry.risk as Record<string, unknown> } : {}),
        revision,
        functions: abiFunctionSelectors(entry.abi),
        createdAt: new Date().toISOString(),
      };
      this.contracts.set(record.id, record);
      this.byRevision.set(revisionKey, record.id);
      this.byAddress.set(pair, record.id);
      created.push(record);
    }

    manifest.status = 'active';
    return { manifest, contracts: created };
  }

  getContract(id: string): ContractRecord | undefined {
    return this.contracts.get(id);
  }

  listRevisions(chainId: number, address: string): ContractRecord[] {
    return [...this.contracts.values()]
      .filter((c) => c.chainId === chainId && c.address.toLowerCase() === address.toLowerCase())
      .sort((a, b) => a.revision - b.revision);
  }

  /** Searchable by name, address, chain, tag, deployer, and ABI function. */
  search(query: ContractQuery = {}): Page<ContractRecord> {
    let items = [...this.contracts.values()];
    if (query.name) {
      const q = query.name.toLowerCase();
      items = items.filter((c) => c.name.toLowerCase().includes(q) || c.key.toLowerCase().includes(q));
    }
    if (query.address) {
      const q = query.address.toLowerCase();
      items = items.filter((c) => c.address.toLowerCase().includes(q));
    }
    if (query.chainId !== undefined) items = items.filter((c) => c.chainId === query.chainId);
    if (query.tag) items = items.filter((c) => c.tags.includes(query.tag!));
    if (query.deployer) {
      const q = query.deployer.toLowerCase();
      items = items.filter((c) => c.deployer?.toLowerCase() === q);
    }
    if (query.abiFunction) {
      items = items.filter((c) => c.functions.includes(query.abiFunction!));
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const limit = Math.min(query.limit ?? 50, 200);
    const startIndex = query.cursor ? items.findIndex((c) => c.id === query.cursor) + 1 : 0;
    const slice = items.slice(startIndex, startIndex + limit);
    const last = slice[slice.length - 1];
    const nextCursor = last && startIndex + limit < items.length ? last.id : null;
    return { items: slice, nextCursor };
  }
}
