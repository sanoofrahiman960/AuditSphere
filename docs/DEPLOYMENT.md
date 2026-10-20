# Deploying AuditSphere

Two supported paths: **Docker Compose** (quickest) or a **traditional Linux server** (no Docker). Both use
PostgreSQL in production; SQLite is for local development only.

## 1. Configuration

All configuration is via environment variables (see `backend/.env.example` for the full annotated list).
Production minimum:

| Variable | Value |
|---|---|
| `DJANGO_DEBUG` | `false` |
| `DJANGO_SECRET_KEY` | long random string: `python -c "import secrets; print(secrets.token_urlsafe(50))"` |
| `DJANGO_ALLOWED_HOSTS` | `audit.example.com` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://audit.example.com` |
| `DATABASE_URL` | `postgres://user:password@host:5432/auditsphere` |
| `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` | `https://audit.example.com` (CORS only matters if the SPA is on another origin) |
| `CELERY_BROKER_URL` | `redis://redis:6379/0` (or leave empty and schedule `run_reminders`) |
| `EMAIL_BACKEND`, `EMAIL_HOST`, … | SMTP settings, or `N8N_WEBHOOK_URL` to hand emails to an n8n workflow |
| `STORAGE_BACKEND` | `local` (private volume) or `s3` with `AWS_*` variables |
| `TRUST_X_FORWARDED_FOR` | `true` only behind a proxy that sets the header |

With `DJANGO_DEBUG=false` Django enforces HTTPS redirects, secure cookies and HSTS (`SECURE_HSTS_SECONDS`, default
one year). Run `python manage.py check --deploy` before going live.

## 2. Docker Compose

```bash
cp .env.compose.example .env           # set DJANGO_SECRET_KEY, POSTGRES_PASSWORD, hostnames, SMTP
docker compose up -d --build
docker compose exec backend python manage.py create_organization \
    --name "Acme Corporation" --admin-email admin@acme.com --with-departments
docker compose exec backend python manage.py load_sample_templates --org acme-corporation   # optional
```

Services: `db` (PostgreSQL 16), `redis`, `backend` (gunicorn, runs migrations on start), `worker` and `beat`
(Celery), `frontend` (nginx serving the SPA and proxying `/api`, `/admin`, `/static`). The site listens on
`HTTP_PORT` (default 8080). Evidence files live in the `media` volume; database files in `pgdata`.

Put a TLS-terminating reverse proxy or load balancer in front (Caddy, Traefik, nginx, cloud LB), forward
`X-Forwarded-Proto: https`, then set `SECURE_SSL_REDIRECT=true`.

Upgrade: `git pull && docker compose up -d --build` (migrations run automatically in the `backend` container).

## 3. Without Docker (Linux)

```bash
# System packages: python3.12, python3.12-venv, postgresql, redis (optional), nginx, node 20 (build only)
sudo -u postgres createuser auditsphere -P && sudo -u postgres createdb -O auditsphere auditsphere

cd /opt/auditsphere/backend
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt            # + requirements-optional.txt for S3 / AI
cp .env.example .env && $EDITOR .env       # production values (section 1)
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py create_organization --name "Acme" --admin-email admin@acme.com --with-departments

cd ../frontend && npm ci && npm run build  # output: frontend/dist
```

**systemd units** (`/etc/systemd/system/`):

```ini
# auditsphere-web.service
[Service]
User=auditsphere
WorkingDirectory=/opt/auditsphere/backend
EnvironmentFile=/opt/auditsphere/backend/.env
ExecStart=/opt/auditsphere/backend/.venv/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 3 --timeout 120
Restart=always

# auditsphere-worker.service  → ExecStart=.../.venv/bin/celery -A config worker -l INFO
# auditsphere-beat.service    → ExecStart=.../.venv/bin/celery -A config beat -l INFO --schedule=/var/lib/auditsphere/beat-schedule
```

