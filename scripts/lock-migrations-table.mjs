// Runs db/lock-migrations-table.sql as the owner role (MIGRATION_DATABASE_URL).
import { readFileSync, existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

if (existsSync('.env')) process.loadEnvFile('.env');
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('MIGRATION_DATABASE_URL is not set');
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: url });
try {
  await prisma.$executeRawUnsafe(readFileSync('db/lock-migrations-table.sql', 'utf8'));
  console.log('Locked _prisma_migrations to the owner role');
} finally {
  await prisma.$disconnect();
}
