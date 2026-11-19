import { Global, Module } from '@nestjs/common';
import { DbRoleCheck } from './db-role-check';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, DbRoleCheck],
  exports: [PrismaService],
})
export class PrismaModule {}
