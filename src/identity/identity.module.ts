import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MailModule } from '../mail/mail.module';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { PasswordHasher } from './password-hasher';

@Module({
  imports: [AuditModule, MailModule],
  controllers: [IdentityController],
  providers: [IdentityService, PasswordHasher],
  exports: [IdentityService],
})
export class IdentityModule {}
