import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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

  constructor(private readonly expiry: RoleAssignmentExpiry) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'sentinel-minutely' })
  async everyMinute(): Promise<void> {
    // A run that outlasts its minute isn't doubled up within this instance.
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.expiry.markAllExpired();
      if (expired > 0) this.logger.log(`Marked ${expired} expired Role Assignment(s)`);
    } catch (error: unknown) {
      this.logger.error('Scheduled run failed', error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}
