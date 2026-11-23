import { Injectable, NotFoundException } from '@nestjs/common';
import type { Application, Enablement } from '@prisma/client';
import { RoleTemplatesService } from '../applications/role-templates.service';
import { loadSchemaIndex, loadSchemaIndexes } from '../applications/schema-index';
import type { AuditEventType } from '../audit/audit-event-types';
import { AuditLog, type AuditPayload } from '../audit/audit-log.service';
import { type Page, type PageQuery, pageWindow, toPage } from '../common/pagination';
import { ScopedPrisma, type ScopedTransaction } from '../prisma/scoped-prisma';
import { ROLE_WITH_PERMISSIONS, type RoleView, toRoleView } from './role-view';

/** A registered Application as a Tenant Admin browses it, with this Tenant's Enablement. */
export interface TenantApplication {
  readonly id: string;
  readonly name: string;
  readonly registeredAt: Date;
  readonly enabled: boolean;
  /** When it was last enabled; null if never. */
  readonly enabledAt: Date | null;
  /** When it was disabled, while it is disabled. */
  readonly disabledAt: Date | null;
  /** This Tenant's Permissions for it that use Deprecated Resource Types or Actions. */
  readonly deprecatedPermissions: number;
}

export interface SchemaEntryView {
  readonly name: string;
  readonly deprecated: boolean;
}

export interface TenantResourceTypeView extends SchemaEntryView {
  readonly actions: readonly SchemaEntryView[];
}

/** A Role Template that enabling the Application for the first time will copy. */
export interface TemplatePreview {
  readonly name: string;
  readonly description: string;
  readonly permissionCount: number;
}

export interface TenantApplicationDetail extends TenantApplication {
  /** The Application Schema, so Permissions can be read against it. */
  readonly resourceTypes: readonly TenantResourceTypeView[];
  /** True once the Tenant has enabled it at least once, which is when Role Templates were copied. */
  readonly templatesCopied: boolean;
  /** Before the first Enablement only: the Role Templates it will copy. Empty afterwards. */
  readonly roleTemplates: readonly TemplatePreview[];
  /** The Tenant's Roles for this Application, oldest first. Kept while it is disabled. */
  readonly roles: readonly RoleView[];
}

/**
 * Locks the Tenant row until the transaction ends, so a Tenant's Enablement changes run one at a
 * time and two Tenant Admins enabling at once copy the Role Templates only once.
 */
async function lockTenant(tx: ScopedTransaction, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
}

/**
 * Holds the Application row against changes until the transaction ends. Role Template and Schema
 * changes lock it FOR UPDATE, so the templates and Deprecations read here can't change mid-copy.
 */
async function shareLockApplication(tx: ScopedTransaction, applicationId: string): Promise<Application> {
  await tx.$queryRaw`SELECT id FROM applications WHERE id = ${applicationId}::uuid FOR SHARE`;
  const application = await tx.application.findUnique({ where: { id: applicationId } });
  if (!application) throw new NotFoundException('Application not found');
  return application;
}

function toTenantApplication(
  application: Application,
  enablement: Enablement | undefined,
  deprecatedPermissions: number,
): TenantApplication {
  return {
    id: application.id,
    name: application.name,
    registeredAt: application.createdAt,
    enabled: enablement !== undefined && enablement.disabledAt === null,
    enabledAt: enablement?.enabledAt ?? null,
    disabledAt: enablement?.disabledAt ?? null,
    deprecatedPermissions,
  };
}

/**
 * Enablement: which registered Applications a Tenant uses. Enabling one for the first time copies
 * its Role Templates into the Tenant as ordinary Roles; disabling keeps them, and enabling again
 * brings them back as the Tenant left them without copying anything.
 */
@Injectable()
export class EnablementService {
  constructor(
    private readonly scoped: ScopedPrisma,
    private readonly templates: RoleTemplatesService,
    private readonly audit: AuditLog,
  ) {}

  /** Every registered Application, oldest first, with this Tenant's Enablement of each. */
  async list(tenantId: string, query: PageQuery): Promise<Page<TenantApplication>> {
    const window = pageWindow(query, 'asc');
    return this.scoped.inTenant(tenantId, async (tx) => {
      const rows = await tx.application.findMany({ where: window.after, orderBy: window.orderBy, take: window.take });
      const ids = rows.slice(0, window.limit).map((row) => row.id);
      const enablements = await tx.enablement.findMany({ where: { tenantId, applicationId: { in: ids } } });
      const deprecated = await this.countDeprecatedPermissions(tx, tenantId, ids);
      return toPage(rows, window, (row) =>
        toTenantApplication(
          row,
          enablements.find((enablement) => enablement.applicationId === row.id),
          deprecated.get(row.id) ?? 0,
        ),
      );
    });
  }

  async get(tenantId: string, applicationId: string): Promise<TenantApplicationDetail> {
    return this.scoped.inTenant(tenantId, (tx) => this.detailIn(tx, tenantId, applicationId));
  }

  /**
   * Enables an Application for the Tenant. The first time, its Role Templates are copied in as
   * Roles, leaving out Permissions on Deprecated entries, which no new Permission may use.
   * Enabling one that is already enabled changes nothing.
   */
  async enable(tenantId: string, actorUserId: string, applicationId: string): Promise<TenantApplicationDetail> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const application = await shareLockApplication(tx, applicationId);
      const existing = await tx.enablement.findUnique({ where: { tenantId_applicationId: { tenantId, applicationId } } });
      const now = new Date();

