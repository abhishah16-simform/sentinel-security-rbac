import type { Prisma } from '@prisma/client';
import type { SchemaIndex } from '../applications/schema-index';

export interface PermissionView {
  readonly id: string;
  readonly resourceType: string;
  readonly action: string;
  /** true for a Deny Rule. */
  readonly inverted: boolean;
  readonly conditions: Prisma.JsonValue | null;
  /** Uses a Deprecated Resource Type or Action (or one no longer in the Schema): flagged for clean-up. */
  readonly deprecated: boolean;
}

/** A Tenant's Role for one Application, with its Permissions. */
export interface RoleView {
  readonly id: string;
  readonly applicationId: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly PermissionView[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const ROLE_WITH_PERMISSIONS = {
  permissions: { orderBy: [{ resourceType: 'asc' }, { action: 'asc' }, { inverted: 'asc' }, { createdAt: 'asc' }] },
} as const satisfies Prisma.RoleInclude;

export type RoleWithPermissions = Prisma.RoleGetPayload<{ include: typeof ROLE_WITH_PERMISSIONS }>;

export function toRoleView(role: RoleWithPermissions, schema: SchemaIndex): RoleView {
  return {
    id: role.id,
    applicationId: role.applicationId,
    name: role.name,
    description: role.description,
    permissions: role.permissions.map((permission) => ({
      id: permission.id,
      resourceType: permission.resourceType,
      action: permission.action,
      inverted: permission.inverted,
      conditions: permission.conditions,
      deprecated: schema.isFlagged(permission.resourceType, permission.action),
    })),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
