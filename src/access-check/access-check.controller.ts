import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { ApplicationSummary } from '../applications/applications.service';
import { ClientCredentialsGuard, CurrentApplication } from '../applications/client-credentials.guard';
import { AccessCheckService, type AccessCheckResult } from './access-check.service';
import { AccessCheckDto } from './dto/access-check.dto';

/** Access Checks, called by Applications with their client ID and secret over HTTP Basic. */
@Controller('access-checks')
@UseGuards(ClientCredentialsGuard)
export class AccessCheckController {
  constructor(private readonly accessChecks: AccessCheckService) {}

  /**
   * May the User whose access token is in the body perform the Action on the resource? 200 with
   * { allowed, reason } either way; 400 for an Action or Resource Type outside the Application
   * Schema; 401 for bad client credentials or an invalid or expired access token.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  check(@CurrentApplication() application: ApplicationSummary, @Body() body: AccessCheckDto): Promise<AccessCheckResult> {
    return this.accessChecks.check(application, body);
  }
}
