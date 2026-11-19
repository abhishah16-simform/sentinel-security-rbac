#!/bin/sh
# Docker entrypoint init script: creates the restricted app role in the container's database.
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_role="$POSTGRES_USER" \
  -v app_role="$SENTINEL_APP_ROLE" \
  -v app_password="$SENTINEL_APP_PASSWORD" \
  -f /sentinel-db/setup-app-role.sql
