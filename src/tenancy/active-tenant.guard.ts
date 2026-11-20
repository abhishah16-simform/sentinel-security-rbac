import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { currentClaimsOf } from '../access-token/access-token.guard';
import type { ActiveTenantRef } from './tenancy.service';

function activeTenantOf(context: ExecutionContext): ActiveTenantRef {
  const { tid, mid } = currentClaimsOf(context);
  if (tid === undefined || mid === undefined) {
    throw new ForbiddenException('Choose an Active Tenant first.');
  }
  return { tenantId: tid, membershipId: mid };
}

/** Requires an access token that carries an Active Tenant. Use after AccessTokenGuard. */
@Injectable()
export class ActiveTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    activeTenantOf(context);
    return true;
  }
}

/** The Active Tenant and Membership of the current request. Use only behind ActiveTenantGuard. */
export const ActiveTenant = createParamDecorator((_data: unknown, context: ExecutionContext): ActiveTenantRef =>
  activeTenantOf(context),
);
