# Sentinel

A multi-tenant authorization and security compliance service. See [CONTEXT.md](CONTEXT.md) for the domain language and [`.scratch/sentinel/spec.md`](.scratch/sentinel/spec.md) for the specification.

## Requirements

- Node.js 22 (`nvm use` picks it up from `.nvmrc`)
- Docker with `docker-compose`

## Local setup

These steps use a **local PostgreSQL** on port 5432. To run Postgres in Docker instead, use `npm run db:up` (port 5433, user and password `sentinel`) and point `DATABASE_URL` there.

1. Create the database and its role (run once, as the `postgres` superuser). Pick your own password:

   ```bash
   sudo -u postgres psql -v db_name=sentinel -v db_user=sentinel \
     -v db_password='CHANGE_ME' -f db/create-db.sql
   ```

   You can also connect as `postgres` directly. The app will start, but it logs a warning, because Row-Level Security never applies to a superuser.

2. Create a `.env` file in the project root:

   ```bash
   cat > .env <<'ENV'
   PORT=3000
   DATABASE_URL=postgresql://sentinel:CHANGE_ME@localhost:5432/sentinel
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

5. Open <http://localhost:3000> for the status page, or <http://localhost:3000/v1/health> for the JSON health check.

## Commands

| Command | What it does |
|---|---|
| `npm run mail:up` | Start only Mailpit (when using a local PostgreSQL) |
| `npm run db:up` / `npm run db:down` | Start or stop Postgres and Mailpit in Docker |
| `npm run start:dev` | Run the app with reload on change |
| `npm run build` | Compile to `dist/` |
| `npm run lint` | Lint with ESLint |
| `npm run typecheck` | Typecheck with `tsc --noEmit` |
| `npm run prisma:migrate` | Create a migration file and apply it (development) |
| `npm run prisma:deploy` | Apply existing migrations (deployment) |

## Database role

Sentinel uses one Postgres role for everything: it owns the tables, runs migrations and is what the app connects as ([ADR 0003](docs/adr/0003-single-database-role.md)).

- Every Tenant table's migration must run both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`; without `FORCE`, RLS doesn't apply to the table's owner.
- The role must not be a superuser or have `BYPASSRLS`, because RLS never applies to those. The app logs a warning at startup if it is connected as such a role.
