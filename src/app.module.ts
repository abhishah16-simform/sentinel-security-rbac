import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { AccessCheckModule } from './access-check/access-check.module';
import { AccessRulesModule } from './access-rules/access-rules.module';
import { ApplicationsModule } from './applications/applications.module';
import { AuditConsoleModule } from './audit/audit-console.module';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { PrismaModule } from './prisma/prisma.module';
import { RegisteredResourcesModule } from './registered-resources/registered-resources.module';
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
    AccessCheckModule,
    AccessRulesModule,
    ApplicationsModule,
    AuditConsoleModule,
    HealthModule,
    IdentityModule,
    RegisteredResourcesModule,
    SessionsModule,
    TenancyModule,
  ],
})
export class AppModule {}
