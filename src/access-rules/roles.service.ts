import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Application, Prisma } from '@prisma/client';
import { lockApplication } from '../applications/application-lock';
import { describeRule } from '../applications/role-templates.service';
import { loadSchemaIndex, loadSchemaIndexes, SchemaIndex } from '../applications/schema-index';
import type { AuditEventType } from '../audit/audit-event-types';
import { canonicalJson } from '../audit/audit-hash';
import { AuditLog, type AuditPayload } from '../audit/audit-log.service';
import { type Page, type PageQuery, pageWindow, toPage } from '../common/pagination';
import { ScopedPrisma, type ScopedTransaction } from '../prisma/scoped-prisma';
import { parseConditions } from './conditions';
import { MAX_ROLE_PERMISSIONS } from './dto/role.dto';
import { endRoleAssignments } from './role-assignment-ending';
import { ROLE_WITH_PERMISSIONS, type RoleView, toRoleView } from './role-view';
import { SCHEMA_INCLUDE, type TenantResourceTypeView, toSchemaView } from './schema-view';
import { lockTenant } from './tenant-lock';

/** Roles per Application in one Tenant. */
export const MAX_ROLES_PER_APPLICATION = 100;

export interface ApplicationRef {
  readonly id: string;
  readonly name: string;
  /** Whether the Active Tenant has it enabled now. */
  readonly enabled: boolean;
}

/** A Role in the Tenant-wide list, with the Application it belongs to. */
export interface RoleSummary extends RoleView {
  readonly application: ApplicationRef;
}

/** One Role with the Application Schema its Permissions are written against. */
export interface RoleDetail extends RoleSummary {
  readonly resourceTypes: readonly TenantResourceTypeView[];
}

/** A Permission in the Tenant-wide list, with its Role and Application. */
export interface PermissionListItem {
  readonly id: string;
  readonly resourceType: string;
  readonly action: string;
  readonly inverted: boolean;
  readonly conditions: Prisma.JsonValue | null;
  readonly deprecated: boolean;
  readonly createdAt: Date;
  readonly role: { readonly id: string; readonly name: string };
  readonly application: { readonly id: string; readonly name: string };
}

export interface PermissionInput {
  readonly resourceType: string;
  readonly action: string;
  readonly inverted?: boolean;
  /** Checked by parseConditions(); null or {} for none. */
  readonly conditions?: unknown;
}

export interface CreateRoleInput {
  readonly applicationId: string;
  readonly name: string;
  readonly description?: string;
  readonly permissions?: readonly PermissionInput[];
}

export interface UpdateRoleInput {
  readonly name?: string;
  readonly description?: string;
}

export interface RoleListFilter extends PageQuery {
  readonly applicationId?: string;
}

export interface PermissionListFilter extends PageQuery {
  readonly applicationId?: string;
  readonly resourceType?: string;
}

/** A Permission ready to store: names checked by the DTO, Condition parsed. */
interface PermissionRule {
  readonly resourceType: string;
  readonly action: string;
  readonly inverted: boolean;
  readonly conditions: Prisma.InputJsonObject | null;
}

interface StoredRule {
  readonly resourceType: string;
  readonly action: string;
  readonly inverted: boolean;
  readonly conditions: Prisma.JsonValue | null;
}

function toRule(input: PermissionInput): PermissionRule {
  return {
    resourceType: input.resourceType,
    action: input.action,
    inverted: input.inverted ?? false,
    conditions: parseConditions(input.conditions),
  };
}

/** "allow read Document if {"ownerId":"${user.id}"}", for audit payloads and conflict messages. */
function describePermission(rule: StoredRule | PermissionRule): string {
  const base = describeRule(rule);
  return rule.conditions === null ? base : `${base} if ${canonicalJson(rule.conditions)}`;
}

/** Two Permissions are the same when every part matches, Conditions compared as canonical JSON. */
function sameRule(a: StoredRule | PermissionRule, b: StoredRule | PermissionRule): boolean {
  return (
    a.resourceType === b.resourceType &&
    a.action === b.action &&
    a.inverted === b.inverted &&
    canonicalJson(a.conditions) === canonicalJson(b.conditions)
  );
}

