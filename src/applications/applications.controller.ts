import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { PlatformAdminGuard } from '../access-token/admin.guards';
import { type Page, PageQuery } from '../common/pagination';
import {
  type ApplicationDetail,
  ApplicationsService,
  type ApplicationSummary,
  type IssuedSecret,
} from './applications.service';
import { RegisterApplicationDto } from './dto/register-application.dto';
import { AddActionDto, AddResourceTypeDto } from './dto/schema-entry.dto';

/** The Application registry and Application Schemas, for Platform Admins. */
@Controller('platform/applications')
@UseGuards(AccessTokenGuard, PlatformAdminGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  /** Newest first, paginated. */
  @Get()
  list(@Query() query: PageQuery): Promise<Page<ApplicationSummary>> {
    return this.applications.list(query);
  }

  /** Register an Application. The response holds the client secret: it is shown this once only. */
  @Post()
  register(@CurrentClaims() claims: AccessTokenClaims, @Body() body: RegisterApplicationDto): Promise<IssuedSecret> {
    return this.applications.register(claims.sub, body);
  }

  /** The Application and its Application Schema. */
  @Get(':applicationId')
  get(@Param('applicationId', ParseUUIDPipe) applicationId: string): Promise<ApplicationDetail> {
    return this.applications.get(applicationId);
  }

  /** Issue a new client secret, shown this once. The old one stops working at once. */
  @Post(':applicationId/secret')
  @HttpCode(HttpStatus.OK)
  rotateSecret(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<IssuedSecret> {
    return this.applications.rotateSecret(claims.sub, applicationId);
  }

  @Post(':applicationId/resource-types')
  addResourceType(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() body: AddResourceTypeDto,
  ): Promise<ApplicationDetail> {
    return this.applications.addResourceType(claims.sub, applicationId, body.name, body.actions ?? []);
  }

  /** Deprecate a Resource Type and its Actions. Schema entries are never removed. */
  @Post(':applicationId/resource-types/:resourceTypeId/deprecate')
  @HttpCode(HttpStatus.OK)
  deprecateResourceType(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('resourceTypeId', ParseUUIDPipe) resourceTypeId: string,
  ): Promise<ApplicationDetail> {
    return this.applications.deprecateResourceType(claims.sub, applicationId, resourceTypeId);
  }

  @Post(':applicationId/resource-types/:resourceTypeId/actions')
  addAction(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('resourceTypeId', ParseUUIDPipe) resourceTypeId: string,
    @Body() body: AddActionDto,
  ): Promise<ApplicationDetail> {
    return this.applications.addAction(claims.sub, applicationId, resourceTypeId, body.name);
  }

  @Post(':applicationId/resource-types/:resourceTypeId/actions/:actionId/deprecate')
  @HttpCode(HttpStatus.OK)
  deprecateAction(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('resourceTypeId', ParseUUIDPipe) resourceTypeId: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ): Promise<ApplicationDetail> {
    return this.applications.deprecateAction(claims.sub, applicationId, resourceTypeId, actionId);
  }
}
