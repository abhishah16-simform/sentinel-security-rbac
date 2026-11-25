import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AccessReviewClosing } from '../access-reviews/access-review-closing';
import { RoleAssignmentExpiry } from '../access-rules/role-assignment-expiry';

/**
 * Sentinel's one cron job, every minute. It only tidies up and records what time has already
 * decided: no access decision ever waits for it. Each task is idempotent, so a missed, repeated or
 * concurrent run (another instance) is harmless.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private running = false;

  constructor(
    private readonly expiry: RoleAssignmentExpiry,
    private readonly reviews: AccessReviewClosing,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'sentinel-minutely' })
  async everyMinute(): Promise<void> {
    // A run that outlasts its minute isn't doubled up within this instance.
    if (this.running) return;
    this.running = true;
    try {
      // Each task runs even if the one before it failed.
      await this.run('Marking expired Role Assignments', async () => {
        const expired = await this.expiry.markAllExpired();
        if (expired > 0) this.logger.log(`Marked ${expired} expired Role Assignment(s)`);
      });
      await this.run('Closing due Access Reviews', async () => {
        const closed = await this.reviews.closeAllDue();
        if (closed > 0) this.logger.log(`Closed ${closed} Access Review(s) past their due date`);
      });
    } finally {
      this.running = false;
    }
  }

  private async run(task: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error: unknown) {
      this.logger.error(`${task} failed`, error instanceof Error ? error.stack : String(error));
    }
  }
}
