import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MailModule } from '../mail/mail.module';
import { EmailChallenges } from './email-challenges';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { Lockout } from './lockout';
import { MfaService } from './mfa.service';
import { PasswordHasher } from './password-hasher';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [AuditModule, MailModule],
  controllers: [IdentityController],
  providers: [IdentityService, PasswordHasher, Lockout, EmailChallenges, MfaService, PasswordResetService],
  exports: [IdentityService, MfaService, PasswordResetService],
})
export class IdentityModule {}
