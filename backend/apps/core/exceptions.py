"""Uniform error payloads: {"detail": str, "code": str, "errors": {field: [msg]} | null}."""
import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger("auditsphere")


class WorkflowError(exceptions.APIException):
    """Raised when a state transition is not allowed from the current state."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "This action is not allowed in the current state."
    default_code = "invalid_transition"


class BusinessRuleError(exceptions.APIException):
    """A request that is well-formed but violates a domain rule (e.g. incomplete checklist)."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "The request violates a business rule."
    default_code = "business_rule"

    def __init__(self, detail=None, code=None, errors=None):
        super().__init__(detail, code)
        self.errors = errors


def api_exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(exc.message_dict if hasattr(exc, "message_dict") else exc.messages)
    elif isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()
    elif isinstance(exc, IntegrityError):
        logger.warning("Integrity error: %s", exc)
        exc = exceptions.ValidationError({"non_field_errors": ["This record conflicts with an existing one."]})

    response = exception_handler(exc, context)
    if response is None:
        logger.exception("Unhandled API error", exc_info=exc)
        return Response(
            {"detail": "An unexpected error occurred.", "code": "server_error", "errors": None},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    data = response.data
    if isinstance(exc, exceptions.ValidationError):
        errors = data if isinstance(data, dict) else {"non_field_errors": data}
        detail = _first_message(errors) or "Invalid input."
        code = "validation_error"
    else:
        detail = data.get("detail", str(exc)) if isinstance(data, dict) else str(data)
        codes = exc.get_codes() if hasattr(exc, "get_codes") else None
        code = codes.get("detail") if isinstance(codes, dict) else codes
        errors = getattr(exc, "errors", None)
    response.data = {"detail": str(detail), "code": code or "error", "errors": errors}
    return response


def _first_message(data):
    if isinstance(data, dict):
        for key, value in data.items():
            msg = _first_message(value)
            if msg:
                return msg if key in ("non_field_errors", "detail") else f"{key}: {msg}"
    elif isinstance(data, (list, tuple)):
        for item in data:
            msg = _first_message(item)
            if msg:
                return msg
    elif data:
        return str(data)
    return None
