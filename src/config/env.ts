/** Environment the running app needs. Only add a variable here once code reads it. */
export interface Env {
  PORT: number;
  DATABASE_URL: string;
  /** Public base URL of this app, used to build links in emails. */
  APP_URL: string;
  /** Path to the PEM-encoded RSA private key that signs access tokens. */
  JWT_PRIVATE_KEY_FILE: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string | undefined;
  SMTP_PASSWORD: string | undefined;
  MAIL_FROM: string;
  /** Origins allowed to call the API from a browser (CORS), with credentials. */
  CORS_ALLOWED_ORIGINS: readonly string[];
}

function requireString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

function optionalString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function stringWithDefault(config: Record<string, unknown>, key: string, fallback: string): string {
  return optionalString(config, key) ?? fallback;
}

function parsePort(config: Record<string, unknown>, key: string, fallback: number): number {
  const raw = config[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Environment variable ${key} must be a valid port number`);
  }
  return value;
}

function parseOrigin(key: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Environment variable ${key} contains an invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Environment variable ${key} must contain http(s) URLs: ${raw}`);
  }
  return url.origin;
}

function parseOriginList(config: Record<string, unknown>, key: string): readonly string[] {
  const raw = optionalString(config, key);
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => parseOrigin(key, entry));
}

/** Validates process environment at startup; the app refuses to boot on bad config. */
export function validateEnv(config: Record<string, unknown>): Env {
  const port = parsePort(config, 'PORT', 3000);
  return {
    PORT: port,
    DATABASE_URL: requireString(config, 'DATABASE_URL'),
    APP_URL: parseOrigin('APP_URL', stringWithDefault(config, 'APP_URL', `http://localhost:${port}`)),
    JWT_PRIVATE_KEY_FILE: stringWithDefault(config, 'JWT_PRIVATE_KEY_FILE', 'keys/jwt-private.pem'),
    SMTP_HOST: stringWithDefault(config, 'SMTP_HOST', 'localhost'),
    SMTP_PORT: parsePort(config, 'SMTP_PORT', 1025),
    SMTP_USER: optionalString(config, 'SMTP_USER'),
    SMTP_PASSWORD: optionalString(config, 'SMTP_PASSWORD'),
    MAIL_FROM: stringWithDefault(config, 'MAIL_FROM', 'Sentinel <no-reply@sentinel.local>'),
    CORS_ALLOWED_ORIGINS: parseOriginList(config, 'CORS_ALLOWED_ORIGINS'),
  };
}
