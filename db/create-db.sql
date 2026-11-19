-- Creates the Sentinel database and the single role that owns it, runs migrations
-- and is used by the app. Run as a superuser, e.g.:
--   sudo -u postgres psql -v db_name=sentinel -v db_user=sentinel -v db_password=... -f db/create-db.sql
--
-- The role is deliberately NOT a superuser and has no BYPASSRLS: Postgres never applies
-- Row-Level Security to those. Because this role also owns the tables, every Tenant table
-- must use FORCE ROW LEVEL SECURITY (see docs/adr/0003-single-database-role.md).
-- CREATEDB lets `prisma migrate dev` create its temporary shadow database.
\set ON_ERROR_STOP on

CREATE ROLE :"db_user" LOGIN CREATEDB PASSWORD :'db_password'
  NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE :"db_name" OWNER :"db_user";
