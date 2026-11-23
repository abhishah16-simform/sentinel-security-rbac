// Seeds a Platform Admin. Run after `npm run build`:
//
//   npm run platform-admin:create -- --email ops@example.com --first-name Ops --last-name Admin
//
// The password is read from PLATFORM_ADMIN_PASSWORD if set, otherwise asked for on the terminal
// (not echoed), otherwise read from standard input.
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { isEmail } from 'class-validator';
import { validateEnv } from '../config/env';
import { EMAIL_MAX_LENGTH, NAME_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../identity/credential-limits';
import { IdentityModule } from '../identity/identity.module';
import { IdentityService } from '../identity/identity.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule, IdentityModule],
})
class CreatePlatformAdminModule {}

const USAGE = 'Usage: npm run platform-admin:create -- --email <email> --first-name <name> --last-name <name>';

/** Asks for the password without echoing it. */
function promptHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const muted = new Writable({
    write(_chunk: unknown, _encoding: BufferEncoding, callback: () => void): void {
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString().replace(/\r?\n$/, '');
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.PLATFORM_ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) return readStdin();
  const password = await promptHidden('Password: ');
  const again = await promptHidden('Repeat password: ');
  if (password !== again) throw new Error('The passwords do not match.');
  return password;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      'first-name': { type: 'string' },
      'last-name': { type: 'string' },
    },
  });
  const email = values.email?.trim();
  const firstName = values['first-name']?.trim();
  const lastName = values['last-name']?.trim();
  if (!email || !firstName || !lastName) throw new Error(USAGE);
  // The same rules as the signup form.
  if (!isEmail(email) || email.length > EMAIL_MAX_LENGTH) throw new Error(`"${email}" is not a valid email address.`);
  if (firstName.length > NAME_MAX_LENGTH || lastName.length > NAME_MAX_LENGTH) {
    throw new Error(`Names can be at most ${NAME_MAX_LENGTH} characters.`);
  }

  const password = await readPassword();
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`The password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`);
  }

  const app = await NestFactory.createApplicationContext(CreatePlatformAdminModule, { logger: ['error', 'warn'] });
  try {
    const admin = await app.get(IdentityService).createPlatformAdmin({ email, firstName, lastName, password });
    process.stdout.write(`Created Platform Admin ${admin.email} (${admin.id}).\n`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : String(error), 'CreatePlatformAdmin');
  process.exitCode = 1;
});
