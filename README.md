# Sentinel

A multi-tenant authorization and security compliance service. See [CONTEXT.md](CONTEXT.md) for the domain language and [`.scratch/sentinel/spec.md`](.scratch/sentinel/spec.md) for the specification.

## Requirements

- Node.js 22 (`nvm use` picks it up from `.nvmrc`)
- Docker with `docker-compose`

## Local setup

These steps use a **local PostgreSQL** on port 5432, connecting as the `postgres` user. To run Postgres in Docker instead, use `npm run db:up` (port 5433, password `postgres`) and point `DATABASE_URL` there.

1. Create the database (run once):

   ```bash
   sudo -u postgres createdb sentinel
   ```

2. Create a `.env` file in the project root, using your `postgres` password:

   ```bash
   cat > .env <<'ENV'
   PORT=3000
   DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/sentinel
   ENV
   ```

3. Generate the RSA key that signs access tokens. It is written to `keys/jwt-private.pem` (git-ignored), where the app looks by default:

   ```bash
   npm run keys:generate
   ```

4. Start the Mailpit mail catcher (inbox at <http://localhost:8025>):

   ```bash
   npm run mail:up
   ```

5. Install dependencies, apply migrations and start the app:

   ```bash
   npm install
   npm run prisma:deploy
   npm run start:dev
   ```

   Behind a TLS-inspecting proxy such as Zscaler, `npm install` fails when Prisma downloads its engines with `unable to get local issuer certificate`. Tell Node to trust the system certificates, then run the install again:

   ```bash
   export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
   ```

6. Open <http://localhost:3000> to sign up and log in, or <http://localhost:3000/v1/health> for the JSON health check. Verification emails land in Mailpit.

## Configuration

Only `DATABASE_URL` is required. Everything else has a local-development default.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | none | Postgres connection string |
| `APP_URL` | `http://localhost:$PORT` | Public base URL, used for links in emails |
| `JWT_PRIVATE_KEY_FILE` | `keys/jwt-private.pem` | PEM RSA private key (2048 bits or more) that signs access tokens |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | SMTP server (Mailpit in development) |
| `SMTP_USER` / `SMTP_PASSWORD` | none | SMTP credentials, if the server needs them |
| `MAIL_FROM` | `Sentinel <no-reply@sentinel.local>` | Sender of Sentinel's emails |
| `CORS_ALLOWED_ORIGINS` | none | Comma-separated origins allowed to call the API from a browser, such as an Application's login page. Temporary until Applications register their own origins (ticket 07) |

## Logging in and sessions

- `POST /v1/auth/signup`, `POST /v1/auth/verify-email` and `POST /v1/auth/resend-verification` handle signup and email verification. Passwords are hashed with argon2id.
- `POST /v1/auth/login` returns a 10-minute RS256 access token in the body and sets the refresh token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie whose path is `/v1/auth/refresh`, so the browser sends it nowhere else.
- `POST /v1/auth/refresh` swaps the cookie for a new refresh token and a new access token. Each refresh token works once. Presenting one that was already used revokes every refresh token from that login.
- `DELETE /v1/auth/refresh` logs out on this device. `POST /v1/auth/logout-all` (Bearer token) logs out everywhere.
- Applications verify access tokens with the public key at `/.well-known/jwks.json`. The key ID (`kid`) is the key's RFC 7638 thumbprint, so a new key always gets a new ID.
- [`http/auth.http`](http/auth.http) walks through the whole flow.

## Tenants and isolation

- `POST /v1/tenants` creates a Tenant; the caller becomes its first Tenant Admin. Only Users with a verified email may.
- `GET /v1/tenants` lists the caller's Tenants (the Tenant picker). `GET /v1/tenants/current` returns the Active Tenant.
- `PUT /v1/auth/refresh/active-tenant` with `{ "tenantId": "..." }` switches the Active Tenant. It uses the refresh-token cookie and returns new tokens in the same login, with `tid` and `mid` claims.
- Tenant isolation is enforced by Postgres Row-Level Security. Every Tenant-owned table has a `tenantId` column, and its migration must add, by hand, after `prisma migrate dev --create-only`:

  ```sql
  ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "x" FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON "x"
    USING ("tenantId" = app_current_tenant_id())
    WITH CHECK ("tenantId" = app_current_tenant_id());
  ```

- Tenant-scoped code runs through `ScopedPrisma.inTenant(tenantId, tx => ...)`, which sets `app.tenant_id` for that transaction before any query. At startup the app warns about any table with a `tenantId` column that is missing `ENABLE`, `FORCE` or a policy.
- RLS doesn't apply while the app connects as `postgres` (a superuser). See [Database user](#database-user).
- [`http/tenants.http`](http/tenants.http) walks through it.

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
| `npm run keys:generate` | Create the access-token signing key at `keys/jwt-private.pem` |

## Database user

The app and migrations both connect as the `postgres` user. Because `postgres` is a superuser, Postgres never applies Row-Level Security to it, so the app logs a warning at startup.
