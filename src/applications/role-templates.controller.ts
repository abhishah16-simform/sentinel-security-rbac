import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard, CurrentClaims } from '../access-token/access-token.guard';
import type { AccessTokenClaims } from '../access-token/access-token.service';
import { PlatformAdminGuard } from '../access-token/admin.guards';
import { type Page, PageQuery } from '../common/pagination';
import { CreateRoleTemplateDto, TemplatePermissionDto, UpdateRoleTemplateDto } from './dto/role-template.dto';
import { type RoleTemplateView, RoleTemplatesService } from './role-templates.service';

/** An Application's Role Templates, for Platform Admins. */
@Controller('platform/applications/:applicationId/role-templates')
@UseGuards(AccessTokenGuard, PlatformAdminGuard)
export class RoleTemplatesController {
  constructor(private readonly templates: RoleTemplatesService) {}

  /** Oldest first, paginated. Permissions on Deprecated Schema entries are flagged. */
  @Get()
  list(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Query() query: PageQuery,
  ): Promise<Page<RoleTemplateView>> {
    return this.templates.list(applicationId, query);
  }

  @Post()
  create(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() body: CreateRoleTemplateDto,
  ): Promise<RoleTemplateView> {
    return this.templates.create(claims.sub, applicationId, body);
  }

  /** Rename or re-describe. Copies already in Tenants never change. */
  @Patch(':templateId')
  update(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() body: UpdateRoleTemplateDto,
  ): Promise<RoleTemplateView> {
    return this.templates.update(claims.sub, applicationId, templateId, body);
  }

  @Delete(':templateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
  ): Promise<void> {
    return this.templates.remove(claims.sub, applicationId, templateId);
  }

  @Post(':templateId/permissions')
  addPermission(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() body: TemplatePermissionDto,
  ): Promise<RoleTemplateView> {
    return this.templates.addPermission(claims.sub, applicationId, templateId, body);
  }

  @Delete(':templateId/permissions/:permissionId')
  removePermission(
    @CurrentClaims() claims: AccessTokenClaims,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
  ): Promise<RoleTemplateView> {
    return this.templates.removePermission(claims.sub, applicationId, templateId, permissionId);
  }
}
