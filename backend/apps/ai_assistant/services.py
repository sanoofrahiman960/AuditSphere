"""
Optional AI assistant (disabled unless AI_ENABLED=true).

Pipeline: approved policy document -> text extraction -> chunking -> embeddings
-> Qdrant. Questions retrieve organisation-scoped passages and Claude answers
from those passages only, with native document citations. Drafts are
suggestions returned to the user — nothing here writes audit data, and the
model never decides severity or compliance.

Optional dependencies (requirements-optional.txt): anthropic, qdrant-client, pypdf.
"""
import json
import logging
import urllib.request
import uuid

from django.conf import settings
from rest_framework.exceptions import APIException

logger = logging.getLogger("auditsphere.ai")

CHUNK_CHARS = 1800
CHUNK_OVERLAP = 200
DISCLAIMER = ("AI-generated draft for human review. Verify against the evidence and approved policies before use; "
              "it does not determine compliance or risk severity.")


class AIUnavailable(APIException):
    status_code = 503
    default_detail = "The AI assistant is not enabled or not configured."
    default_code = "ai_unavailable"


class AIRefused(APIException):
    status_code = 422
    default_detail = "The AI model declined this request."
    default_code = "ai_refused"


def status():
    return {
        "enabled": settings.AI_ENABLED,
        "llm_configured": bool(settings.AI_ENABLED and _has_anthropic()),
        "retrieval_configured": bool(settings.AI_ENABLED and settings.QDRANT_URL and settings.EMBEDDING_API_URL),
        "model": settings.AI_MODEL if settings.AI_ENABLED else None,
        "disclaimer": DISCLAIMER,
    }


def _has_anthropic():
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return True


def _require(retrieval=False):
    state = status()
    if not state["enabled"]:
        raise AIUnavailable("The AI assistant is disabled (set AI_ENABLED=true).")
    if not state["llm_configured"]:
        raise AIUnavailable("Install the 'anthropic' package and configure ANTHROPIC_API_KEY.")
    if retrieval and not state["retrieval_configured"]:
        raise AIUnavailable("Policy search needs QDRANT_URL and EMBEDDING_API_URL.")


# --------------------------------------------------------------------------- ingestion

def extract_pages(document):
    """Return [(page_number, text)] for PDF / plain-text documents."""
    name = document.original_name.lower()
    with document.file.open("rb") as handle:
        if name.endswith(".pdf"):
            from pypdf import PdfReader

            reader = PdfReader(handle)
            return [(i + 1, (page.extract_text() or "").strip()) for i, page in enumerate(reader.pages)]
        if name.endswith((".txt", ".md", ".csv")):
            return [(1, handle.read().decode("utf-8", errors="replace"))]
    raise ValueError("Only PDF and plain-text policy documents can be indexed.")