      if (existing) {
        if (existing.disabledAt !== null) {
          await tx.enablement.update({ where: { id: existing.id }, data: { enabledAt: now, disabledAt: null } });
          const roles = await tx.role.count({ where: { tenantId, applicationId } });
          await this.recordIn(tx, tenantId, 'application.enabled', actorUserId, application, {
            firstEnablement: false,
            rolesKept: roles,
          });
        }
        return this.detailIn(tx, tenantId, applicationId);
      }

      await tx.enablement.create({ data: { tenantId, applicationId, enabledAt: now } });
      const schema = await loadSchemaIndex(tx, applicationId);
      const templates = await this.templates.templatesToCopy(tx, applicationId);
      let permissionsSkipped = 0;
      for (const template of templates) {
        const usable = template.permissions.filter((rule) => !schema.isFlagged(rule.resourceType, rule.action));
        permissionsSkipped += template.permissions.length - usable.length;
        await tx.role.create({
          data: {
            tenantId,
            applicationId,
            name: template.name,
            description: template.description,
            permissions: { create: usable.map((rule) => ({ tenantId, ...rule })) },
          },
        });
      }
      await this.recordIn(tx, tenantId, 'application.enabled', actorUserId, application, {
        firstEnablement: true,
        rolesCopied: templates.length,
        roles: templates.map((template) => template.name).join(', '),
        deprecatedPermissionsSkipped: permissionsSkipped,
      });
      return this.detailIn(tx, tenantId, applicationId);
    });
  }

  /**
   * Disables an Application for the Tenant. Its Roles, Permissions and (later) Role Assignments are
   * kept, but Access Checks for it are denied until it is enabled again. Disabling one that isn't
   * enabled changes nothing.
   */
  async disable(tenantId: string, actorUserId: string, applicationId: string): Promise<TenantApplicationDetail> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const application = await shareLockApplication(tx, applicationId);
      const existing = await tx.enablement.findUnique({ where: { tenantId_applicationId: { tenantId, applicationId } } });
      if (existing && existing.disabledAt === null) {
        await tx.enablement.update({ where: { id: existing.id }, data: { disabledAt: new Date() } });
        const roles = await tx.role.count({ where: { tenantId, applicationId } });
        await this.recordIn(tx, tenantId, 'application.disabled', actorUserId, application, { rolesKept: roles });
      }
      return this.detailIn(tx, tenantId, applicationId);
    });
  }

  private async detailIn(tx: ScopedTransaction, tenantId: string, applicationId: string): Promise<TenantApplicationDetail> {
    const application = await tx.application.findUnique({
      where: { id: applicationId },
      include: { resourceTypes: { orderBy: { name: 'asc' }, include: { actions: { orderBy: { name: 'asc' } } } } },
    });
    if (!application) throw new NotFoundException('Application not found');
    const enablement = await tx.enablement.findUnique({ where: { tenantId_applicationId: { tenantId, applicationId } } });
    const roles = await tx.role.findMany({
      where: { tenantId, applicationId },
      include: ROLE_WITH_PERMISSIONS,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const previews = enablement
      ? []
      : (await this.templates.templatesToCopy(tx, applicationId)).map((template) => ({
          name: template.name,
          description: template.description,
          permissionCount: template.permissions.length,
        }));

    const schema = await loadSchemaIndex(tx, applicationId);
    const roleViews = roles.map((role) => toRoleView(role, schema));
    const deprecated = roleViews.reduce(
      (sum, role) => sum + role.permissions.filter((permission) => permission.deprecated).length,
      0,
    );
    return {
      ...toTenantApplication(application, enablement ?? undefined, deprecated),
      resourceTypes: application.resourceTypes.map((resourceType) => ({
        name: resourceType.name,
        deprecated: resourceType.deprecatedAt !== null,
        actions: resourceType.actions.map((action) => ({
          name: action.name,
          deprecated: resourceType.deprecatedAt !== null || action.deprecatedAt !== null,
        })),
      })),
      templatesCopied: enablement !== null,
      roleTemplates: previews,
      roles: roleViews,
    };
  }

  /** How many of the Tenant's Permissions for each Application use Deprecated Schema entries. */
  private async countDeprecatedPermissions(
    tx: ScopedTransaction,
    tenantId: string,
    applicationIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (applicationIds.length === 0) return new Map();
    const roles = await tx.role.findMany({
      where: { tenantId, applicationId: { in: [...applicationIds] } },
      select: { id: true, applicationId: true },
    });
    if (roles.length === 0) return new Map();
    const groups = await tx.permission.groupBy({
      by: ['roleId', 'resourceType', 'action'],
      where: { tenantId, roleId: { in: roles.map((role) => role.id) } },
      _count: { _all: true },
    });
    const schemas = await loadSchemaIndexes(tx, applicationIds);
    const applicationOfRole = new Map(roles.map((role) => [role.id, role.applicationId] as const));
    const counts = new Map<string, number>();
    for (const group of groups) {
      const applicationId = applicationOfRole.get(group.roleId);
      const schema = applicationId === undefined ? undefined : schemas.get(applicationId);
      if (applicationId === undefined || !schema?.isFlagged(group.resourceType, group.action)) continue;
      counts.set(applicationId, (counts.get(applicationId) ?? 0) + group._count._all);
    }
    return counts;
  }

  /** Enablement changes join the Tenant's chain and name the Application. */
  private recordIn(
    tx: ScopedTransaction,
    tenantId: string,
    eventType: AuditEventType,
    actorUserId: string,
    application: Application,
    payload: AuditPayload,
  ): Promise<void> {
    return this.audit.recordIn(tx, {
      tenantId,
      eventType,
      actorUserId,
      target: { type: 'application', id: application.id },
      applicationId: application.id,
      payload: { application: application.name, ...payload },
    });
  }
}
