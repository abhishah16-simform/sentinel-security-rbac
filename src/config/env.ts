/** Environment the running app needs. Only add a variable here once code reads it. */
export interface Env {
  PORT: number;
  DATABASE_URL: string;
}

function requireString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
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

/** Validates process environment at startup; the app refuses to boot on bad config. */
export function validateEnv(config: Record<string, unknown>): Env {
  return {
    PORT: parsePort(config, 'PORT', 3000),
    DATABASE_URL: requireString(config, 'DATABASE_URL'),
  };
}
