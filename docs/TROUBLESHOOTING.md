# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `python` not found on Windows | Install Python 3.10+ from python.org (tick "Add to PATH") or call it by full path, e.g. `C:\Python310\python.exe -m venv .venv`. |
| `ImproperlyConfigured: DJANGO_SECRET_KEY must be set` | You set `DJANGO_DEBUG=false` without a secret key. Set `DJANGO_SECRET_KEY` or use `DJANGO_DEBUG=true` locally. |
| Data disappears / wrong database | `DATABASE_URL` empty → SQLite file `backend/db.sqlite3`. Set it to your PostgreSQL URL and run `migrate`. |
| `seed_demo` says demo data already exists | `python manage.py flush --noinput` then `seed_demo` again (development only). |
| `Port 5173 is already in use` | Another Vite app is running. Start on a free port: `npx vite --port 5180` (the `/api` proxy still works). |
| Frontend shows "Cannot reach the server" | Django isn't running on `127.0.0.1:8000`, or `VITE_DEV_API_PROXY` points elsewhere. Restart `npm run dev` after editing `frontend/.env`. |
| Login works but every call returns 401 | Clock skew between machines, or `DJANGO_SECRET_KEY` changed (old tokens are invalid). Sign out/in. |
| "Your session expired" | The refresh token expired (`JWT_REFRESH_DAYS`) or was blacklisted by logout elsewhere — sign in again. |
| 403 on an action you expect to perform | Permissions are server-side: check the user's role (Users & Roles) and object rules — e.g. only the assigned reviewer approves, only the audit team edits responses, owners cannot verify their own actions unless *Allow self-verification* is on. |
| 404 for a record that exists | It belongs to another organisation or to a department you cannot see (by design). |
| 409 "Cannot … an audit that is …" | The workflow does not allow that transition in the current state; refresh the page. |
| Audit submission blocked | The workspace lists missing mandatory answers, missing required evidence and failed checks that need a finding. |
| Template version cannot be edited | Approved/archived versions and versions used by an audit are immutable — create a new version. |
| CORS errors in the browser | Only when the SPA and API are on different origins: add the SPA origin to `CORS_ALLOWED_ORIGINS` (and `DJANGO_CSRF_TRUSTED_ORIGINS`). |
| Redirect loop behind a proxy | The proxy must send `X-Forwarded-Proto: https`; otherwise set `SECURE_SSL_REDIRECT=false` and let the proxy redirect. |
| Upload rejected | Allowed extensions: `ALLOWED_UPLOAD_EXTENSIONS`; size: `MAX_UPLOAD_SIZE_MB` (also raise nginx `client_max_body_size`). Executables are always refused. |
| No emails | Default `EMAIL_BACKEND` prints to the console. Configure SMTP; check *Settings → Email notifications* and the user's notification preferences; failed sends show `email_status=FAILED`. |
| Reminders not sent | Without Celery beat, schedule `python manage.py run_reminders` daily. Reminders are deduplicated per event and threshold, so re-running is safe. |
| Celery worker exits on Windows | Use `celery -A config worker --pool=solo`. |
| `429 Too Many Requests` | Rate limits (`THROTTLE_*`). Wait a minute or raise the limit. |
| AI assistant says "not enabled" | Set `AI_ENABLED=true`, install `requirements-optional.txt`, configure `ANTHROPIC_API_KEY`, embeddings and `QDRANT_URL`; then upload, approve and index policy documents. |
| `verify_activity_log` reports broken entries | Someone modified activity rows directly in the database. Restore from backup and investigate database access. |
| PDF export looks empty | Filters exclude everything you can see — the report header lists the applied filters. |
