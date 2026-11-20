import { Controller, Get, Header } from '@nestjs/common';
import { type JsonWebKeySet, SigningKey } from './signing-key';

export const JWKS_PATH = '.well-known/jwks.json';

/** Publishes the access-token public key so Applications can verify tokens themselves. */
@Controller()
export class JwksController {
  constructor(private readonly signingKey: SigningKey) {}

  @Get(JWKS_PATH)
  @Header('Cache-Control', 'public, max-age=300')
  jwks(): Promise<JsonWebKeySet> {
    return this.signingKey.jwks();
  }
}
