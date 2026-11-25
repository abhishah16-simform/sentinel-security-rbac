import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { AuditModule } from '../audit/audit.module';
import { AccessReviewClosing } from './access-review-closing';
import { AccessReviewsController } from './access-reviews.controller';
import { AccessReviewsService } from './access-reviews.service';

/**
 * Access Reviews: campaigns over one Application's Role Assignments, their decisions, and closing them
 * at the due date. Exports AccessReviewClosing for the Scheduler. Role Assignments are revoked through
 * the access-rules helpers, which in turn resolve review items on every other revoke path.
 */
@Module({
  imports: [AccessTokenModule, AuditModule],
  controllers: [AccessReviewsController],
  providers: [AccessReviewsService, AccessReviewClosing],
  exports: [AccessReviewClosing],
})
export class AccessReviewsModule {}
