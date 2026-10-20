from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.core.scoping import managed_department_ids

from .models import User
from .roles import Role, capabilities_for


class UserSummarySerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "role", "job_title"]
        read_only_fields = fields


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    password = serializers.CharField(write_only=True, required=False, style={"input_type": "password"})
    department_ids = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "email", "first_name", "last_name", "full_name", "role", "role_display", "job_title", "phone",
            "is_active", "last_login", "date_joined", "password", "department_ids",
        ]
        read_only_fields = ["id", "last_login", "date_joined"]

    def get_department_ids(self, obj):
        return sorted(obj.department_memberships.filter(is_active=True).values_list("department_id", flat=True))

    def validate_email(self, value):
        value = value.lower()
        qs = User.objects.filter(email=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, attrs):
        password = attrs.get("password")
        if self.instance is None and not password:
            raise serializers.ValidationError({"password": ["An initial password is required."]})
        if password:
            candidate = User(email=attrs.get("email", ""), first_name=attrs.get("first_name", ""),
                             last_name=attrs.get("last_name", ""))
            try:
                password_validation.validate_password(password, candidate)
            except DjangoValidationError as exc:
                raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(organization=self.context["request"].user.organization, **validated_data)
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class MeSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    organization = serializers.SerializerMethodField()
    capabilities = serializers.SerializerMethodField()
    managed_department_ids = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "email", "first_name", "last_name", "full_name", "role", "role_display", "job_title", "phone",
            "organization", "capabilities", "managed_department_ids", "last_login",
        ]
        read_only_fields = ["id", "email", "role", "last_login"]

    def get_organization(self, obj):
        if not obj.organization_id:
            return None
        return {"id": obj.organization_id, "name": obj.organization.name, "slug": obj.organization.slug}

    def get_capabilities(self, obj):
        return capabilities_for(obj)

    def get_managed_department_ids(self, obj):
        return sorted(managed_department_ids(obj)) if obj.organization_id else []


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate(self, attrs):
        try:
            password_validation.validate_password(attrs["new_password"], self.context["request"].user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)})
        if attrs["new_password"] == attrs["current_password"]:
            raise serializers.ValidationError({"new_password": ["Choose a different password."]})
        return attrs


class LoginSerializer(TokenObtainPairSerializer):
    """Returns access/refresh tokens plus the user's profile."""

    default_error_messages = {"no_active_account": "Invalid email or password."}

    def validate(self, attrs):
        attrs[self.username_field] = attrs.get(self.username_field, "").lower()
        data = super().validate(attrs)
        if not self.user.organization_id or not self.user.organization.is_active:
            raise serializers.ValidationError({"detail": "Your account is not attached to an active organisation."})
        data["user"] = MeSerializer(self.user).data
        return data

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["org"] = user.organization_id
        return token


class RoleSerializer(serializers.Serializer):
    value = serializers.CharField()
    label = serializers.CharField()

    @staticmethod
    def all():
        return [{"value": value, "label": label} for value, label in Role.choices]
