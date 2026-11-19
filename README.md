# Sentinel

A multi-tenant authorization and security compliance service. See [CONTEXT.md](CONTEXT.md) for the domain language and [`.scratch/sentinel/spec.md`](.scratch/sentinel/spec.md) for the specification.

## Requirements

- Node.js 22 (`nvm use` picks it up from `.nvmrc`)
- Docker with `docker-compose`

## Local setup

These steps use a **local PostgreSQL** on port 5432. To run Postgres in Docker instead, use `npm run db:up` (it listens on port 5433 with the passwords in `docker-compose.yml`) and point the URLs in `.env` there.

1. Create the database and its two roles (run once, as the `postgres` superuser). Pick your own passwords:

   ```bash
   sudo -u postgres psql \
     -v db_name=sentinel \
     -v owner_role=sentinel_owner -v owner_password='CHANGE_ME_OWNER' \
     -v app_role=sentinel_app -v app_password='CHANGE_ME_APP' \
     -f db/create-local-db.sql
   ```

2. Create a `.env` file in the project root with the same passwords:

   ```bash
   cat > .env <<'ENV'
   PORT=3000
   # The app connects as the restricted sentinel_app role
   DATABASE_URL=postgresql://sentinel_app:CHANGE_ME_APP@localhost:5432/sentinel
   # Only the Prisma CLI uses this; migrations run as the owner role
   MIGRATION_DATABASE_URL=postgresql://sentinel_owner:CHANGE_ME_OWNER@localhost:5432/sentinel
   ENV
   ```

3. Start the Mailpit mail catcher (inbox at <http://localhost:8025>):

   ```bash
   npm run mail:up
   ```

4. Install dependencies and start the app:

   ```bash
   npm install
   npm run start:dev
   ```

   Behind a TLS-inspecting proxy such as Zscaler, `npm install` fails when Prisma downloads its engines with `unable to get local issuer certificate`. Tell Node to trust the system certificates, then run the install again:

   ```bash
   export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
   ```

5. Open <http://localhost:3000> for the frontend, or <http://localhost:3000/v1/health> for the health check.

## Commands

| Command | What it does |
|---|---|
| `npm run mail:up` | Start only Mailpit (when using a local PostgreSQL) |
| `npm run db:up` / `npm run db:down` | Start or stop Postgres and Mailpit in Docker |
| `npm run start:dev` | Run the app with reload on change |
| `npm run build` | Compile to `dist/` |
| `npm run lint` | Lint with ESLint |
| `npm run typecheck` | Typecheck with `tsc --noEmit` |
| `npm run prisma:migrate` | Create and apply a migration as the owner role, then lock Prisma's migrations table |
| `npm run prisma:deploy` | Apply existing migrations (e.g. in production), then lock the migrations table |

## Database roles

Two Postgres roles exist so that Row-Level Security can never be bypassed by the app. Both the local script and Docker set them up from the same file, `db/setup-app-role.sql`:

- **`sentinel_owner`** owns every table and runs migrations. The app never connects as it.
- **`sentinel_app`** is what the app connects as. It is not a superuser, cannot bypass RLS and owns nothing. Tables created by migrations are granted to it automatically.

On startup the app checks its own role and refuses to start if that role is a superuser, can bypass RLS, or owns the `public` schema or any table. After every migration, `_prisma_migrations` is locked so only the owner role can touch it.