def chunk_pages(pages):
    """Split page text into overlapping chunks that keep their page number."""
    chunks = []
    for page_number, text in pages:
        text = " ".join(text.split())
        start = 0
        while start < len(text):
            end = min(len(text), start + CHUNK_CHARS)
            if end < len(text):
                boundary = text.rfind(". ", start + CHUNK_CHARS // 2, end)
                end = boundary + 1 if boundary != -1 else end
            piece = text[start:end].strip()
            if piece:
                chunks.append((page_number, piece))
            if end >= len(text):
                break
            start = max(end - CHUNK_OVERLAP, start + 1)
    return chunks


def embed(texts, input_type="document"):
    """
    Embeddings through a configurable HTTP provider (Voyage-style API:
    POST {input, model, input_type} -> {data: [{embedding}]}).
    """
    body = json.dumps({"input": texts, "model": settings.EMBEDDING_MODEL, "input_type": input_type}).encode()
    request = urllib.request.Request(
        settings.EMBEDDING_API_URL, data=body, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {settings.EMBEDDING_API_KEY}"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 (URL from settings)
        payload = json.loads(response.read())
    return [item["embedding"] for item in payload["data"]]


def _qdrant():
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, VectorParams

    client = QdrantClient(url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY or None)
    if not client.collection_exists(settings.QDRANT_COLLECTION):
        client.create_collection(
            settings.QDRANT_COLLECTION,
            vectors_config=VectorParams(size=settings.EMBEDDING_DIMENSIONS, distance=Distance.COSINE),
        )
    return client


def index_document(document):
    """Extract, chunk, embed and store a policy document. Records failures on the document."""
    _require(retrieval=True)
    from qdrant_client.models import FieldCondition, Filter, FilterSelector, MatchValue, PointStruct

    from .models import PolicyChunk, PolicyDocument

    try:
        pages = extract_pages(document)
        chunks = chunk_pages(pages)
        client = _qdrant()
        client.delete(settings.QDRANT_COLLECTION, points_selector=FilterSelector(filter=Filter(
            must=[FieldCondition(key="document_id", match=MatchValue(value=document.id))])))
        document.chunks.all().delete()
        for start in range(0, len(chunks), 64):
            batch = chunks[start:start + 64]
            vectors = embed([text for _, text in batch])
            points, rows = [], []
            for offset, ((page, text), vector) in enumerate(zip(batch, vectors)):
                point_id = str(uuid.uuid4())
                index = start + offset
                points.append(PointStruct(id=point_id, vector=vector, payload={
                    "organization_id": document.organization_id, "document_id": document.id,
                    "department_id": document.department_id, "chunk_index": index, "page": page,
                }))
                rows.append(PolicyChunk(document=document, chunk_index=index, page_number=page, text=text,
                                        point_id=point_id))
            client.upsert(settings.QDRANT_COLLECTION, points=points)
            PolicyChunk.objects.bulk_create(rows)
        document.page_count = len(pages)
        document.chunk_count = len(chunks)
        document.status = PolicyDocument.Status.PROCESSED
        document.error = ""
    except AIUnavailable:
        raise
    except Exception as exc:  # extraction, embedding or vector-store failure
        logger.exception("Indexing policy document %s failed", document.id)
        document.status = PolicyDocument.Status.FAILED
        document.error = str(exc)[:1000]
    document.save(update_fields=["page_count", "chunk_count", "status", "error", "updated_at"])
    return document


# --------------------------------------------------------------------------- retrieval + generation

def retrieve(user, query, limit=6, department_id=None):
    """Top passages from the caller's organisation's approved, indexed documents."""
    _require(retrieval=True)
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    from .models import PolicyChunk

    must = [FieldCondition(key="organization_id", match=MatchValue(value=user.organization_id))]
    if department_id:
        must.append(FieldCondition(key="department_id", match=MatchValue(value=department_id)))
    vector = embed([query], input_type="query")[0]
    hits = _qdrant().query_points(settings.QDRANT_COLLECTION, query=vector, query_filter=Filter(must=must),
                                  limit=limit * 2).points
    point_ids = [str(hit.id) for hit in hits]
    chunks = {c.point_id: c for c in PolicyChunk.objects.filter(
        point_id__in=point_ids, document__organization_id=user.organization_id, document__is_approved=True,
        document__status="PROCESSED",
    ).select_related("document")}
    ordered = [(chunks[pid], hit.score) for pid, hit in zip(point_ids, hits) if pid in chunks]
    return ordered[:limit]


def _client():
    import anthropic

    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY or None)


def _generate(system, content, max_tokens=16000):
    """One grounded Messages API call with server-side refusal fallback; returns the response."""
    import anthropic

    try:
        response = _client().beta.messages.create(
            model=settings.AI_MODEL,
            max_tokens=max_tokens,
            system=system,
            output_config={"effort": "medium"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.RateLimitError as exc:
        raise AIUnavailable("The AI service is rate limited. Try again shortly.") from exc
    except anthropic.APIStatusError as exc:
        logger.error("Claude API error %s: %s", exc.status_code, exc.message)
        raise AIUnavailable("The AI service returned an error.") from exc
    except anthropic.APIConnectionError as exc:
        raise AIUnavailable("The AI service could not be reached.") from exc
    if response.stop_reason == "refusal":
        raise AIRefused()
    return response


def answer_policy_question(user, question, department_id=None):
    _require(retrieval=True)
    passages = retrieve(user, question, department_id=department_id)
    if not passages:
        return {"answer": "No approved policy passages matched this question.", "citations": [], "sources": [],
                "disclaimer": DISCLAIMER}
    documents = [
        {
            "type": "document",
            "source": {"type": "text", "media_type": "text/plain", "data": chunk.text},
            "title": f"{chunk.document.title}" + (f" (page {chunk.page_number})" if chunk.page_number else ""),
            "citations": {"enabled": True},
        }
        for chunk, _ in passages
    ]
    system = ("You help internal auditors find what approved company policies say. Answer only from the provided "
              "policy passages and cite them. If the passages do not answer the question, say so plainly. "
              "Do not state whether anything is compliant.")
    response = _generate(system, documents + [{"type": "text", "text": question}], max_tokens=4000)

    answer_parts, citations = [], []
    for block in response.content:
        if block.type != "text":
            continue
        answer_parts.append(block.text)
        for citation in getattr(block, "citations", None) or []:
            chunk = passages[citation.document_index][0]
            citations.append({"document_id": chunk.document_id, "document_title": chunk.document.title,
                              "page": chunk.page_number, "cited_text": citation.cited_text})
    sources = [{"document_id": c.document_id, "document_title": c.document.title, "page": c.page_number,
                "score": round(score, 3), "excerpt": c.text[:400]} for c, score in passages]
    return {"answer": "".join(answer_parts).strip(), "citations": citations, "sources": sources,
            "disclaimer": DISCLAIMER}


def _finding_lines(findings):
    # Deliberately excludes people (owners, auditors) — the model does not need personal data.
    return "\n".join(
        f"- {f.reference} [{f.get_severity_display()}, risk {f.risk_score}] {f.title}: {f.description[:600]}"
        f"{' Root cause: ' + f.root_cause[:300] if f.root_cause else ''}"
        for f in findings
    ) or "- No findings recorded."


def draft_audit_summary(audit):
    _require()
    findings = audit.findings.order_by("-risk_score")[:40]
    facts = (
        f"Audit: {audit.reference} — {audit.title}\nDepartment: {audit.department.name}\n"
        f"Type: {audit.get_audit_type_display()}\nScope: {audit.scope[:1500]}\nObjectives: {audit.objectives[:1500]}\n"
        f"Checklist: {audit.total_questions} questions, {audit.compliant_count} compliant, "
        f"{audit.non_compliant_count} non-compliant, {audit.not_applicable_count} not applicable. "
        f"Recorded compliance score: {audit.compliance_score if audit.compliance_score is not None else 'n/a'}%.\n"
        f"Findings:\n{_finding_lines(findings)}"
    )
    system = ("You draft concise management summaries of internal audits for executives. Use only the facts given. "
              "Structure: overall conclusion (2-3 sentences), key risks, recommended priorities. Do not invent facts, "
              "do not change severities, and do not claim legal or certification compliance.")
    response = _generate(system, facts, max_tokens=3000)
    return {"draft": "".join(b.text for b in response.content if b.type == "text").strip(), "disclaimer": DISCLAIMER}


def draft_action_recommendation(finding):
    _require()
    facts = (
        f"Finding {finding.reference} ({finding.get_severity_display()} risk, category {finding.risk_category}) in "
        f"{finding.department.name}.\nTitle: {finding.title}\nDescription: {finding.description[:2000]}\n"
        f"Expected requirement: {finding.expected_requirement[:1000]}\nObserved condition: "
        f"{finding.observed_condition[:1000]}\nRoot cause: {finding.root_cause[:1000]}"
    )
    system = ("You draft corrective and preventive action proposals for audit findings. Propose 1-3 specific, "
              "verifiable corrective actions and 1-2 preventive actions, each with a suggested evidence of "
              "completion. Use only the facts given; keep it short.")
    response = _generate(system, facts, max_tokens=2000)
    return {"draft": "".join(b.text for b in response.content if b.type == "text").strip(), "disclaimer": DISCLAIMER}
