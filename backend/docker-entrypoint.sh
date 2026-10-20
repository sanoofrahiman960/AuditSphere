#!/bin/sh
set -e
# Apply migrations only from the web container (RUN_MIGRATIONS=true) to avoid races between replicas.
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  python manage.py migrate --noinput
fi
exec "$@"
