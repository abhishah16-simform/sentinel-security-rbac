import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type ApplicationSummary, ApplicationsService } from './applications.service';

interface ClientRequest extends Request {
  application?: ApplicationSummary;
}

interface ClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

const INVALID_CLIENT = 'Invalid client credentials';

/** Longer than any client ID or secret Sentinel issues; anything bigger isn't worth hashing. */
const MAX_CREDENTIAL_LENGTH = 256;

/**
 * The client ID and secret from an Authorization: Basic header. Both are form-urlencoded before
 * base64, as RFC 6749 section 2.3.1 describes; Sentinel's own IDs and secrets never need it.
 */
function basicCredentials(req: Request): ClientCredentials | null {
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !encoded || encoded.length > 2 * MAX_CREDENTIAL_LENGTH) return null;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon <= 0) return null;
  try {
    const clientId = decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' '));
    const clientSecret = decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' '));
    return clientSecret ? { clientId, clientSecret } : null;
  } catch {
    return null;
  }
}

/**
 * Requires an Application's client ID and secret over HTTP Basic, for the endpoints Applications
 * call (Access Checks, Registered Resources). Refuses with 401 and a WWW-Authenticate challenge.
 */
@Injectable()
export class ClientCredentialsGuard implements CanActivate {
  constructor(private readonly applications: ApplicationsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<ClientRequest>();
    const credentials = basicCredentials(req);
    const application = credentials
      ? await this.applications.verifyClient(credentials.clientId, credentials.clientSecret)
      : null;
    if (!application) {
      http.getResponse<Response>().setHeader('WWW-Authenticate', 'Basic realm="sentinel", charset="UTF-8"');
      throw new UnauthorizedException(INVALID_CLIENT);
    }
    req.application = application;
    return true;
  }
}

/** The Application whose credentials authenticated the request. Use only behind ClientCredentialsGuard. */
export const CurrentApplication = createParamDecorator((_data: unknown, context: ExecutionContext): ApplicationSummary => {
  const application = context.switchToHttp().getRequest<ClientRequest>().application;
  if (!application) throw new UnauthorizedException(INVALID_CLIENT);
  return application;
});
