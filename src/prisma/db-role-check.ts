import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';

interface DbRoleInfo {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

/**
 * Refuses to start the app if its Postgres login role could bypass Row-Level Security:
 * a superuser, a role with BYPASSRLS, or a role that owns the public schema or any table.
 */
@Injectable()
export class DbRoleCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(DbRoleCheck.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const [dbRole] = await this.prisma.$queryRaw<DbRoleInfo[]>`
      SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    if (!dbRole) {
      throw new Error('Could not determine the connected database role');
    }
    if (dbRole.rolsuper || dbRole.rolbypassrls) {
      throw new Error(
        `Database role "${dbRole.rolname}" can bypass Row-Level Security; connect as the restricted database role instead`,
      );
    }
    const [{ ownedTables, ownsPublicSchema }] = await this.prisma.$queryRaw<
      { ownedTables: bigint; ownsPublicSchema: boolean }[]
    >`
      SELECT
        (SELECT count(*) FROM pg_tables
          WHERE tableowner = current_user
            AND schemaname NOT IN ('pg_catalog', 'information_schema')) AS "ownedTables",
        (SELECT pg_get_userbyid(nspowner) = current_user
          FROM pg_namespace WHERE nspname = 'public') AS "ownsPublicSchema"`;
    if (ownedTables > 0n || ownsPublicSchema) {
      throw new Error(
        `Database role "${dbRole.rolname}" owns the public schema or its tables; the app must not own what it queries`,
      );
    }
    this.logger.log(`Connected to Postgres as restricted database role "${dbRole.rolname}"`);
  }
}
