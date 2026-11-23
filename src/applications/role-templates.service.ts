import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditEventType } from '../audit/audit-event-types';
import { AuditLog, type AuditPayload } from '../audit/audit-log.service';
import { type Page, type PageQuery, pageWindow, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import type { ScopedTransaction } from '../prisma/scoped-prisma';
import { lockApplication } from './application-lock';
import { MAX_TEMPLATE_PERMISSIONS } from './dto/role-template.dto';
import { loadSchemaIndex, type SchemaIndex } from './schema-index';

/** Role Templates per Application. Each is copied into every Tenant that enables the Application. */
export const MAX_ROLE_TEMPLATES = 50;

export interface PermissionRule {
  readonly resourceType: string;
  readonly action: string;
  /** true for a Deny Rule. */
  readonly inverted: boolean;
}

export interface TemplatePermissionView extends PermissionRule {
  readonly id: string;
  /** Uses a Deprecated Resource Type or Action (or one no longer in the Schema): flagged for clean-up. */
  readonly deprecated: boolean;
}

export interface RoleTemplateView {
  readonly id: string;
  readonly applicationId: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly TemplatePermissionView[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateRoleTemplateInput {
  readonly name: string;
  readonly description?: string;
  readonly permissions?: readonly PermissionInput[];
}

export interface UpdateRoleTemplateInput {
  readonly name?: string;
  readonly description?: string;
}

export interface PermissionInput {
  readonly resourceType: string;
  readonly action: string;
  readonly inverted?: boolean;
}

/** A Role Template as copied into a Tenant when it enables the Application. */
export interface TemplateToCopy {
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly PermissionRule[];
}

const WITH_PERMISSIONS = {
  permissions: { orderBy: [{ resourceType: 'asc' }, { action: 'asc' }, { inverted: 'asc' }] },
} as const satisfies Prisma.RoleTemplateInclude;

type TemplateWithPermissions = Prisma.RoleTemplateGetPayload<{ include: typeof WITH_PERMISSIONS }>;

function toView(template: TemplateWithPermissions, schema: SchemaIndex): RoleTemplateView {
  return {
    id: template.id,
    applicationId: template.applicationId,
    name: template.name,
    description: template.description,
    permissions: template.permissions.map((permission) => ({
      id: permission.id,
      resourceType: permission.resourceType,
      action: permission.action,
      inverted: permission.inverted,
      deprecated: schema.isFlagged(permission.resourceType, permission.action),
    })),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

/** "allow read Document" or "deny export Invoice", for audit payloads. */
export function describeRule(rule: PermissionRule): string {
  return `${rule.inverted ? 'deny' : 'allow'} ${rule.action} ${rule.resourceType}`;
}

function toRule(input: PermissionInput): PermissionRule {
  return { resourceType: input.resourceType, action: input.action, inverted: input.inverted ?? false };
}

function sameRule(a: PermissionRule, b: PermissionRule): boolean {
  return a.resourceType === b.resourceType && a.action === b.action && a.inverted === b.inverted;
}

function duplicateRule(rule: PermissionRule): ConflictException {
  return new ConflictException(`The template already has "${describeRule(rule)}"`);
}

/**
 * Role Templates, for Platform Admins. Platform-level only: it never sets a Tenant context. Every
 * change locks the Application, so names stay unique ignoring case and new Permissions can't use a
 * Schema entry that is being Deprecated at the same moment.
 */
@Injectable()
export class RoleTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  /** The Application's Role Templates, oldest first. */
  async list(applicationId: string, query: PageQuery): Promise<Page<RoleTemplateView>> {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId }, select: { id: true } });
    if (!application) throw new NotFoundException('Application not found');
    const window = pageWindow(query, 'asc');
    const [rows, schema] = await Promise.all([
      this.prisma.roleTemplate.findMany({
        where: { applicationId, ...window.after },
        include: WITH_PERMISSIONS,
        orderBy: window.orderBy,
        take: window.take,
      }),
      loadSchemaIndex(this.prisma, applicationId),
    ]);
    return toPage(rows, window, (row) => toView(row, schema));
  }

  async create(actorUserId: string, applicationId: string, input: CreateRoleTemplateInput): Promise<RoleTemplateView> {
    const rules: PermissionRule[] = [];
    for (const rule of (input.permissions ?? []).map(toRule)) {
      if (rules.some((existing) => sameRule(existing, rule))) throw duplicateRule(rule);
      rules.push(rule);
    }
    return this.prisma.$transaction(async (tx) => {
      await lockApplication(tx, applicationId);
      const schema = await loadSchemaIndex(tx, applicationId);
      rules.forEach((rule) => schema.assertUsable(rule.resourceType, rule.action));
      const templates = await tx.roleTemplate.findMany({ where: { applicationId }, select: { name: true } });
      if (templates.length >= MAX_ROLE_TEMPLATES) {
        throw new ConflictException(`An Application can have at most ${MAX_ROLE_TEMPLATES} Role Templates`);
      }
      this.assertNameFree(templates, input.name);
      const created = await tx.roleTemplate.create({
        data: { applicationId, name: input.name, description: input.description ?? '', permissions: { create: rules } },
        include: WITH_PERMISSIONS,
      });
      await this.recordIn(tx, 'role_template.created', actorUserId, created, {
        permissions: rules.map(describeRule).join(', '),
      });
      return toView(created, schema);
    });
  }

  /** Rename a template or change its description. Copies already in Tenants don't change. */
  async update(
    actorUserId: string,
    applicationId: string,
    templateId: string,
    input: UpdateRoleTemplateInput,
  ): Promise<RoleTemplateView> {
    return this.prisma.$transaction(async (tx) => {
      await lockApplication(tx, applicationId);
      const template = await this.findIn(tx, applicationId, templateId);
      const name = input.name ?? template.name;
      const description = input.description ?? template.description;
      if (name !== template.name || description !== template.description) {
        if (name.toLowerCase() !== template.name.toLowerCase()) {
          const others = await tx.roleTemplate.findMany({
            where: { applicationId, id: { not: templateId } },
            select: { name: true },
          });
          this.assertNameFree(others, name);
        }
        await tx.roleTemplate.update({ where: { id: templateId }, data: { name, description } });
        await this.recordIn(tx, 'role_template.updated', actorUserId, template, {
          ...(name !== template.name ? { previousName: template.name, name } : {}),
          descriptionChanged: description !== template.description,
        });
      }
      return this.viewIn(tx, applicationId, templateId);
    });
  }

  /** Delete a template. Copies already in Tenants are ordinary Roles and stay. */
  async remove(actorUserId: string, applicationId: string, templateId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockApplication(tx, applicationId);
      const template = await this.findIn(tx, applicationId, templateId);
      await tx.roleTemplate.delete({ where: { id: templateId } });
      await this.recordIn(tx, 'role_template.deleted', actorUserId, template, {});
    });
  }

  /** Adds an allow or deny Permission. The Action and Resource Type must be in the Schema and not Deprecated. */
  async addPermission(
    actorUserId: string,
    applicationId: string,
    templateId: string,
    input: PermissionInput,
  ): Promise<RoleTemplateView> {
    const rule = toRule(input);
    return this.prisma.$transaction(async (tx) => {
      await lockApplication(tx, applicationId);
      const template = await this.findIn(tx, applicationId, templateId);
      const schema = await loadSchemaIndex(tx, applicationId);
      schema.assertUsable(rule.resourceType, rule.action);
      if (template.permissions.some((existing) => sameRule(existing, rule))) throw duplicateRule(rule);
      if (template.permissions.length >= MAX_TEMPLATE_PERMISSIONS) {
        throw new ConflictException(`A Role Template can have at most ${MAX_TEMPLATE_PERMISSIONS} Permissions`);
      }
      await tx.roleTemplatePermission.create({ data: { roleTemplateId: templateId, ...rule } });
      await this.recordIn(tx, 'role_template.permission_added', actorUserId, template, { permission: describeRule(rule) });
      return toView(await this.findIn(tx, applicationId, templateId), schema);
    });
  }

  /** Removes a Permission, including one that uses a Deprecated entry. */
  async removePermission(
    actorUserId: string,
    applicationId: string,
    templateId: string,
    permissionId: string,
  ): Promise<RoleTemplateView> {
    return this.prisma.$transaction(async (tx) => {
      await lockApplication(tx, applicationId);
      const template = await this.findIn(tx, applicationId, templateId);
      const permission = template.permissions.find((candidate) => candidate.id === permissionId);
      if (!permission) throw new NotFoundException('Permission not found');
      await tx.roleTemplatePermission.delete({ where: { id: permissionId } });
      await this.recordIn(tx, 'role_template.permission_removed', actorUserId, template, {
        permission: describeRule(permission),
      });
      return this.viewIn(tx, applicationId, templateId);
    });
  }

  /**
   * The Application's Role Templates as they are now, for copying into a Tenant inside the
   * caller's transaction. Includes Permissions on Deprecated entries; the caller decides.
   */
  async templatesToCopy(tx: ScopedTransaction, applicationId: string): Promise<readonly TemplateToCopy[]> {
    const templates = await tx.roleTemplate.findMany({
      where: { applicationId },
      include: WITH_PERMISSIONS,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return templates.map((template) => ({
      name: template.name,
      description: template.description,
      permissions: template.permissions.map((permission) => ({
        resourceType: permission.resourceType,
        action: permission.action,
        inverted: permission.inverted,
      })),
    }));
  }

  private assertNameFree(existing: readonly { readonly name: string }[], name: string): void {
    const lower = name.toLowerCase();
    if (existing.some((template) => template.name.toLowerCase() === lower)) {
      throw new ConflictException(`Role Template "${name}" already exists (names are compared ignoring case)`);
    }
  }

  private async findIn(tx: ScopedTransaction, applicationId: string, templateId: string): Promise<TemplateWithPermissions> {
    const template = await tx.roleTemplate.findFirst({ where: { id: templateId, applicationId }, include: WITH_PERMISSIONS });
    if (!template) throw new NotFoundException('Role Template not found');
    return template;
  }

  private async viewIn(tx: ScopedTransaction, applicationId: string, templateId: string): Promise<RoleTemplateView> {
    const template = await this.findIn(tx, applicationId, templateId);
    return toView(template, await loadSchemaIndex(tx, applicationId));
  }

  /** Platform Admin actions join the platform chain (no Tenant) and name the Application. */
  private recordIn(
    tx: ScopedTransaction,
    eventType: AuditEventType,
    actorUserId: string,
    template: { readonly id: string; readonly applicationId: string; readonly name: string },
    payload: AuditPayload,
  ): Promise<void> {
    return this.audit.recordIn(tx, {
      tenantId: null,
      eventType,
      actorUserId,
      target: { type: 'role_template', id: template.id },
      applicationId: template.applicationId,
      payload: { roleTemplate: template.name, ...payload },
    });
  }
}
