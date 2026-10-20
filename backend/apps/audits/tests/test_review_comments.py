import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from apps.audits.models import ReviewComment
from apps.core.tests.factories import World, client_for

MEDIA = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=MEDIA)
class ReviewCommentTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.w = World(start=True)
        self.q = self.w.questions()
        self.auditor = client_for(self.w.auditor)
        self.reviewer = client_for(self.w.reviewer)
        self.url = f"/api/audits/{self.w.audit.id}"
        self.auditor.put(f"{self.url}/responses/", {"responses": [
            {"question_id": self.q["Q1"].id, "choice_value": "YES"},
            {"question_id": self.q["Q2"].id, "choice_value": "PASS"},
            {"question_id": self.q["Q3"].id, "choice_value": "YES"},
        ]}, format="json")
        workspace = self.auditor.get(f"{self.url}/workspace/").json()
        response_id = next(q["response"]["id"] for s in workspace["sections"] for q in s["questions"] if q["code"] == "Q2")
        self.auditor.post(f"{self.url}/evidence/", {"file": SimpleUploadedFile("e.pdf", b"%PDF-1.4"),
                                                    "response_id": response_id}, format="multipart")
        self.assertEqual(self.auditor.post(f"{self.url}/submit/").status_code, 200)

    def comment(self, client, body="Attach the sample list", question="Q1"):
        return client.post(f"{self.url}/review-comments/",
                           {"body": body, "question_id": self.q[question].id if question else None}, format="json")

    def test_reviewer_comments_on_questions(self):
        response = self.comment(self.reviewer)
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(response.json()["question_code"], "Q1")
        self.assertEqual(self.comment(self.auditor).status_code, 403)
        self.assertEqual(self.comment(self.reviewer, body="  ").status_code, 400)
        detail = self.reviewer.get(f"{self.url}/").json()
        self.assertTrue(detail["permissions"]["can_add_review_comments"])

    def test_question_comments_are_enough_to_request_rework(self):
        self.assertEqual(self.reviewer.post(f"{self.url}/request-rework/", {"comments": ""}).status_code, 400)
        self.comment(self.reviewer)
        response = self.reviewer.post(f"{self.url}/request-rework/", {"comments": ""})
        self.assertEqual(response.json()["status"], "REWORK_REQUIRED")

    def test_open_comments_block_resubmission_until_resolved(self):
        comment_id = self.comment(self.reviewer).json()["id"]
        self.reviewer.post(f"{self.url}/request-rework/", {"comments": "See question comments"})
        workspace = self.auditor.get(f"{self.url}/workspace/").json()
        self.assertEqual(len(workspace["review_comments"]), 1)
        self.assertEqual([i["code"] for i in workspace["issues"]], ["review_comment_open"])
        self.auditor.post(f"{self.url}/start/")
        blocked = self.auditor.post(f"{self.url}/submit/")
        self.assertEqual(blocked.status_code, 400)

        resolve_url = f"{self.url}/review-comments/{comment_id}/resolve/"
        self.assertEqual(self.reviewer.post(resolve_url, {"note": "x"}).status_code, 403)  # reviewer can't self-resolve
        resolved = self.auditor.post(resolve_url, {"note": "Sample list attached"})
        self.assertTrue(resolved.json()["is_resolved"])
        self.assertEqual(self.auditor.post(resolve_url, {}).status_code, 409)
        self.assertEqual(self.auditor.post(f"{self.url}/submit/").status_code, 200)
        self.assertEqual(ReviewComment.objects.get(id=comment_id).resolved_by, self.w.auditor)

    def test_resolving_a_comment_resumes_the_reworked_audit(self):
        comment_id = self.comment(self.reviewer).json()["id"]
        self.reviewer.post(f"{self.url}/request-rework/", {"comments": ""})
        self.auditor.post(f"{self.url}/review-comments/{comment_id}/resolve/", {"note": "Done"})
        self.assertEqual(self.auditor.get(f"{self.url}/").json()["status"], "IN_PROGRESS")
        self.assertEqual(self.auditor.post(f"{self.url}/submit/").status_code, 200)

    def test_comments_only_while_under_review(self):
        self.reviewer.post(f"{self.url}/approve/")
        self.assertEqual(self.comment(self.reviewer).status_code, 409)

    def test_question_must_belong_to_the_audit(self):
        response = self.reviewer.post(f"{self.url}/review-comments/", {"body": "x", "question_id": 999999},
                                      format="json")
        self.assertEqual(response.status_code, 400)
