import django_filters
from django.db import transaction
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.activity_logs.services import log_activity
from apps.core.permissions import IsOrgMember, capability_required

from .models import User
from .roles import Cap
from .serializers import ChangePasswordSerializer, LoginSerializer, MeSerializer, RoleSerializer, UserSerializer


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        email = str(request.data.get("email", "")).lower()[:254]
        try:
            serializer.is_valid(raise_exception=True)
        except Exception:
            known = User.objects.filter(email=email).select_related("organization").first()
            log_activity(None, "auth.login_failed", organization=getattr(known, "organization", None),
                         object_type="accounts.user", object_id=getattr(known, "pk", ""), object_repr=email,
                         request=request)
            raise
        log_activity(serializer.user, "auth.login", serializer.user, request=request)
        return Response(serializer.validated_data, status=status.HTTP_200_OK)


class RefreshView(TokenRefreshView):
    permission_classes = [AllowAny]


class LogoutView(APIView):
    permission_classes = [IsOrgMember]

    def post(self, request):
        refresh = request.data.get("refresh")
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except TokenError:
                pass  # already expired or blacklisted — logging out is still successful
        log_activity(request.user, "auth.logout", request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsOrgMember]

    def get(self, request):
        return Response(MeSerializer(request.user).data)

    def patch(self, request):
        serializer = MeSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ChangePasswordView(APIView):
    permission_classes = [IsOrgMember]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        log_activity(request.user, "auth.password_changed", request.user, request=request)
        return Response({"detail": "Password changed. Please sign in again on other devices."})


class UserFilter(django_filters.FilterSet):
    department = django_filters.NumberFilter(field_name="department_memberships__department_id")
    role = django_filters.MultipleChoiceFilter(choices=User._meta.get_field("role").choices)

    class Meta:
        model = User
        fields = ["role", "is_active", "department"]


class UserViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                  mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    Organisation users. Every member can list users (for assignment pickers);
    only Super Administrators can create, edit, change roles or deactivate.
    Users are never deleted, because they are referenced by audit records.
    """

    serializer_class = UserSerializer
    permission_classes = [capability_required(Cap.MANAGE_USERS)]
    filterset_class = UserFilter
    search_fields = ["email", "first_name", "last_name", "job_title"]
    ordering_fields = ["first_name", "last_name", "email", "role", "last_login"]

    def get_queryset(self):
        return User.objects.filter(organization_id=self.request.user.organization_id).distinct()

    @transaction.atomic
    def perform_create(self, serializer):
        user = serializer.save()
        log_activity(self.request.user, "user.created", user, request=self.request,
                     changes={"email": user.email, "role": user.role})

    @transaction.atomic
    def perform_update(self, serializer):
        before = {"role": serializer.instance.role, "is_active": serializer.instance.is_active}
        user = serializer.save()
        after ={"role": user.role, "is_active": user.is_active}
        if before != after:
            log_activity(self.request.user, "user.permissions_changed", user, request=self.request,
                         changes={k: {"from": before[k], "to": after[k]} for k in after if before[k] != after[k]})
        else:
            log_activity(self.request.user, "user.updated", user, request=self.request)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.pk == request.user.pk and (
            ("role" in request.data and request.data["role"] != instance.role)
            or ("is_active" in request.data and not request.data["is_active"])
        ):
            return Response({"detail": "You cannot change your own role or deactivate yourself.",
                             "code": "self_change", "errors": None}, status=status.HTTP_400_BAD_REQUEST)
        return super().update(request, *args, **kwargs)

    @action(detail=False, methods=["get"], permission_classes=[IsOrgMember], pagination_class=None)
    def roles(self, request):
        return Response(RoleSerializer.all())
