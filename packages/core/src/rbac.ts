import { z } from 'zod';
import { AppError, ErrorCodes } from './errors.js';

/**
 * Role-based access control.
 *
 * Permissions are deliberately separated for read / propose / approve /
 * execute / deploy / import / audit-access so that no single role can both
 * propose and approve a privileged action (separation of duties).
 */
export const Permission = z.enum([
  'read:portfolio',
  'read:allowance',
  'read:contract',
  'read:strategy',
  'read:run',
  'read:job',
  'read:delegation',
  'read:deployment',
  'read:audit',
  'propose:strategy',
  'propose:delegation',
  'propose:deployment',
  'propose:revocation',
  'signature:request',
  'import:contract',
  'approve:contract',
  'approve:job',
  'approve:deployment',
  'execute:wallet',
  'execute:job',
  'manage:roles',
  'manage:embed',
]);
export type Permission = z.infer<typeof Permission>;

export const Role = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  permissions: z.array(Permission),
});
export type Role = z.infer<typeof Role>;

/** Built-in roles. Deployments may add more; ids are immutable. */
export const builtinRoles: Role[] = [
  {
    id: 'viewer',
    description: 'Read-only portfolio and allowance access',
    permissions: ['read:portfolio', 'read:allowance', 'read:contract'],
  },
  {
    id: 'treasury_operator',
    description: 'Proposes strategies and revocations; cannot approve own proposals',
    permissions: [
      'read:portfolio',
      'read:allowance',
      'read:contract',
      'read:strategy',
      'read:run',
      'propose:strategy',
      'propose:revocation',
      'execute:wallet',
      'signature:request',
    ],
  },
  {
    id: 'treasury_approver',
    description: 'Approves jobs and deployments; cannot execute directly',
    permissions: [
      'read:portfolio',
      'read:allowance',
      'read:strategy',
      'read:run',
      'read:job',
      'read:deployment',
      'approve:job',
      'approve:deployment',
    ],
  },
  {
    id: 'contract_admin',
    description: 'Imports and approves contract manifests',
    permissions: ['read:contract', 'import:contract', 'approve:contract'],
  },
  {
    id: 'deployer',
    description: 'Proposes deterministic deployments',
    permissions: ['read:deployment', 'propose:deployment'],
  },
  {
    id: 'delegation_manager',
    description: 'Creates and revokes scoped delegations',
    permissions: ['read:delegation', 'propose:delegation'],
  },
  {
    id: 'auditor',
    description: 'Reads the append-only audit log',
    permissions: ['read:audit'],
  },
  {
    id: 'platform_admin',
    description: 'Manages roles and embed keys; cannot approve jobs',
    permissions: ['manage:roles', 'manage:embed', 'read:audit', 'read:contract'],
  },
];

export function roleById(id: string, roles: Role[] = builtinRoles): Role | undefined {
  return roles.find((r) => r.id === id);
}

export function permissionsFor(roleIds: string[], roles: Role[] = builtinRoles): Set<Permission> {
  const out = new Set<Permission>();
  for (const id of roleIds) {
    const role = roleById(id, roles);
    if (role) for (const p of role.permissions) out.add(p);
  }
  return out;
}

export function hasPermission(
  roleIds: string[],
  permission: Permission,
  roles: Role[] = builtinRoles,
): boolean {
  return permissionsFor(roleIds, roles).has(permission);
}

/** Throw a FORBIDDEN AppError when the principal lacks `permission`. */
export function requirePermission(
  roleIds: string[],
  permission: Permission,
  roles: Role[] = builtinRoles,
): void {
  if (!hasPermission(roleIds, permission, roles)) {
    throw new AppError(
      ErrorCodes.FORBIDDEN,
      `principal lacks required permission: ${permission}`,
      403,
    );
  }
}

/**
 * Separation of duties: a principal that may propose may not also approve the
 * same class of action unless explicitly granted both by an admin. This helper
 * is used by the job approval path to prevent self-approval.
 */
export function assertNotSelfApproval(proposerId: string, approverId: string): void {
  if (proposerId === approverId) {
    throw new AppError(
      ErrorCodes.SELF_APPROVAL_FORBIDDEN,
      'the requester may not approve their own request',
      403,
    );
  }
}
