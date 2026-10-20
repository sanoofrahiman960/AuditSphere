import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from apps.activity_logs.models import AuditActivityLog
from apps.audits.models import AuditEvidence
from apps.core.tests.factories import World, client_for

MEDIA = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=MEDIA, MAX_UPLOAD_SIZE_MB=1)
class EvidenceAuthorizationTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.w = World(start=True)
        self.globex = World("globex")
        self.url = f"/api/audits/{self.w.audit.id}/evidence/"

    def upload(self, user, name="proof.pdf", content=b"%PDF-1.4 evidence"):
        return client_for(user).post(self.url, {"file": SimpleUploadedFile(name, content)}, format="multipart")

    def test_team_member_uploads_and_downloads(self):
        response = self.upload(self.w.auditor)
        self.assertEqual(response.status_code, 201, response.json())
        evidence = AuditEvidence.objects.get()
        self.assertEqual(len(evidence.sha256), 64)
        self.assertNotIn("proof", evidence.file.name)  # stored under a random key
        download = client_for(self.w.reviewer).get(f"/api/audit-evidence/{evidence.id}/download/")
        self.assertEqual(download.status_code, 200)
        self.assertEqual(b"".join(download.streaming_content), b"%PDF-1.4 evidence")
        self.assertIn("attachment", download["Content-Disposition"])
        self.assertTrue(AuditActivityLog.objects.filter(action="evidence.downloaded").exists())

    def test_disallowed_type_and_executables_rejected(self):
        self.assertEqual(self.upload(self.w.auditor, "run.exe", b"MZ....").status_code, 400)
        self.assertEqual(self.upload(self.w.auditor, "fake.pdf", b"MZ\x90\x00binary").status_code, 400)
        self.assertEqual(self.upload(self.w.auditor, "script.sh", b"#!/bin/sh").status_code, 400)

    def test_size_limit(self):
        self.assertEqual(self.upload(self.w.auditor, "big.pdf", b"x" * (1024 * 1024 + 1)).status_code, 400)

    def test_unrelated_users_cannot_upload_or_download(self):
        self.assertEqual(self.upload(self.w.other_auditor).status_code, 404)
        self.assertEqual(self.upload(self.w.manager).status_code, 403)
        self.upload(self.w.auditor)
        evidence = AuditEvidence.objects.get()
        for user in (self.w.other_auditor, self.globex.admin, self.w.owner):
            self.assertEqual(client_for(user).get(f"/api/audit-evidence/{evidence.id}/download/").status_code, 404)

    def test_evidence_removal_only_while_editable_and_by_uploader(self):
        self.upload(self.w.auditor)
        evidence = AuditEvidence.objects.get()
        self.assertEqual(client_for(self.w.reviewer).delete(f"/api/audit-evidence/{evidence.id}/").status_code, 403)
        self.assertEqual(client_for(self.w.auditor).delete(f"/api/audit-evidence/{evidence.id}/").status_code, 204)
        self.assertTrue(AuditActivityLog.objects.filter(action="evidence.deleted").exists())
