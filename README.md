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
| `CORS_ALLOWED_ORIGINS` | none | Comma-separated origins allowed to call the API from a browser, such as an Application's login page |

## Logging in and sessions

- `POST /v1/auth/signup`, `POST /v1/auth/verify-email` and `POST /v1/auth/resend-verification` handle signup and email verification. Passwords are hashed with argon2id.
- `POST /v1/auth/login` returns a 10-minute RS256 access token in the body and sets the refresh token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie whose path is `/v1/auth/refresh`, so the browser sends it nowhere else.
- `POST /v1/auth/refresh` swaps the cookie for a new refresh token and a new access token. Each refresh token works once. Presenting one that was already used revokes every refresh token from that login.
- `DELETE /v1/auth/refresh` logs out on this device. `POST /v1/auth/logout-all` (Bearer token) logs out everywhere.
- Applications verify access tokens with the public key at `/.well-known/jwks.json`. The key ID (`kid`) is the key's RFC 7638 thumbprint, so a new key always gets a new ID.
- [`http/auth.http`](http/auth.http) walks through the whole flow.

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

## Database role

Sentinel uses one Postgres role for everything: it owns the tables, runs migrations and is what the app connects as ([ADR 0003](docs/adr/0003-single-database-role.md)).

- Every Tenant table's migration must run both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`; without `FORCE`, RLS doesn't apply to the table's owner.
- The role must not be a superuser or have `BYPASSRLS`, because RLS never applies to those. The app logs a warning at startup if it is connected as such a role.
