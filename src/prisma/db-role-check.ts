import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';

interface DbRoleInfo {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

/**
 * Warns at startup if the app's Postgres role is a superuser or has BYPASSRLS. Postgres never
 * applies Row-Level Security to such roles, not even with FORCE ROW LEVEL SECURITY, so tenant
 * isolation would then not be enforced by the database. The app still starts.
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
      this.logger.warn(
        `Database role "${dbRole.rolname}" bypasses Row-Level Security, so tenant isolation is NOT enforced by the database. Connect as a role that is not a superuser and has no BYPASSRLS to enforce it.`,
      );
      return;
    }
    this.logger.log(`Connected to Postgres as database role "${dbRole.rolname}"`);
  }
}
