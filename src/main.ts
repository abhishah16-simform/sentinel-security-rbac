import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { JWKS_PATH } from './access-token/jwks.controller';
import { AppModule } from './app.module';
import { rejectPrototypeKeys } from './common/json-body';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<Env, true>);

  app.setGlobalPrefix('v1', { exclude: [JWKS_PATH] });
  app.useBodyParser('json', { reviver: rejectPrototypeKeys });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  // Applications log Users in by calling the API directly from their own origin. A fixed list from
  // config for now; ticket 07 replaces it with each registered Application's allowed origins.
  app.enableCors({ origin: [...config.get('CORS_ALLOWED_ORIGINS', { infer: true })], credentials: true });
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`Sentinel listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : String(error), 'Bootstrap');
  process.exit(1);
});
