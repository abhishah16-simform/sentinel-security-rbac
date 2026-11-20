import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';

interface TenantTableRls {
  readonly table: string;
  readonly enabled: boolean;
  readonly forced: boolean;
  readonly hasPolicy: boolean;
}

/** A Tenant-owned table is any table in the app's schema with a tenantId column. */
const TENANT_ID_COLUMN = 'tenantId';

/**
 * Warns at startup about any Tenant-owned table whose RLS is incomplete. Every such table needs
 * ENABLE and FORCE ROW LEVEL SECURITY plus a policy; without FORCE, RLS doesn't apply to the
 * app's role because it owns the tables (ADR 0003).
 */
@Injectable()
export class TenantRlsCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(TenantRlsCheck.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const tables = await this.prisma.$queryRaw<TenantTableRls[]>`
      SELECT c.relname AS "table",
             c.relrowsecurity AS "enabled",
             c.relforcerowsecurity AS "forced",
             EXISTS (
               SELECT 1 FROM pg_policy p
                WHERE p.polrelid = c.oid
                  AND pg_get_expr(p.polqual, p.polrelid) LIKE '%' || quote_ident(${TENANT_ID_COLUMN}) || '%'
             ) AS "hasPolicy"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema()
         AND c.relkind IN ('r', 'p')
         AND EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attname = ${TENANT_ID_COLUMN} AND NOT a.attisdropped)
       ORDER BY c.relname`;

    let problems = 0;
    for (const { table, enabled, forced, hasPolicy } of tables) {
      const missing = [
        enabled ? null : 'ENABLE ROW LEVEL SECURITY',
        forced ? null : 'FORCE ROW LEVEL SECURITY',
        hasPolicy ? null : `a policy on ${TENANT_ID_COLUMN}`,
      ].filter((item): item is string => item !== null);
      if (missing.length > 0) {
        problems += 1;
        this.logger.warn(
          `Tenant-owned table "${table}" is missing ${missing.join(', ')}, so the database does not isolate its rows by Tenant.`,
        );
      }
    }
    if (problems === 0) this.logger.log(`Row-Level Security is complete on ${tables.length} Tenant-owned table(s)`);
  }
}
