import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AccessCheckResult, GateReason } from '../access-check/access-check.service';
import { AccessCheckService } from '../access-check/access-check.service';
import { activeAssignmentWhere } from '../access-rules/role-assignment-ending';
import type { ApplicationSummary } from '../applications/applications.service';
import { loadSchemaIndex, type SchemaAction } from '../applications/schema-index';
import { AuditLog } from '../audit/audit-log.service';
import { type Page, type PageQuery, pageWindow, toPage } from '../common/pagination';
import { isUniqueConstraintError } from '../common/prisma-errors';
import { ScopedPrisma, type ScopedTransaction } from '../prisma/scoped-prisma';
import type {
  ApplicationResourceListQuery,
  PutRegisteredResourceDto,
  RegisteredResourcePath,
  TenantResourceListQuery,
} from './dto/registered-resource.dto';
import { parseAttributes, storedAttributes } from './resource-attributes';

/** A Registered Resource as the API shows it. resourceId is the Application's own ID. */
export interface RegisteredResourceView {
  readonly id: string;
  readonly application: { readonly id: string; readonly name: string };
  readonly resourceType: string;
  readonly resourceId: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What a PUT did: created answers 201, anything else 200. */
export interface PutResult {
  readonly created: boolean;
  readonly resource: RegisteredResourceView;
}

/** The person a row of the report is about. */
export interface ReportMember {
  readonly membershipId: string;
  readonly userId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

/** One Action's Access Check answer for one Membership. */
export interface ActionAnswer extends AccessCheckResult {
  readonly action: string;
}

export interface ResourceAccessRow {
  readonly member: ReportMember;
  /** One answer per Action of the report, in the same order. */
  readonly answers: readonly ActionAnswer[];
}

/**
 * Access by Registered Resource: what an Access Check would answer, for each Membership holding an
 * active Role in the resource's Application, for each Action of its Resource Type, with its stored
 * attributes. Memberships with no such Role are left out: every Access Check denies them.
 */
export interface ResourceAccessReport extends Page<ResourceAccessRow> {
  readonly resource: RegisteredResourceView;
  /** When the answers were worked out: Temporary Role Assignments count only until they expire. */
  readonly asOf: Date;
  readonly actions: readonly SchemaAction[];
  /** Why every Access Check about the resource is denied now (suspension, Enablement), or null. */
  readonly deniedBecause: GateReason | null;
  /** The Roles that decided an answer on this page. */
  readonly roles: readonly { readonly id: string; readonly name: string }[];
}

const RESOURCE_INCLUDE = { application: { select: { id: true, name: true } } } as const satisfies Prisma.RegisteredResourceInclude;

type ResourceRow = Prisma.RegisteredResourceGetPayload<{ include: typeof RESOURCE_INCLUDE }>;

function toView(row: ResourceRow): RegisteredResourceView {
  return {
    id: row.id,
    application: row.application,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    attributes: storedAttributes(row.attributes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Top-level attribute names whose values differ, for the audit entry (never the values themselves). */
function changedKeys(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

/**
 * Registered Resources: specific resources an Application tells Sentinel about, kept per Tenant, and
 * the access-by-Registered-Resource report that runs the Access Check gates and engine over each
 * Membership against a resource's stored attributes.
 */
@Injectable()
export class RegisteredResourcesService {
  constructor(
    private readonly scoped: ScopedPrisma,
    private readonly audit: AuditLog,
    private readonly accessChecks: AccessCheckService,
  ) {}

  // ---- The Application API -----------------------------------------------------------------------

  /**
   * Creates the resource, or replaces its attributes. The Resource Type must be in the Application
   * Schema; Deprecated ones are allowed, as Access Checks still ask about them.
   */
  async put(application: ApplicationSummary, path: RegisteredResourcePath, body: PutRegisteredResourceDto): Promise<PutResult> {
    const attributes = parseAttributes(body.attributes);
    try {
      return await this.putOnce(application, path, attributes);
    } catch (error: unknown) {
      // Two PUTs of a new resource raced and the other created it first: this one is now an update.
      if (!isUniqueConstraintError(error)) throw error;
      return this.putOnce(application, path, attributes);
    }
  }

  private putOnce(application: ApplicationSummary, path: RegisteredResourcePath, attributes: Prisma.InputJsonObject): Promise<PutResult> {
    return this.inEnablingTenant(application, path.tenantId, async (tx) => {
      (await loadSchemaIndex(tx, application.id)).assertResourceType(path.resourceType);
      const existing = await this.findByKey(tx, application.id, path);
      if (!existing) {
        const created = await tx.registeredResource.create({
          data: {
            tenantId: path.tenantId,
            applicationId: application.id,
            resourceType: path.resourceType,
            resourceId: path.resourceId,
            attributes,
          },
          include: RESOURCE_INCLUDE,
        });
        await this.record(tx, 'registered_resource.created', application, created, {});
        return { created: true, resource: toView(created) };
      }
      const changed = changedKeys(storedAttributes(existing.attributes), attributes);
      // An unchanged PUT writes nothing, so Applications can resend their resources freely.
      if (changed.length === 0) return { created: false, resource: toView(existing) };
      const updated = await tx.registeredResource.update({ where: { id: existing.id }, data: { attributes }, include: RESOURCE_INCLUDE });
      await this.record(tx, 'registered_resource.updated', application, updated, { changedAttributes: changed.join(',') });
      return { created: false, resource: toView(updated) };
    });
  }

  async getForApplication(application: ApplicationSummary, path: RegisteredResourcePath): Promise<RegisteredResourceView> {
    return this.inEnablingTenant(application, path.tenantId, async (tx) => {
      const row = await this.findByKey(tx, application.id, path);
      if (!row) throw new NotFoundException('Registered Resource not found');
      return toView(row);
    });
  }

  async delete(application: ApplicationSummary, path: RegisteredResourcePath): Promise<void> {
    await this.inEnablingTenant(application, path.tenantId, async (tx) => {
      const row = await this.findByKey(tx, application.id, path);
      if (!row) throw new NotFoundException('Registered Resource not found');
      await tx.registeredResource.delete({ where: { id: row.id } });
      await this.record(tx, 'registered_resource.deleted', application, row, {});
    });
  }

  /** The Application's own resources in one Tenant, newest first. */
  async listForApplication(
    application: ApplicationSummary,
    tenantId: string,
    query: ApplicationResourceListQuery,
  ): Promise<Page<RegisteredResourceView>> {
    return this.inEnablingTenant(application, tenantId, (tx) =>
      this.page(tx, { tenantId, applicationId: application.id, resourceType: query.resourceType }, query),
    );
  }

  /**
   * Runs work in the Tenant's context once it is known to have the Application enabled. An unknown
   * Tenant gets the same 403 as one that hasn't enabled it, so Applications learn nothing about
   * Tenants they don't serve.
   */
  private inEnablingTenant<T>(application: ApplicationSummary, tenantId: string, work: (tx: ScopedTransaction) => Promise<T>): Promise<T> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      const enablement = await tx.enablement.findUnique({
        where: { tenantId_applicationId: { tenantId, applicationId: application.id } },
        select: { disabledAt: true },
      });
      if (!enablement || enablement.disabledAt !== null) {
        throw new ForbiddenException('The Tenant has not enabled this Application');
      }
      return work(tx);
    });
  }

  private findByKey(tx: ScopedTransaction, applicationId: string, path: RegisteredResourcePath): Promise<ResourceRow | null> {
    return tx.registeredResource.findUnique({
      where: {
        tenantId_applicationId_resourceType_resourceId: {
          tenantId: path.tenantId,
          applicationId,
          resourceType: path.resourceType,
          resourceId: path.resourceId,
        },
      },
      include: RESOURCE_INCLUDE,
    });
  }

  /** A registered_resource.* entry in the Tenant's chain. The attributes stay out: they are the Application's data. */
  private record(
    tx: ScopedTransaction,
    eventType: 'registered_resource.created' | 'registered_resource.updated' | 'registered_resource.deleted',
    application: ApplicationSummary,
    row: ResourceRow,
    extra: { readonly changedAttributes?: string },
  ): Promise<void> {
    return this.audit.recordIn(tx, {
      tenantId: row.tenantId,
      eventType,
      actorUserId: null,
      target: { type: 'resource', id: row.resourceId },
      applicationId: application.id,
      payload: {
        registeredResourceId: row.id,
        application: application.name,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        ...extra,
      },
    });
  }

  // ---- The Tenant Admin console ------------------------------------------------------------------

  /** The Tenant's Registered Resources, newest first, optionally of one Application, Resource Type or ID. */
  list(tenantId: string, query: TenantResourceListQuery): Promise<Page<RegisteredResourceView>> {
    return this.scoped.inTenant(tenantId, (tx) =>
      this.page(
        tx,
        { tenantId, applicationId: query.applicationId, resourceType: query.resourceType, resourceId: query.resourceId },
        query,
      ),
    );
  }

  get(tenantId: string, id: string): Promise<RegisteredResourceView> {
    return this.scoped.inTenant(tenantId, async (tx) => toView(await this.findById(tx, tenantId, id)));
  }

  /** The access-by-Registered-Resource report, one page of Memberships (oldest first) at a time. */
  report(tenantId: string, id: string, query: PageQuery): Promise<ResourceAccessReport> {
    return this.scoped.inTenant(tenantId, async (tx) => {
      const row = await this.findById(tx, tenantId, id);
      const resource = toView(row);
      const now = new Date();
      const actions = (await loadSchemaIndex(tx, row.applicationId)).actionsOf(row.resourceType);
      const window = pageWindow(query, 'asc');
      const memberships = await tx.membership.findMany({
        where: {
          tenantId,
          roleAssignments: { some: { applicationId: row.applicationId, ...activeAssignmentWhere(now) } },
          ...window.after,
        },
        include: { user: { select: { email: true, firstName: true, lastName: true } } },
        orderBy: window.orderBy,
        take: window.take,
      });
      const shown = memberships.slice(0, window.limit);
      const { deniedBecause, answers } = await this.accessChecks.answerMany(
        tx,
        now,
        tenantId,
        row.applicationId,
        shown.map((membership) => ({ userId: membership.userId, membershipId: membership.id, tenantId })),
        { resourceType: row.resourceType, actions: actions.map((action) => action.name), attributes: resource.attributes },
      );

      const roleIds = new Set<string>();
      const page = toPage(memberships, window, (membership): ResourceAccessRow => {
        const results = answers.get(membership.id) ?? [];
        return {
          member: {
            membershipId: membership.id,
            userId: membership.userId,
            email: membership.user.email,
            firstName: membership.user.firstName,
            lastName: membership.user.lastName,
          },
          answers: actions.map((action, index): ActionAnswer => {
            const result = results[index] ?? { allowed: false, reason: 'no-matching-permission' };
            if (result.roleId) roleIds.add(result.roleId);
            return { action: action.name, ...result };
          }),
        };
      });
      const roles = await tx.role.findMany({
        where: { tenantId, id: { in: [...roleIds] } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      return { ...page, resource, asOf: now, actions, deniedBecause, roles };
    });
  }

  private async findById(tx: ScopedTransaction, tenantId: string, id: string): Promise<ResourceRow> {
    const row = await tx.registeredResource.findFirst({ where: { id, tenantId }, include: RESOURCE_INCLUDE });
    if (!row) throw new NotFoundException('Registered Resource not found');
    return row;
  }

  private async page(
    tx: ScopedTransaction,
    filter: { readonly tenantId: string; readonly applicationId?: string; readonly resourceType?: string; readonly resourceId?: string },
    query: PageQuery,
  ): Promise<Page<RegisteredResourceView>> {
    const window = pageWindow(query, 'desc');
    const rows = await tx.registeredResource.findMany({
      where: { ...filter, ...window.after },
      include: RESOURCE_INCLUDE,
      orderBy: window.orderBy,
      take: window.take,
    });
    return toPage(rows, window, toView);
  }
}
