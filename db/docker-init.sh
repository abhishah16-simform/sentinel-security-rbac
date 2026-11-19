#!/bin/sh
# Docker entrypoint init script: creates the Sentinel database and its role.
set -eu
psql --username "$POSTGRES_USER" --dbname postgres \
  -v db_name="$SENTINEL_DB_NAME" \
  -v db_user="$SENTINEL_DB_USER" \
  -v db_password="$SENTINEL_DB_PASSWORD" \
  -f /sentinel-db/create-db.sql
