import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import type { AuditEventType } from '../audit/audit-event-types';
import { AuditLog } from '../audit/audit-log.service';
import { type Page, type PageQuery, pageWindow, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { type ScopedTransaction, setTenantContext } from '../prisma/scoped-prisma';

/** A Tenant as the Platform Admin console lists it: its name, counts and status, never its data. */
export interface PlatformTenantSummary {
  readonly id: string;
  readonly name: string;
  readonly membershipCount: number;
  /** Applications the Tenant has enabled and not disabled since. */
  readonly enabledApplicationCount: number;
  readonly createdAt: Date;
  /** When a Platform Admin suspended it; null while it is active. */
  readonly suspendedAt: Date | null;
}

interface TenantCounts {
  readonly membershipCount: number;
  readonly enabledApplicationCount: number;
}

function toSummary(tenant: Tenant, counts: TenantCounts): PlatformTenantSummary {
  return {
    id: tenant.id,
    name: tenant.name,
    membershipCount: counts.membershipCount,
    enabledApplicationCount: counts.enabledApplicationCount,
    createdAt: tenant.createdAt,
    suspendedAt: tenant.suspendedAt,
  };
}

/**
 * The Tenant list and suspension, for Platform Admins. The tenants table is platform-level. The only
 * Tenant-owned reads are the counts, each made inside that Tenant's own RLS context, and only the
 * numbers leave this service.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  /** Newest first. */
  async list(query: PageQuery): Promise<Page<PlatformTenantSummary>> {
    const window = pageWindow(query, 'desc');
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.tenant.findMany({ where: window.after, orderBy: window.orderBy, take: window.take });
      const counts = new Map<string, TenantCounts>();
      for (const row of rows.slice(0, window.limit)) counts.set(row.id, await countIn(tx, row.id));
      return toPage(rows, window, (row) => toSummary(row, counts.get(row.id) ?? { membershipCount: 0, enabledApplicationCount: 0 }));
    });
  }

  /**
   * Suspends a Tenant: switching into it and refreshing tokens for it are refused, its console is
   * frozen, and every Access Check in it is denied with tenant-suspended. Its data is kept.
   */
  suspend(actorUserId: string, tenantId: string): Promise<PlatformTenantSummary> {
    return this.setSuspended(actorUserId, tenantId, true);
  }

  /** Lifts a suspension. Logins switch into the Tenant again as usual. */
  reactivate(actorUserId: string, tenantId: string): Promise<PlatformTenantSummary> {
    return this.setSuspended(actorUserId, tenantId, false);
  }

  private setSuspended(actorUserId: string, tenantId: string, suspend: boolean): Promise<PlatformTenantSummary> {
    return this.prisma.$transaction(async (tx) => {
      // Lock the row so two Platform Admins can't both suspend (or reactivate) and record it twice.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      if (suspend === (tenant.suspendedAt !== null)) {
        throw new ConflictException(`Tenant "${tenant.name}" is ${suspend ? 'already suspended' : 'not suspended'}`);
      }
      const updated = await tx.tenant.update({
        where: { id: tenantId },
        data: { suspendedAt: suspend ? new Date() : null },
      });
      const eventType: AuditEventType = suspend ? 'tenant.suspended' : 'tenant.reactivated';
      await this.audit.recordIn(tx, {
        tenantId: null,
        eventType,
        actorUserId,
        target: { type: 'tenant', id: tenantId },
        payload: { name: tenant.name },
      });
      return toSummary(updated, await countIn(tx, tenantId));
    });
  }
}

/**
 * Counts one Tenant's Memberships and enabled Applications inside its RLS context, then clears the
 * context so whatever the transaction runs next sees no Tenant.
 */
async function countIn(tx: ScopedTransaction, tenantId: string): Promise<TenantCounts> {
  await setTenantContext(tx, tenantId);
  const membershipCount = await tx.membership.count({ where: { tenantId } });
  const enabledApplicationCount = await tx.enablement.count({ where: { tenantId, disabledAt: null } });
  await setTenantContext(tx, '');
  return { membershipCount, enabledApplicationCount };
}
