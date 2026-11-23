import { randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditEventType } from '../audit/audit-event-types';
import { AuditLog, type AuditPayload } from '../audit/audit-log.service';
import { generateOpaqueToken, hashOpaqueToken } from '../common/opaque-token';
import { type Page, type PageQuery, pageWindow, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import type { ScopedTransaction } from '../prisma/scoped-prisma';
import { lockApplication } from './application-lock';
import { RESERVED_ACTION_NAMES, RESERVED_RESOURCE_TYPE_NAMES } from './schema-names';

/** An Application as the Platform Admin console lists it. Never includes the secret or its hash. */
export interface ApplicationSummary {
  readonly id: string;
  readonly name: string;
  readonly clientId: string;
  readonly allowedOrigins: readonly string[];
  readonly secretIssuedAt: Date;
  readonly createdAt: Date;
}

export interface SchemaAction {
  readonly id: string;
  readonly name: string;
  readonly deprecatedAt: Date | null;
  /** Deprecated itself, or its Resource Type is. */
  readonly deprecated: boolean;
}

export interface SchemaResourceType {
  readonly id: string;
  readonly name: string;
  readonly deprecatedAt: Date | null;
  readonly actions: readonly SchemaAction[];
}

/** An Application with its Application Schema. */
export interface ApplicationDetail extends ApplicationSummary {
  readonly resourceTypes: readonly SchemaResourceType[];
}

/** A newly issued client secret. It is returned this once and never again. */
export interface IssuedSecret {
  readonly application: ApplicationDetail;
  readonly clientSecret: string;
}

export interface RegisterApplicationInput {
  readonly name: string;
  readonly allowedOrigins: readonly string[];
}

const WITH_SCHEMA = {
  resourceTypes: { orderBy: { name: 'asc' }, include: { actions: { orderBy: { name: 'asc' } } } },
} as const satisfies Prisma.ApplicationInclude;

type ApplicationRow = Prisma.ApplicationGetPayload<object>;
type ApplicationWithSchema = Prisma.ApplicationGetPayload<{ include: typeof WITH_SCHEMA }>;

function toSummary(application: ApplicationRow): ApplicationSummary {
  return {
    id: application.id,
    name: application.name,
    clientId: application.clientId,
    allowedOrigins: application.allowedOrigins,
    secretIssuedAt: application.secretIssuedAt,
    createdAt: application.createdAt,
  };
}

function toDetail(application: ApplicationWithSchema): ApplicationDetail {
  return {
    ...toSummary(application),
    resourceTypes: application.resourceTypes.map((resourceType) => ({
      id: resourceType.id,
      name: resourceType.name,
      deprecatedAt: resourceType.deprecatedAt,
      actions: resourceType.actions.map((action) => ({
        id: action.id,
        name: action.name,
        deprecatedAt: action.deprecatedAt,
        deprecated: action.deprecatedAt !== null || resourceType.deprecatedAt !== null,
      })),
    })),
  };
}

/**
 * An allowed origin as the browser sends it in the Origin header: scheme, host and port only.
 * Accepts http and https, with nothing after the host but an optional "/".
 */
export function normalizeOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BadRequestException(`"${raw}" is not a valid origin`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException(`"${raw}" must use http or https`);
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new BadRequestException(`"${raw}" must be just scheme, host and port, such as https://app.example.com`);
  }
  return url.origin;
}

function generateClientId(): string {
  return `app_${randomBytes(12).toString('hex')}`;
}

function assertNotReserved(name: string, reserved: readonly string[], kind: string): void {
  if (reserved.includes(name.toLowerCase())) {
    throw new BadRequestException(`"${name}" is reserved and can't be used as ${kind} name`);
  }
}

/** Throws if a name is already taken in the list, ignoring case. */
function assertUniqueName(existing: readonly { readonly name: string }[], name: string, kind: string): void {
  const lower = name.toLowerCase();
  if (existing.some((entry) => entry.name.toLowerCase() === lower)) {
    throw new ConflictException(`${kind} "${name}" already exists (names are compared ignoring case)`);
  }
}

