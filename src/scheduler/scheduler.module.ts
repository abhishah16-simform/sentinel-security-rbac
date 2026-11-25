import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AccessRulesModule } from '../access-rules/access-rules.module';
import { SchedulerService } from './scheduler.service';

/** The Scheduler: one cron job that calls into the modules owning each clean-up task. */
@Module({
  imports: [ScheduleModule.forRoot(), AccessRulesModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
