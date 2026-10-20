from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Organization, OrganizationSettings


@receiver(post_save, sender=Organization)
def create_settings(sender, instance, created, **kwargs):
    if created:
        OrganizationSettings.objects.get_or_create(organization=instance)
