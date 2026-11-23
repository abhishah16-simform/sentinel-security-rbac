import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { ApplicationsModule } from './applications/applications.module';
import { AuditConsoleModule } from './audit/audit-console.module';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { PrismaModule } from './prisma/prisma.module';
import { SessionsModule } from './sessions/sessions.module';
import { TenancyModule } from './tenancy/tenancy.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/v1/{*path}', '/.well-known/{*path}'],
    }),
    PrismaModule,
    ApplicationsModule,
    AuditConsoleModule,
    HealthModule,
    IdentityModule,
    SessionsModule,
    TenancyModule,
  ],
})
export class AppModule {}
