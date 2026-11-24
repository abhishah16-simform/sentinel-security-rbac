import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { ApplicationSummary } from '../applications/applications.service';
import { ClientCredentialsGuard, CurrentApplication } from '../applications/client-credentials.guard';
import type { Page } from '../common/pagination';
import {
  ApplicationResourceListQuery,
  PutRegisteredResourceDto,
  RegisteredResourcePath,
  RegisteredResourceTenantPath,
} from './dto/registered-resource.dto';
import { RegisteredResourcesService, type RegisteredResourceView } from './registered-resources.service';

/**
 * Registered Resources, called by Applications with their client ID and secret over HTTP Basic. Each
 * resource lives in one Tenant that has enabled the Application (403 otherwise) and is named by its
 * Resource Type and the Application's own ID.
 */
@Controller('registered-resources/:tenantId')
@UseGuards(ClientCredentialsGuard)
export class RegisteredResourcesController {
  constructor(private readonly resources: RegisteredResourcesService) {}

  /** The Application's resources in the Tenant, newest first, optionally of one Resource Type. */
  @Get()
  list(
    @CurrentApplication() application: ApplicationSummary,
    @Param() path: RegisteredResourceTenantPath,
    @Query() query: ApplicationResourceListQuery,
  ): Promise<Page<RegisteredResourceView>> {
    return this.resources.listForApplication(application, path.tenantId, query);
  }

  @Get(':resourceType/:resourceId')
  get(@CurrentApplication() application: ApplicationSummary, @Param() path: RegisteredResourcePath): Promise<RegisteredResourceView> {
    return this.resources.getForApplication(application, path);
  }

  /**
   * Registers the resource (201) or replaces its attributes (200). 400 for a Resource Type outside the
   * Application Schema.
   */
  @Put(':resourceType/:resourceId')
  async put(
    @CurrentApplication() application: ApplicationSummary,
    @Param() path: RegisteredResourcePath,
    @Body() body: PutRegisteredResourceDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RegisteredResourceView> {
    const result = await this.resources.put(application, path, body);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.resource;
  }

  @Delete(':resourceType/:resourceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentApplication() application: ApplicationSummary, @Param() path: RegisteredResourcePath): Promise<void> {
    return this.resources.delete(application, path);
  }
}
