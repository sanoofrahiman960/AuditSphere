"""
AuditSphere settings.

Everything environment-specific is read from environment variables (optionally
loaded from backend/.env). See .env.example for the full list.
"""
from datetime import timedelta
from pathlib import Path
import os
import sys

import dj_database_url
from celery.schedules import crontab
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env(name, default=None):
    return os.environ.get(name, default)


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name, default=""):
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


def env_int(name, default):
    return int(os.environ.get(name, default))


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = env("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-only-insecure-key-never-use-in-production-0001"
    else:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is false.")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "")
# Only enable behind a reverse proxy that overwrites X-Forwarded-For.
TRUST_X_FORWARDED_FOR = env_bool("TRUST_X_FORWARDED_FOR", False)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # third party
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "corsheaders",
    "drf_spectacular",
    # local
    "apps.core",
    "apps.organizations",
    "apps.accounts",
    "apps.departments",
    "apps.audit_templates",
    "apps.audits",
    "apps.findings",
    "apps.corrective_actions",
    "apps.notifications",
    "apps.activity_logs",
    "apps.reports",
    "apps.ai_assistant",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.core.middleware.RequestIdMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# --- Database ---------------------------------------------------------------
# Local development defaults to a SQLite file. Set DATABASE_URL to use
# PostgreSQL, e.g. postgres://auditsphere:secret@localhost:5432/auditsphere
DATABASES = {
    "default": dj_database_url.parse(
        env("DATABASE_URL") or f"sqlite:///{(BASE_DIR / 'db.sqlite3').as_posix()}",
        conn_max_age=env_int("DATABASE_CONN_MAX_AGE", 60),
        conn_health_checks=True,
    )
}
if DATABASES["default"]["ENGINE"] == "django.db.backends.sqlite3":
    DATABASES["default"].pop("CONN_MAX_AGE", None)
    DATABASES["default"]["OPTIONS"] = {"timeout": 20}

AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

TESTING = len(sys.argv) > 1 and sys.argv[1] == "test"
if TESTING:
    # Fast hashing and no throttling in the test suite only.
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

LANGUAGE_CODE = "en-us"
TIME_ZONE = env("TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# Uploaded evidence is private: MEDIA_ROOT is never exposed through a URL,
# files are streamed by authorised API endpoints only.
MEDIA_ROOT = Path(env("MEDIA_ROOT", BASE_DIR / "private_media"))
MEDIA_URL = "/media-not-served/"

if env("STORAGE_BACKEND", "local") == "s3":
    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": env("AWS_STORAGE_BUCKET_NAME"),
            "region_name": env("AWS_S3_REGION_NAME"),
            "endpoint_url": env("AWS_S3_ENDPOINT_URL") or None,
            "default_acl": "private",
            "querystring_auth": True,
            "file_overwrite": False,
        },
    }

MAX_UPLOAD_SIZE_MB = env_int("MAX_UPLOAD_SIZE_MB", 20)
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
ALLOWED_UPLOAD_EXTENSIONS = env_list(
    "ALLOWED_UPLOAD_EXTENSIONS",
    "pdf,png,jpg,jpeg,gif,webp,txt,csv,doc,docx,xls,xlsx,ppt,pptx,zip,msg,eml",
)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- REST framework -----------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": env("THROTTLE_ANON", "60/min"),
        "user": env("THROTTLE_USER", "1200/min"),
        "login": env("THROTTLE_LOGIN", "10/min"),
        "export": env("THROTTLE_EXPORT", "30/min"),
        "ai": env("THROTTLE_AI", "20/min"),
    },
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

if TESTING:
    REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {k: "100000/min" for k in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env_int("JWT_ACCESS_MINUTES", 15)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env_int("JWT_REFRESH_DAYS", 1)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# Plain APIViews (dashboard/report/health endpoints) return documented dict shapes that drf-spectacular
# cannot infer; their schema-inference warnings are noise in `manage.py check`.
SILENCED_SYSTEM_CHECKS = ["drf_spectacular.W001", "drf_spectacular.W002"]

SPECTACULAR_SETTINGS = {
    "TITLE": "AuditSphere API",
    "DESCRIPTION": "Enterprise multi-department audit management API.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
}

# --- CORS ---------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
CORS_EXPOSE_HEADERS = ["Content-Disposition", "X-Request-ID"]

# --- Email ---------------------------------------------------------------------
EMAIL_BACKEND = env("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", "localhost")
EMAIL_PORT = env_int("EMAIL_PORT", 587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "AuditSphere <no-reply@auditsphere.local>")
FRONTEND_URL = env("FRONTEND_URL", "http://localhost:5173")

# --- Celery ---------------------------------------------------------------------
# Without a broker URL tasks run synchronously (local development without Redis).
CELERY_BROKER_URL = env("CELERY_BROKER_URL", "")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", "") or None
CELERY_TASK_ALWAYS_EAGER = not CELERY_BROKER_URL
CELERY_TASK_EAGER_PROPAGATES = False
CELERY_TIMEZONE = TIME_ZONE
CELERY_BEAT_SCHEDULE = {
    "daily-reminders": {
        "task": "apps.notifications.tasks.run_reminders_task",
        "schedule": crontab(hour=env_int("REMINDER_HOUR", 7), minute=0),
    },
}

# --- n8n (optional) ---------------------------------------------------------------
N8N_WEBHOOK_URL = env("N8N_WEBHOOK_URL", "")

# --- AI module (optional) ----------------------------------------------------------
AI_ENABLED = env_bool("AI_ENABLED", False)
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", "")
AI_MODEL = env("AI_MODEL", "claude-opus-5-5")
EMBEDDING_API_URL = env("EMBEDDING_API_URL", "")
EMBEDDING_API_KEY = env("EMBEDDING_API_KEY", "")
EMBEDDING_MODEL = env("EMBEDDING_MODEL", "")
EMBEDDING_DIMENSIONS = env_int("EMBEDDING_DIMENSIONS", 1024)
QDRANT_URL = env("QDRANT_URL", "")
QDRANT_API_KEY = env("QDRANT_API_KEY", "")
QDRANT_COLLECTION = env("QDRANT_COLLECTION", "auditsphere_policies")

# --- Security -----------------------------------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_HTTPONLY = True
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = env_int("SECURE_HSTS_SECONDS", 31536000)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", False)
    SECURE_REFERRER_POLICY = "same-origin"

# --- Logging (structured JSON lines) ---------------------------------------------------
LOG_LEVEL = env("LOG_LEVEL", "INFO")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {"()": "apps.core.logging.JsonFormatter"},
        "plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "filters": {"request_id": {"()": "apps.core.logging.RequestIdFilter"}},
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": env("LOG_FORMAT", "plain" if DEBUG else "json"),
            "filters": ["request_id"],
        }
    },
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    "loggers": {
        "django.db.backends": {"level": "WARNING"},
        "auditsphere": {"level": LOG_LEVEL, "propagate": True},
    },
}

# Optional Sentry error monitoring
SENTRY_DSN = env("SENTRY_DSN", "")
if SENTRY_DSN:
    try:
        import sentry_sdk

        sentry_sdk.init(dsn=SENTRY_DSN, traces_sample_rate=float(env("SENTRY_TRACES_SAMPLE_RATE", "0")),
                        send_default_pii=False)
    except ImportError:  # pragma: no cover
        pass