/**
 * The Application registry and Application Schemas, for Platform Admins. Platform-level only: it
 * never sets a Tenant context, so RLS keeps every Tenant-owned table out of its reach.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  /**
   * The Application these client credentials belong to, or null if the client ID is unknown or the
   * secret isn't its current one. Hashes are compared in constant time.
   */
  async verifyClient(clientId: string, clientSecret: string): Promise<ApplicationSummary | null> {
    const application = await this.prisma.application.findUnique({ where: { clientId } });
    const presented = Buffer.from(hashOpaqueToken(clientSecret), 'hex');
    const stored = Buffer.from(application?.clientSecretHash ?? hashOpaqueToken(''), 'hex');
    const matches = presented.length === stored.length && timingSafeEqual(presented, stored);
    return application && matches ? toSummary(application) : null;
  }

  /** Newest first. */
  async list(query: PageQuery): Promise<Page<ApplicationSummary>> {
    const window = pageWindow(query, 'desc');
    const rows = await this.prisma.application.findMany({ where: window.after, orderBy: window.orderBy, take: window.take });
    return toPage(rows, window, toSummary);
  }

  async get(applicationId: string): Promise<ApplicationDetail> {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId }, include: WITH_SCHEMA });
    if (!application) throw new NotFoundException('Application not found');
    return toDetail(application);
  }

  /** Registers an Application and issues its client ID and secret. */
  async register(actorUserId: string, input: RegisterApplicationInput): Promise<IssuedSecret> {
    const allowedOrigins = [...new Set(input.allowedOrigins.map(normalizeOrigin))];
    const clientSecret = generateOpaqueToken();
    const application = await this.prisma.$transaction(async (tx) => {
      const created = await tx.application.create({
        data: {
          name: input.name,
          clientId: generateClientId(),
          clientSecretHash: hashOpaqueToken(clientSecret),
          secretIssuedAt: new Date(),
          allowedOrigins,
        },
        include: WITH_SCHEMA,
      });
      await this.recordIn(tx, 'application.registered', actorUserId, created.id, {
        name: created.name,
        clientId: created.clientId,
        allowedOrigins: allowedOrigins.join(' '),
      });
      return created;
    });
    return { application: toDetail(application), clientSecret };
  }

  /** Issues a new client secret. The previous one stops working at once. */
  async rotateSecret(actorUserId: string, applicationId: string): Promise<IssuedSecret> {
    const clientSecret = generateOpaqueToken();
    const application = await this.prisma.$transaction(async (tx) => {
      await lockApplication(tx, applicationId);
      const updated = await tx.application.update({
        where: { id: applicationId },
        data: { clientSecretHash: hashOpaqueToken(clientSecret), secretIssuedAt: new Date() },
        include: WITH_SCHEMA,
      });
      await this.recordIn(tx, 'application.secret_rotated', actorUserId, applicationId, {});
      return updated;
    });
    return { application: toDetail(application), clientSecret };
  }

  /** Adds a Resource Type to the Application Schema, optionally with its first Actions. */
  async addResourceType(
    actorUserId: string,
    applicationId: string,
    name: string,
    actionNames: readonly string[],
  ): Promise<ApplicationDetail> {
    assertNotReserved(name, RESERVED_RESOURCE_TYPE_NAMES, 'a Resource Type');
    actionNames.forEach((action) => assertNotReserved(action, RESERVED_ACTION_NAMES, 'an Action'));
    const uniqueActions: { readonly name: string }[] = [];
    actionNames.forEach((action) => {
      assertUniqueName(uniqueActions, action, 'Action');
      uniqueActions.push({ name: action });
    });

    await this.prisma.$transaction(async (tx) => {
      const application = await lockApplication(tx, applicationId);
      assertUniqueName(application.resourceTypes, name, 'Resource Type');
      const resourceType = await tx.resourceType.create({
        data: { applicationId, name, actions: { create: uniqueActions } },
      });
      await this.recordIn(tx, 'application.resource_type_added', actorUserId, applicationId, {
        resourceTypeId: resourceType.id,
        resourceType: name,
        actions: uniqueActions.map((action) => action.name).join(' '),
      });
    });
    return this.get(applicationId);
  }

  /** Adds an Action to a Resource Type that isn't Deprecated. */
  async addAction(actorUserId: string, applicationId: string, resourceTypeId: string, name: string): Promise<ApplicationDetail> {
    assertNotReserved(name, RESERVED_ACTION_NAMES, 'an Action');
    await this.prisma.$transaction(async (tx) => {
      await lockApplication(tx, applicationId);
      const resourceType = await tx.resourceType.findFirst({
        where: { id: resourceTypeId, applicationId },
        include: { actions: true },
      });
      if (!resourceType) throw new NotFoundException('Resource Type not found');
      if (resourceType.deprecatedAt) throw new ConflictException(`Resource Type "${resourceType.name}" is Deprecated`);
      assertUniqueName(resourceType.actions, name, 'Action');
      const action = await tx.action.create({ data: { resourceTypeId, name } });
      await this.recordIn(tx, 'application.action_added', actorUserId, applicationId, {
        resourceTypeId,
        resourceType: resourceType.name,
        actionId: action.id,
        action: name,
      });
    });
    return this.get(applicationId);
  }

  /** Deprecates a Resource Type, and with it all its Actions. It is never removed. */
  async deprecateResourceType(actorUserId: string, applicationId: string, resourceTypeId: string): Promise<ApplicationDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockApplication(tx, applicationId);
      const resourceType = await tx.resourceType.findFirst({ where: { id: resourceTypeId, applicationId } });
      if (!resourceType) throw new NotFoundException('Resource Type not found');
      const { count } = await tx.resourceType.updateMany({
        where: { id: resourceTypeId, deprecatedAt: null },
        data: { deprecatedAt: new Date() },
      });
      if (count === 0) throw new ConflictException(`Resource Type "${resourceType.name}" is already Deprecated`);
      await this.recordIn(tx, 'application.resource_type_deprecated', actorUserId, applicationId, {
        resourceTypeId,
        resourceType: resourceType.name,
      });
    });
    return this.get(applicationId);
  }

  /** Deprecates one Action. It is never removed. */
  async deprecateAction(
    actorUserId: string,
    applicationId: string,
    resourceTypeId: string,
    actionId: string,
  ): Promise<ApplicationDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockApplication(tx, applicationId);
      const action = await tx.action.findFirst({
        where: { id: actionId, resourceTypeId, resourceType: { applicationId } },
        include: { resourceType: true },
      });
      if (!action) throw new NotFoundException('Action not found');
      const { count } = await tx.action.updateMany({
        where: { id: actionId, deprecatedAt: null },
        data: { deprecatedAt: new Date() },
      });
      if (count === 0) throw new ConflictException(`Action "${action.name}" is already Deprecated`);
      await this.recordIn(tx, 'application.action_deprecated', actorUserId, applicationId, {
        resourceTypeId,
        resourceType: action.resourceType.name,
        actionId,
        action: action.name,
      });
    });
    return this.get(applicationId);
  }

  /** Platform Admin actions join the platform chain (no Tenant) and name the Application. */
  private recordIn(
    tx: ScopedTransaction,
    eventType: AuditEventType,
    actorUserId: string,
    applicationId: string,
    payload: AuditPayload,
  ): Promise<void> {
    return this.audit.recordIn(tx, {
      tenantId: null,
      eventType,
      actorUserId,
      target: { type: 'application', id: applicationId },
      applicationId,
      payload,
    });
  }
}