Without Redis/Celery, add a daily cron entry instead:
`0 7 * * * cd /opt/auditsphere/backend && .venv/bin/python manage.py run_reminders`.

**nginx** (TLS via certbot or your certificates):

```nginx
server {
    listen 443 ssl http2;
    server_name audit.example.com;
    ssl_certificate     /etc/letsencrypt/live/audit.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/audit.example.com/privkey.pem;
    client_max_body_size 25m;
    root /opt/auditsphere/frontend/dist;

    include /opt/auditsphere/frontend/security-headers.inc;   # same headers as the container image

    location ~ ^/(api|admin|static)/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location / { try_files $uri /index.html; }
}
server { listen 80; server_name audit.example.com; return 301 https://$host$request_uri; }
```

Uploaded evidence (`MEDIA_ROOT`, default `backend/private_media`) must **not** be exposed by nginx; files are only
served by authorised API endpoints.

**Windows Server:** gunicorn does not run on Windows. Use Docker Desktop / WSL2, or serve the WSGI app with a
Windows-compatible server such as waitress (`pip install waitress`,
`waitress-serve --listen=127.0.0.1:8000 config.wsgi:application`) behind IIS/nginx, run Celery with `--pool=solo`,
or schedule `run_reminders` with Task Scheduler.

## 4. Operations

* **Health checks:** `GET /api/health/` (liveness) and `GET /api/health/ready/` (database + broker; returns 503 when degraded).
* **Logging:** JSON lines on stdout (`LOG_FORMAT=json`) including `request_id`; every response carries `X-Request-ID`.
* **Error monitoring:** set `SENTRY_DSN` (install `sentry-sdk`); PII is not sent.
* **Audit trail integrity:** `python manage.py verify_activity_log` (exit code 1 if tampering is detected) — run it
  daily from cron/CI and alert on failure.
* **Rate limits:** `THROTTLE_LOGIN`, `THROTTLE_EXPORT`, `THROTTLE_AI`, `THROTTLE_USER`, `THROTTLE_ANON`.

## 5. Backup and recovery

| Asset | Backup | Restore |
|---|---|---|
| PostgreSQL | `pg_dump -Fc auditsphere > auditsphere-$(date +%F).dump` nightly + WAL archiving / managed PITR for production | `pg_restore -d auditsphere --clean auditsphere-YYYY-MM-DD.dump` |
| Evidence files | snapshot the `MEDIA_ROOT` volume (or enable S3 versioning + lifecycle) | restore the directory/bucket to the same paths |
| Configuration | keep `.env` in your secrets manager | |

Docker: `docker compose exec db pg_dump -U auditsphere -Fc auditsphere > backup.dump` and back up the `media` volume.
Test restores regularly in a staging environment; after a restore run `python manage.py verify_activity_log`.

## 6. CI/CD

`.github/workflows/ci.yml` runs on every push/PR:

* backend: `manage.py check --deploy`, a migration drift check, and the full test suite against PostgreSQL 16;
* frontend: `npm ci`, typecheck, unit tests, production build.

Recommended pipeline: CI → build and push the two images tagged with the commit SHA → deploy to staging
(`docker compose pull && up -d`) → smoke test `/api/health/ready/` → promote the same images to production.
Never run `seed_demo` outside development.

## 7. Enabling the AI module (optional)

```bash
pip install -r requirements-optional.txt
AI_ENABLED=true
ANTHROPIC_API_KEY=...                       # model: AI_MODEL (default claude-opus-5-5)
EMBEDDING_API_URL=https://api.voyageai.com/v1/embeddings  EMBEDDING_API_KEY=...  EMBEDDING_MODEL=voyage-3
EMBEDDING_DIMENSIONS=1024
QDRANT_URL=http://qdrant:6333               # e.g. add a qdrant/qdrant service to docker-compose
```

Upload policies in the Policy Assistant page, approve them, then index. Only approved, indexed documents in the
caller's organisation are searched; answers cite their passages; drafts are never saved automatically.
