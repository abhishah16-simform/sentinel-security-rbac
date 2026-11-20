import { Global, Module } from '@nestjs/common';
import { DbRoleCheck } from './db-role-check';
import { PrismaService } from './prisma.service';
import { ScopedPrisma } from './scoped-prisma';
import { TenantRlsCheck } from './tenant-rls-check';

@Global()
@Module({
  providers: [PrismaService, ScopedPrisma, DbRoleCheck, TenantRlsCheck],
  exports: [PrismaService, ScopedPrisma],
})
export class PrismaModule {}
