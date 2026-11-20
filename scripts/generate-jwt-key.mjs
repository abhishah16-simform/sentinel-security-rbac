// Generates the RSA private key that signs access tokens, for local development.
// Usage: npm run keys:generate [-- path]   (default: keys/jwt-private.pem)
/* global console, process */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const path = process.argv[2] ?? 'keys/jwt-private.pem';
if (existsSync(path)) {
  console.error(`${path} already exists; delete it first to replace the key (this logs every User out).`);
  process.exit(1);
}

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
console.log(`Wrote ${path}`);
