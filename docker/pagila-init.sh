#!/bin/bash
set -euo pipefail

echo "Loading Pagila sample database..."

# Pagila SQL references the postgres role; create it for compatibility.
psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    CREATE ROLE postgres WITH SUPERUSER LOGIN PASSWORD '${POSTGRES_PASSWORD}';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END
  \$\$;
EOSQL

wget -qO /tmp/pagila-schema.sql \
  "https://raw.githubusercontent.com/devrimgunduz/pagila/master/pagila-schema.sql"
wget -qO /tmp/pagila-data.sql \
  "https://raw.githubusercontent.com/devrimgunduz/pagila/master/pagila-data.sql"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /tmp/pagila-schema.sql
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /tmp/pagila-data.sql

echo "Pagila loaded successfully."