function duplicateRule(rule: PermissionRule): ConflictException {
  return new ConflictException(`The Role already has "${describePermission(rule)}"`);
}

function toCreateData(tenantId: string, rule: PermissionRule): Prisma.PermissionCreateWithoutRoleInput {
  return {
    tenant: { connect: { id: tenantId } },
    resourceType: rule.resourceType,
    action: rule.action,
    inverted: rule.inverted,
    ...(rule.conditions === null ? {} : { conditions: rule.conditions }),
  };
}

const ROLE_WITH_APPLICATION = {
  ...ROLE_WITH_PERMISSIONS,
  application: { select: { id: true, name: true } },
} as const satisfies Prisma.RoleInclude;

type RoleWithApplication = Prisma.RoleGetPayload<{ include: typeof ROLE_WITH_APPLICATION }>;

/**
 * Roles and Permissions inside the Active Tenant, for its Tenant Admins. Every change locks the
 * Tenant row, so Role names stay unique ignoring case and Enablement can't change underneath it.
 * New Roles and Permissions need the Application enabled; renaming, deleting and removing
 * Permissions also work while it is disabled, so a Tenant can clean up. Adding a Permission also
 * holds the Application row, so the Schema entry it uses can't be Deprecated at the same moment.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly scoped: ScopedPrisma,
    private readonly audit: AuditLog,
  ) {}

  /** The Tenant's Roles, oldest first, optionally for one Application. */
  async list(tenantId: string, filter: RoleListFilter): Promise<Page<RoleSummary>> {
    const window = pageWindow(filter, 'asc');
    return this.scoped.inTenant(tenantId, async (tx) => {
      const rows = await tx.role.findMany({
        where: { tenantId, ...(filter.applicationId ? { applicationId: filter.applicationId } : {}), ...window.after },
        include: ROLE_WITH_APPLICATION,
        orderBy: window.orderBy,
        take: window.take,
      });
      const applicationIds = [...new Set(rows.map((row) => row.applicationId))];
      const schemas = await loadSchemaIndexes(tx, applicationIds);
      const enabled = await this.enabledApplications(tx, tenantId, applicationIds);
      return toPage(rows, window, (row) => toSummary(row, schemas.get(row.applicationId), enabled.has(row.applicationId)));
    });
  }

  async get(tenantId: string, roleId: string): Promise<RoleDetail> {
    return this.scoped.inTenant(tenantId, (tx) => this.detailIn(tx, tenantId, roleId));
  }

  async create(tenantId: string, actorUserId: string, input: CreateRoleInput): Promise<RoleDetail> {
    const rules: PermissionRule[] = [];
    for (const rule of (input.permissions ?? []).map(toRule)) {
      if (rules.some((existing) => sameRule(existing, rule))) throw duplicateRule(rule);
      rules.push(rule);
    }
    return this.scoped.inTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const application = await this.lockEnabledApplication(tx, tenantId, input.applicationId);
      const schema = await loadSchemaIndex(tx, application.id);
      rules.forEach((rule) => schema.assertUsable(rule.resourceType, rule.action));
      const roles = await tx.role.findMany({ where: { tenantId, applicationId: application.id }, select: { name: true } });
      if (roles.length >= MAX_ROLES_PER_APPLICATION) {
        throw new ConflictException(`A Tenant can have at most ${MAX_ROLES_PER_APPLICATION} Roles for one Application`);
      }
      assertNameFree(roles, input.name);
      const created = await tx.role.create({
        data: {
          tenant: { connect: { id: tenantId } },
          application: { connect: { id: application.id } },
          name: input.name,
          description: input.description ?? '',
          permissions: { create: rules.map((rule) => toCreateData(tenantId, rule)) },
        },
      });
      await this.recordIn(tx, 'role.created', actorUserId, created, application.name, {
        permissions: rules.map(describePermission).join(', '),
      });
      return this.detailIn(tx, tenantId, created.id);
    });
  }

  /** Rename a Role or change its description. */
  async update(tenantId: string, actorUserId: string, roleId: string, input: UpdateRoleInput): Promise<RoleDetail> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const role = await this.findIn(tx, tenantId, roleId);
      const name = input.name ?? role.name;
      const description = input.description ?? role.description;
      if (name !== role.name || description !== role.description) {
        if (name.toLowerCase() !== role.name.toLowerCase()) {
          const others = await tx.role.findMany({
            where: { tenantId, applicationId: role.applicationId, id: { not: roleId } },
            select: { name: true },
          });
          assertNameFree(others, name);
        }
        await tx.role.update({ where: { id: roleId }, data: { name, description } });
        await this.recordIn(tx, 'role.updated', actorUserId, role, role.application.name, {
          ...(name !== role.name ? { previousName: role.name, name } : {}),
          descriptionChanged: description !== role.description,
        });
      }
      return this.detailIn(tx, tenantId, roleId);
    });
  }

  /**
   * Delete a Role with its Permissions. Its active Role Assignments are revoked first and, like its
   * ended ones, kept with the Role's last name once their roleId is set to null.
   */
  async remove(tenantId: string, actorUserId: string, roleId: string): Promise<void> {
    await this.scoped.inTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const role = await this.findIn(tx, tenantId, roleId);
      const revoked = await endRoleAssignments(tx, this.audit, tenantId, { roleId }, 'ROLE_DELETED', actorUserId);
      await tx.roleAssignment.updateMany({ where: { tenantId, roleId }, data: { roleName: role.name } });
      await tx.role.delete({ where: { id: roleId } });
      await this.recordIn(tx, 'role.deleted', actorUserId, role, role.application.name, {
        permissions: role.permissions.map(describePermission).join(', '),
        revokedRoleAssignments: revoked,
      });
    });
  }

  /**
   * Adds an allow or deny Permission, optionally with a Condition. The Action and Resource Type must
   * be in the Schema and not Deprecated, and the Application must be enabled.
   */
  async addPermission(tenantId: string, actorUserId: string, roleId: string, input: PermissionInput): Promise<RoleDetail> {
    const rule = toRule(input);
    return this.scoped.inTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const role = await this.findIn(tx, tenantId, roleId);
      await this.lockEnabledApplication(tx, tenantId, role.applicationId);
      const schema = await loadSchemaIndex(tx, role.applicationId);
      schema.assertUsable(rule.resourceType, rule.action);
      if (role.permissions.some((existing) => sameRule(existing, rule))) throw duplicateRule(rule);
      if (role.permissions.length >= MAX_ROLE_PERMISSIONS) {
        throw new ConflictException(`A Role can have at most ${MAX_ROLE_PERMISSIONS} Permissions`);
      }
      await tx.permission.create({ data: { role: { connect: { id: roleId } }, ...toCreateData(tenantId, rule) } });
      await this.recordIn(tx, 'role.permission_added', actorUserId, role, role.application.name, {
        permission: describePermission(rule),
      });
      return this.detailIn(tx, tenantId, roleId);
    });
  }

  /** Removes a Permission, including one on a Deprecated entry or in a disabled Application. */
  async removePermission(tenantId: string, actorUserId: string, roleId: string, permissionId: string): Promise<RoleDetail> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const role = await this.findIn(tx, tenantId, roleId);
      const permission = role.permissions.find((candidate) => candidate.id === permissionId);
      if (!permission) throw new NotFoundException('Permission not found');
      await tx.permission.delete({ where: { id: permissionId } });
      await this.recordIn(tx, 'role.permission_removed', actorUserId, role, role.application.name, {
        permission: describePermission(permission),
      });
      return this.detailIn(tx, tenantId, roleId);
    });
  }

  /** Every Permission in the Tenant's Roles, oldest first, optionally for one Application or Resource Type. */
  async listPermissions(tenantId: string, filter: PermissionListFilter): Promise<Page<PermissionListItem>> {
    const window = pageWindow(filter, 'asc');
    return this.scoped.inTenant(tenantId, async (tx) => {
      const rows = await tx.permission.findMany({
        where: {
          tenantId,
          ...(filter.applicationId ? { role: { applicationId: filter.applicationId } } : {}),
          ...(filter.resourceType ? { resourceType: filter.resourceType } : {}),
          ...window.after,
        },
        include: { role: { select: { id: true, name: true, application: { select: { id: true, name: true } } } } },
        orderBy: window.orderBy,
        take: window.take,
      });
      const schemas = await loadSchemaIndexes(tx, [...new Set(rows.map((row) => row.role.application.id))]);
      return toPage(rows, window, (row) => ({
        id: row.id,
        resourceType: row.resourceType,
        action: row.action,
        inverted: row.inverted,
        conditions: row.conditions,
        deprecated: schemas.get(row.role.application.id)?.needsCleanUp(row.resourceType, row.action) ?? true,
        createdAt: row.createdAt,
        role: { id: row.role.id, name: row.role.name },
        application: row.role.application,
      }));
    });
  }

  /** Holds the Application row against Schema changes and requires the Tenant to have it enabled. */
  private async lockEnabledApplication(tx: ScopedTransaction, tenantId: string, applicationId: string): Promise<Application> {
    const application = await lockApplication(tx, applicationId, 'share');
    const enablement = await tx.enablement.findUnique({ where: { tenantId_applicationId: { tenantId, applicationId } } });
    if (!enablement || enablement.disabledAt !== null) {
      throw new ConflictException(`Enable ${application.name} before adding Roles or Permissions to it`);
    }
    return application;
  }

  private async enabledApplications(
    tx: ScopedTransaction,
    tenantId: string,
    applicationIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (applicationIds.length === 0) return new Set();
    const enablements = await tx.enablement.findMany({
      where: { tenantId, applicationId: { in: [...applicationIds] }, disabledAt: null },
      select: { applicationId: true },
    });
    return new Set(enablements.map((enablement) => enablement.applicationId));
  }

  private async findIn(tx: ScopedTransaction, tenantId: string, roleId: string): Promise<RoleWithApplication> {
    const role = await tx.role.findFirst({ where: { id: roleId, tenantId }, include: ROLE_WITH_APPLICATION });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private async detailIn(tx: ScopedTransaction, tenantId: string, roleId: string): Promise<RoleDetail> {
    const role = await this.findIn(tx, tenantId, roleId);
    const application = await tx.application.findUniqueOrThrow({ where: { id: role.applicationId }, include: SCHEMA_INCLUDE });
    const schema = new SchemaIndex(application.resourceTypes);
    const enabled = await this.enabledApplications(tx, tenantId, [role.applicationId]);
    return {
      ...toSummary(role, schema, enabled.has(role.applicationId)),
      resourceTypes: toSchemaView(application.resourceTypes, schema),
    };
  }

  /** Role changes join the Tenant's chain and name the Role and its Application. */
  private recordIn(
    tx: ScopedTransaction,
    eventType: AuditEventType,
    actorUserId: string,
    role: { readonly id: string; readonly tenantId: string; readonly applicationId: string; readonly name: string },
    applicationName: string,
    payload: AuditPayload,
  ): Promise<void> {
    return this.audit.recordIn(tx, {
      tenantId: role.tenantId,
      eventType,
      actorUserId,
      target: { type: 'role', id: role.id },
      applicationId: role.applicationId,
      payload: { role: role.name, application: applicationName, ...payload },
    });
  }
}

function assertNameFree(existing: readonly { readonly name: string }[], name: string): void {
  const lower = name.toLowerCase();
  if (existing.some((role) => role.name.toLowerCase() === lower)) {
    throw new ConflictException(`Role "${name}" already exists for this Application (names are compared ignoring case)`);
  }
}

function toSummary(role: RoleWithApplication, schema: SchemaIndex | undefined, enabled: boolean): RoleSummary {
  return {
    ...toRoleView(role, schema ?? new SchemaIndex([])),
    application: { id: role.application.id, name: role.application.name, enabled },
  };
}
