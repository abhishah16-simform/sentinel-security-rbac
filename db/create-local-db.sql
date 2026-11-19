-- One-off setup for a local (non-Docker) PostgreSQL. Run as a superuser, e.g.:
--   sudo -u postgres psql -v db_name=sentinel -v owner_role=sentinel_owner \
--     -v owner_password=... -v app_role=sentinel_app -v app_password=... \
--     -f db/create-local-db.sql
--
-- The owner role runs migrations and owns every table. CREATEDB lets
-- `prisma migrate dev` create its temporary shadow database.
\set ON_ERROR_STOP on

CREATE ROLE :"owner_role" LOGIN CREATEDB PASSWORD :'owner_password';
CREATE DATABASE :"db_name" OWNER :"owner_role";

\connect :"db_name"
\ir setup-app-role.sql
