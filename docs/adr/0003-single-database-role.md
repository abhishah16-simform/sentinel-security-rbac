# One database role, with FORCE ROW LEVEL SECURITY on every Tenant table

Sentinel uses a single Postgres role that owns the tables, runs migrations and serves the app, following Prisma's normal single-URL flow. We chose this over a separate owner role for migrations and a restricted app role, which would have made RLS impossible to skip by construction, because one role and one connection string are simpler to set up and deploy.

## Consequences

- Postgres doesn't apply RLS to a table's owner by default, so every Tenant table's migration must run both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. If one table forgets `FORCE`, that table silently loses database-level isolation.
- RLS never applies to a superuser or a role with `BYPASSRLS`, even with `FORCE`. The app logs a warning at startup when connected as such a role (for example `postgres`) but still starts. In that case tenant isolation rests only on the app's own tenant filters.
- The role needs `CREATEDB` so that `prisma migrate dev` can create its shadow database.
