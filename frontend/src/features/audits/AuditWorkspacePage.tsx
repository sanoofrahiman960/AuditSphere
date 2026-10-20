import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Ban,
  ChevronDown,
  ChevronRight,
  Flag,
  Info,
  Keyboard,
  Loader2,
  MessageSquareWarning,
  Play,
  Plus,
  Save,
  Send,
  SkipForward,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { auditsApi } from "@/api/endpoints";
import { AuditStatusBadge, Badge, ComplianceBadge, OverdueBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox, Textarea } from "@/components/ui/Form";
import { FileList, FileUploadButton, ProgressBar } from "@/components/ui/Misc";
import { ConfirmDialog, ReasonDialog } from "@/components/ui/Modal";
import { ErrorState, LoadingState, Notice } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { FindingFormModal } from "@/features/findings/FindingFormModal";
import type {
  AuditDetail,
  AuditResponse,
  ChoiceValue,
  Compliance,
  Evidence,
  ResponseInput,
  ReviewComment,
  ValidationIssue,
  Workspace,
  WorkspaceQuestion,
  WorkspaceSection,
} from "@/types/api";
import { SEVERITY_LABELS, SEVERITY_TONE, formatDateTime, formatPercent, scoreColor } from "@/utils/format";
import { groupIssues, ISSUE_LABELS, extractIssues } from "./auditHelpers";
import { ReviewComments } from "./ReviewComments";

const AUTOSAVE_DELAY = 2500;
const NO_COMMENTS: ReviewComment[] = [];

const SHORTCUTS: [string, string][] = [
  ["Y", "Yes / Pass"],
  ["N", "No / Fail"],
  ["A", "Not applicable"],
  ["J / K", "Next / previous question"],
  ["U", "Next unanswered or flagged question"],
  ["?", "Show or hide these shortcuts"],
];

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

// ---------------------------------------------------------------- local answer model

type Assessment = "" | "COMPLIANT" | "NON_COMPLIANT";

interface Draft {
  choice_value: ChoiceValue;
  text_value: string;
  number_value: string;
  date_value: string;
  rating_value: number | null;
  is_not_applicable: boolean;
  manual_assessment: Assessment;
  observation: string;
  recommendation: string;
  risk_flagged: boolean;
}

interface OverallDraft {
  summary?: string;
  recommendation?: string;
}

type SavePayload = { responses?: ResponseInput[]; overall_summary?: string; overall_recommendation?: string };

function fromResponse(r: AuditResponse | null): Draft {
  return {
    choice_value: r?.choice_value ?? "",
    text_value: r?.text_value ?? "",
    number_value: r?.number_value != null && r.number_value !== "" ? String(Number(r.number_value)) : "",
    date_value: r?.date_value ?? "",
    rating_value: r?.rating_value ?? null,
    is_not_applicable: r?.is_not_applicable ?? false,
    manual_assessment: r?.manual_assessment ?? "",
    observation: r?.observation ?? "",
    recommendation: r?.recommendation ?? "",
    risk_flagged: r?.risk_flagged ?? false,
  };
}

function toInput(q: WorkspaceQuestion, d: Draft): ResponseInput {
  const input: ResponseInput = {
    question_id: q.id,
    choice_value: d.choice_value,
    text_value: d.text_value,
    number_value: d.number_value.trim() === "" ? null : d.number_value.trim(),
    date_value: d.date_value || null,
    rating_value: d.rating_value,
    is_not_applicable: d.is_not_applicable,
    observation: d.observation,
    recommendation: d.recommendation,
    risk_flagged: d.risk_flagged,
  };
  // Scored questions are evaluated automatically; the API rejects a manual judgement for them.
  if (!q.is_scored) input.manual_assessment = d.manual_assessment;
  return input;
}

function buildPayload(drafts: Record<number, Draft>, overall: OverallDraft, questions: Map<number, WorkspaceQuestion>) {
  const payload: SavePayload = {};
  const responses: ResponseInput[] = [];
  for (const [key, draft] of Object.entries(drafts)) {
    const q = questions.get(Number(key));
    if (q) responses.push(toInput(q, draft));
  }
  if (responses.length) payload.responses = responses;
  if (overall.summary !== undefined) payload.overall_summary = overall.summary;
  if (overall.recommendation !== undefined) payload.overall_recommendation = overall.recommendation;
  return payload;
}

const isEmptyPayload = (p: SavePayload) =>
  !p.responses && p.overall_summary === undefined && p.overall_recommendation === undefined;

/** Client-side mirror of apps.audits.scoring.evaluate, used for the live score of unsaved answers. */
function evaluate(q: WorkspaceQuestion, d: Draft): Compliance {
  if (d.is_not_applicable || d.choice_value === "NA") return "NOT_APPLICABLE";
  const manual = (d.manual_assessment || "INFORMATIONAL") as Compliance;
  switch (q.response_type) {
    case "YES_NO":
    case "YES_NO_NA":
      return d.choice_value === "YES" ? "COMPLIANT" : d.choice_value === "NO" ? "NON_COMPLIANT" : "UNANSWERED";
    case "PASS_FAIL":
      return d.choice_value === "PASS" ? "COMPLIANT" : d.choice_value === "FAIL" ? "NON_COMPLIANT" : "UNANSWERED";
    case "RATING":
      if (d.rating_value === null) return "UNANSWERED";
      return d.rating_value >= q.rating_pass_threshold ? "COMPLIANT" : "NON_COMPLIANT";
    case "NUMBER": {
      if (d.number_value.trim() === "") return "UNANSWERED";
      const n = Number(d.number_value);
      if (q.numeric_min !== null || q.numeric_max !== null) {
        const lowOk = q.numeric_min === null || n >= Number(q.numeric_min);
        const highOk = q.numeric_max === null || n <= Number(q.numeric_max);
        return lowOk && highOk ? "COMPLIANT" : "NON_COMPLIANT";
      }
      return manual;
    }
    case "TEXT":
      return d.text_value.trim() ? manual : "UNANSWERED";
    case "DATE":
      return d.date_value ? manual : "UNANSWERED";
    default:
      return "UNANSWERED";
  }
}

function readOnlyReason(audit: AuditDetail): string {
  switch (audit.status) {
    case "DRAFT":
      return "This audit is still a draft. It must be scheduled and started before responses can be recorded.";
    case "SCHEDULED":
      return audit.permissions.can_start
        ? "This audit has not been started yet. Start it to begin recording responses."
        : "This audit has not been started yet. The audit team starts it when fieldwork begins.";
    case "SUBMITTED":
      return `This audit was submitted for review${audit.submitted_at ? ` on ${formatDateTime(audit.submitted_at)}` : ""}. The checklist is read-only while the reviewer assesses it.`;
    case "APPROVED":
      return "This audit has been approved. The checklist is locked.";
    case "COMPLETED":
      return "This audit is completed. The checklist is locked.";
    case "CANCELLED":
      return "This audit was cancelled. The checklist is locked.";
    default:
      return "Only the assigned audit team can record responses. You are viewing the checklist read-only.";
  }
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------- page

export default function AuditWorkspacePage() {
  const { id } = useParams();
  const auditId = Number(id);
  const query = useQuery({
    queryKey: ["workspace", auditId],
    queryFn: () => auditsApi.workspace(auditId),
    enabled: !!auditId,
  });

  if (query.isLoading) return <LoadingState label="Loading checklist…" />;
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <WorkspaceView key={auditId} auditId={auditId} ws={query.data} />;
}

function WorkspaceView({ auditId, ws }: { auditId: number; ws: Workspace }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, can } = useAuth();

  const audit = ws.audit;
  const p = audit.permissions;
  const canExecute = p.can_execute;
  const weighted = ws.template_version.scoring_method === "WEIGHTED";
  const issues = ws.issues;

  const questions = useMemo(() => ws.sections.flatMap((s) => s.questions), [ws.sections]);
  const questionById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const baseDrafts = useMemo(() => {
    const map: Record<number, Draft> = {};
    for (const q of questions) map[q.id] = fromResponse(q.response);
    return map;
  }, [questions]);

  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [overall, setOverall] = useState<OverallDraft>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveTick, setSaveTick] = useState(0);
  const [showIssues, setShowIssues] = useState(true);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [findingFor, setFindingFor] = useState<WorkspaceQuestion | null>(null);
  const [evidenceToDelete, setEvidenceToDelete] = useState<Evidence | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [sectionNaFor, setSectionNaFor] = useState<WorkspaceSection | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Refs give stable callbacks (and the unmount flush) access to the latest state.
  const draftsRef = useRef(drafts);
  const overallRef = useRef(overall);
  const baseRef = useRef(baseDrafts);
  const questionsRef = useRef(questionById);
  const canExecuteRef = useRef(canExecute);
  const inflightRef = useRef<Promise<Workspace> | null>(null);
  draftsRef.current = drafts;
  overallRef.current = overall;
  baseRef.current = baseDrafts;
  questionsRef.current = questionById;
  canExecuteRef.current = canExecute;

  const dirtyCount =
    Object.keys(drafts).length + (overall.summary !== undefined ? 1 : 0) + (overall.recommendation !== undefined ? 1 : 0);
  const dirty = dirtyCount > 0;

  const applyWorkspace = useCallback(
    (data: Workspace) => {
      queryClient.setQueryData(["workspace", auditId], data);
      queryClient.setQueryData(["audit", auditId], data.audit);
      queryClient.invalidateQueries({ queryKey: ["audits"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["audit-history", auditId] });
    },
    [auditId, queryClient],
  );

  /** Save every dirty answer (and the overall texts). Resolves with the refreshed workspace, or null if nothing to save. */
  const flush = useCallback(async (): Promise<Workspace | null> => {
    while (inflightRef.current) {
      try {
        await inflightRef.current;
      } catch {
        /* reported by the call that started it */
      }
    }
    const sentDrafts = draftsRef.current;
    const sentOverall = overallRef.current;
    const payload = buildPayload(sentDrafts, sentOverall, questionsRef.current);
    if (isEmptyPayload(payload)) return null;

    setSaveState("saving");
    const request = auditsApi.saveResponses(auditId, payload);
    inflightRef.current = request;
    try {
      const data = await request;
      applyWorkspace(data);
      // Drop what was saved but keep answers edited while the request was in flight.
      const pruneDrafts = (prev: Record<number, Draft>) => {
        const next = { ...prev };
        for (const [key, draft] of Object.entries(sentDrafts)) {
          if (next[Number(key)] === draft) delete next[Number(key)];
        }
        return next;
      };
      const pruneOverall = (prev: OverallDraft): OverallDraft => ({
        summary: prev.summary === sentOverall.summary ? undefined : prev.summary,
        recommendation: prev.recommendation === sentOverall.recommendation ? undefined : prev.recommendation,
      });
      // Refs are updated now (not on the next render) so an immediate navigation does not re-send them.
      draftsRef.current = pruneDrafts(draftsRef.current);
      overallRef.current = pruneOverall(overallRef.current);
      setDrafts(pruneDrafts);
      setOverall(pruneOverall);
      setSaveState("idle");
      setLastSavedAt(new Date());
      setSaveTick((t) => t + 1);
      return data;
    } catch (err) {
      setSaveState("error");
      throw err;
    } finally {
      inflightRef.current = null;
    }
  }, [auditId, applyWorkspace]);

  const saveNow = useCallback(() => {
    flush()
      .then((data) => data && toast.success("Draft saved"))
      .catch((err) => toast.error(err));
  }, [flush, toast]);

  // Debounced autosave after the last change.
  useEffect(() => {
    if (!dirty || !canExecute || saveState !== "idle") return;
    const timer = setTimeout(() => {
      flush().catch((err) => toast.error(err));
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [drafts, overall, saveTick, saveState, dirty, canExecute, flush, toast]);

  // Warn before closing the tab with unsaved work.
  useEffect(() => {
    if (!dirty && saveState !== "saving") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, saveState]);

  // In-app navigation unmounts the page: save whatever is still pending.
  useEffect(
    () => () => {
      if (!canExecuteRef.current) return;
      const payload = buildPayload(draftsRef.current, overallRef.current, questionsRef.current);
      if (isEmptyPayload(payload)) return;
      auditsApi
        .saveResponses(auditId, payload)
        .then((data) => {
          queryClient.setQueryData(["workspace", auditId], data);
          queryClient.setQueryData(["audit", auditId], data.audit);
          queryClient.invalidateQueries({ queryKey: ["audits"] });
        })
        .catch((err) => toast.error(err));
    },
    [auditId, queryClient, toast],
  );

  const updateDraft = useCallback((questionId: number, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [questionId]: { ...(prev[questionId] ?? baseRef.current[questionId]), ...patch } }));
    setSaveState((s) => (s === "error" ? "idle" : s));
  }, []);

  const updateOverall = (patch: OverallDraft) => {
    setOverall((prev) => ({ ...prev, ...patch }));
    setSaveState((s) => (s === "error" ? "idle" : s));
  };

  const scrollToQuestion = useCallback((questionId: number) => {
    setFocusedId(questionId);
    document.getElementById(`q-${questionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Deep link from the detail page (#q-123).
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current) return;
    const match = /^#q-(\d+)$/.exec(location.hash);
    if (!match) return;
    scrolledRef.current = true;
    const target = Number(match[1]);
    requestAnimationFrame(() => scrollToQuestion(target));
  }, [location.hash, scrollToQuestion]);

  // ---- derived figures (include unsaved answers)
  const localCompliance = useMemo(() => {
    const map = new Map<number, Compliance>();
    for (const q of questions) {
      const draft = drafts[q.id];
      map.set(q.id, draft ? evaluate(q, draft) : q.response?.compliance ?? "UNANSWERED");
    }
    return map;
  }, [questions, drafts]);

  const stats = useMemo(() => {
    let answered = 0;
    let numerator = 0;
    let denominator = 0;
    for (const q of questions) {
      const c = localCompliance.get(q.id) ?? "UNANSWERED";
      if (c === "UNANSWERED") continue;
      answered += 1;
      const weight = weighted ? Number(q.weight) || 0 : 1;
      if (c === "COMPLIANT") {
        numerator += weight;
        denominator += weight;
      } else if (c === "NON_COMPLIANT") {
        denominator += weight;
      }
    }
    const total = questions.length;
    return {
      answered,
      total,
      completion: total ? Math.round((answered * 100) / total) : 0,
      score: denominator ? (numerator * 100) / denominator : null,
    };
  }, [questions, localCompliance, weighted]);

  const issuesByQuestion = useMemo(() => {
    const map = new Map<number, ValidationIssue[]>();
    for (const issue of issues) {
      if (issue.question_id === null) continue; // audit-level review comment, shown in its own block
      const list = map.get(issue.question_id) ?? [];
      list.push(issue);
      map.set(issue.question_id, list);
    }
    return map;
  }, [issues]);

  // ---- review comments
  const { commentsByQuestion, generalComments } = useMemo(() => {
    const map = new Map<number, ReviewComment[]>();
    const general: ReviewComment[] = [];
    for (const c of ws.review_comments ?? []) {
      if (c.question === null) general.push(c);
      else map.set(c.question, [...(map.get(c.question) ?? []), c]);
    }
    return { commentsByQuestion: map, generalComments: general };
  }, [ws.review_comments]);
  const openCommentCount = (ws.review_comments ?? []).filter((c) => !c.is_resolved).length;

  const addComment = useCallback(
    async (questionId: number | null, body: string) => {
      try {
        await auditsApi.addReviewComment(auditId, body, questionId);
        queryClient.invalidateQueries({ queryKey: ["audit-review-comments", auditId] });
        await queryClient.invalidateQueries({ queryKey: ["workspace", auditId] });
        toast.success("Review comment added");
      } catch (err) {
        toast.error(err);
        throw err;
      }
    },
    [auditId, queryClient, toast],
  );

  const resolveComment = useCallback(
    async (comment: ReviewComment, note: string) => {
      try {
        await auditsApi.resolveReviewComment(auditId, comment.id, note);
        queryClient.invalidateQueries({ queryKey: ["audit-review-comments", auditId] });
        await queryClient.invalidateQueries({ queryKey: ["workspace", auditId] });
        queryClient.invalidateQueries({ queryKey: ["audit-history", auditId] });
        toast.success("Comment resolved");
      } catch (err) {
        toast.error(err);
        throw err;
      }
    },
    [auditId, queryClient, toast],
  );

  // ---- keyboard-first navigation
  const pendingIds = useMemo(
    () =>
      new Set(
        questions
          .filter((q) => (localCompliance.get(q.id) ?? "UNANSWERED") === "UNANSWERED" || issuesByQuestion.has(q.id))
          .map((q) => q.id),
      ),
    [questions, localCompliance, issuesByQuestion],
  );

  const goToNextPending = useCallback(() => {
    if (!pendingIds.size) return;
    const start = focusedId ? questions.findIndex((q) => q.id === focusedId) : -1;
    const after = questions.slice(start + 1).find((q) => pendingIds.has(q.id));
    const target = after ?? questions.find((q) => pendingIds.has(q.id));
    if (target) scrollToQuestion(target.id);
  }, [pendingIds, focusedId, questions, scrollToQuestion]);

  const answerFocused = useCallback(
    (key: "y" | "n" | "a") => {
      const q = focusedId ? questionById.get(focusedId) : undefined;
      if (!q || !canExecute) return;
      const isPassFail = q.response_type === "PASS_FAIL";
      const isYesNo = q.response_type === "YES_NO" || q.response_type === "YES_NO_NA";
      if (key === "a") {
        if (q.response_type === "YES_NO_NA") updateDraft(q.id, { choice_value: "NA" });
        else updateDraft(q.id, { is_not_applicable: !(draftsRef.current[q.id] ?? baseRef.current[q.id]).is_not_applicable });
      } else if (isYesNo || isPassFail) {
        const value: ChoiceValue = key === "y" ? (isPassFail ? "PASS" : "YES") : isPassFail ? "FAIL" : "NO";
        updateDraft(q.id, { choice_value: value, is_not_applicable: false });
      }
    },
    [focusedId, questionById, canExecute, updateDraft],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const key = e.key.toLowerCase();
      const index = focusedId ? questions.findIndex((q) => q.id === focusedId) : -1;
      if (key === "j" || key === "k") {
        const next = questions[key === "j" ? Math.min(index + 1, questions.length - 1) : Math.max(index - 1, 0)];
        if (next) scrollToQuestion(next.id);
      } else if (key === "u") {
        goToNextPending();
      } else if (key === "y" || key === "n" || key === "a") {
        answerFocused(key);
      } else if (e.key === "?") {
        setShowShortcuts((s) => !s);
      } else {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focusedId, questions, scrollToQuestion, goToNextPending, answerFocused]);

  // ---- mark a whole section not applicable
  const markSectionNotApplicable = (section: WorkspaceSection, justification: string) => {
    for (const q of section.questions) {
      const current = draftsRef.current[q.id] ?? baseRef.current[q.id];
      const patch: Partial<Draft> =
        q.response_type === "YES_NO_NA" ? { choice_value: "NA", is_not_applicable: false } : { is_not_applicable: true };
      updateDraft(q.id, { ...patch, observation: current.observation || `Not applicable: ${justification}` });
    }
    setSectionNaFor(null);
    toast.success(`${section.questions.length} question(s) marked not applicable — saving…`);
  };

  const sectionStats = useMemo(
    () =>
      ws.sections.map((s) => ({
        id: s.id,
        title: s.title,
        total: s.questions.length,
        answered: s.questions.filter((q) => (localCompliance.get(q.id) ?? "UNANSWERED") !== "UNANSWERED").length,
        issues: s.questions.reduce((n, q) => n + (issuesByQuestion.get(q.id)?.length ?? 0), 0),
      })),
    [ws.sections, localCompliance, issuesByQuestion],
  );

  // ---- evidence
  const editableStatus = audit.status === "IN_PROGRESS" || audit.status === "REWORK_REQUIRED";
  const canDeleteEvidence = useCallback(
    (ev: Evidence) => editableStatus && (ev.uploaded_by?.id === user?.id || can("manage_audits")),
    [editableStatus, user?.id, can],
  );

  const uploadEvidence = useCallback(
    async (q: WorkspaceQuestion, file: File) => {
      let responseId = questionsRef.current.get(q.id)?.response?.id ?? null;
      if (!responseId && draftsRef.current[q.id]) {
        const data = (await flush()) ?? queryClient.getQueryData<Workspace>(["workspace", auditId]);
        responseId = data?.sections.flatMap((s) => s.questions).find((x) => x.id === q.id)?.response?.id ?? null;
      }
      if (!responseId) throw new Error("Answer this question before attaching evidence.");
      await auditsApi.uploadEvidence(auditId, file, { response_id: responseId });
      queryClient.invalidateQueries({ queryKey: ["audit-evidence", auditId] });
      await queryClient.invalidateQueries({ queryKey: ["workspace", auditId] });
    },
    [auditId, flush, queryClient],
  );

  const removeEvidence = useMutation({
    mutationFn: (ev: Evidence) => auditsApi.deleteEvidence(ev.id),
    onSuccess: () => {
      toast.success("Evidence removed");
      setEvidenceToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["workspace", auditId] });
      queryClient.invalidateQueries({ queryKey: ["audit-evidence", auditId] });
    },
    onError: (err) => toast.error(err),
  });

  const requestEvidenceDelete = useCallback(
    (ev: Evidence) => {
      if (canDeleteEvidence(ev)) setEvidenceToDelete(ev);
      else toast.info("Only the uploader or an audit administrator can remove this file while the audit is in progress.");
    },
    [canDeleteEvidence, toast],
  );

  // ---- findings (stable question object so the modal does not reset while open)
  const findingQuestion = useMemo(
    () =>
      findingFor
        ? {
            id: findingFor.id,
            code: findingFor.code,
            text: findingFor.text,
            guidance: findingFor.guidance,
            risk_category: findingFor.risk_category,
          }
        : null,
    [findingFor],
  );

  // ---- transitions
  const submit = useMutation({
    mutationFn: async () => {
      const saved = await flush();
      if (saved && saved.issues.length) {
        throw new Error(`Resolve ${saved.issues.length} validation issue(s) before submitting.`);
      }
      return auditsApi.submit(auditId);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["audit", auditId], updated);
      for (const key of [["workspace", auditId], ["audits"], ["dashboard"], ["audit-history", auditId]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(`Audit ${updated.reference} submitted for review`);
      navigate(`/audits/${auditId}`);
    },
    onError: (err) => {
      setConfirmSubmit(false);
      setShowIssues(true);
      const found = extractIssues(err);
      if (found) {
        toast.error(`The checklist is incomplete (${found.length} issue${found.length === 1 ? "" : "s"}).`);
        queryClient.invalidateQueries({ queryKey: ["workspace", auditId] });
      } else {
        toast.error(err);
      }
    },
  });

  const start = useMutation({
    mutationFn: () => auditsApi.start(auditId),
    onSuccess: (updated) => {
      queryClient.setQueryData(["audit", auditId], updated);
      queryClient.invalidateQueries({ queryKey: ["workspace", auditId] });
      queryClient.invalidateQueries({ queryKey: ["audits"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setConfirmStart(false);
      toast.success(updated.status === "IN_PROGRESS" ? "Audit in progress — you can record responses" : "Audit started");
    },
    onError: (err) => {
      setConfirmStart(false);
      toast.error(err);
      queryClient.invalidateQueries({ queryKey: ["workspace", auditId] });
    },
  });

  const backToAudit = async () => {
    if (dirty && canExecute) {
      try {
        await flush();
      } catch (err) {
        toast.error(err);
        return;
      }
    }
    navigate(`/audits/${auditId}`);
  };

  const submitBlocked = issues.length > 0;
  const busySaving = saveState === "saving";
  const overallSummary = overall.summary ?? audit.overall_summary;
  const overallRecommendation = overall.recommendation ?? audit.overall_recommendation;

  return (
    <>
      {/* ---- sticky summary bar */}
      <div className="sticky top-16 z-20 -mx-4 -mt-6 mb-6 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/audits/${auditId}`} className="link font-mono text-sm">
                {audit.reference}
              </Link>
              <AuditStatusBadge status={audit.status} />
              {audit.is_overdue && <OverdueBadge />}
            </div>
            <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg" title={audit.title}>
              {audit.title}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canExecute && (
              <SaveIndicator state={saveState} dirty={dirty} lastSavedAt={lastSavedAt} onRetry={saveNow} />
            )}
            {canExecute && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Save className="h-4 w-4" />}
                onClick={saveNow}
                disabled={!dirty || busySaving}
              >
                Save draft
              </Button>
            )}
            {p.can_submit && (
              <span title={submitBlocked ? `Resolve ${issues.length} validation issue(s) before submitting` : undefined}>
                <Button
                  size="sm"
                  icon={<Send className="h-4 w-4" />}
                  onClick={() => setConfirmSubmit(true)}
                  disabled={submitBlocked || busySaving}
                >
                  Submit for review
                </Button>
              </span>
            )}
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => void backToAudit()}>
              Back to audit
            </Button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Answered</span>
            <span className="font-medium tabular-nums text-slate-800">
              {stats.answered}/{stats.total}
            </span>
            <ProgressBar
              value={stats.completion}
              className="w-24 sm:w-36"
              tone={stats.completion === 100 ? "green" : "brand"}
            />
            <span className="tabular-nums text-slate-500">{stats.completion}%</span>
          </div>
          <div className="flex items-center gap-2" title="Live score, including unsaved answers">
            <span className="text-slate-500">Score</span>
            <span className={clsx("font-semibold tabular-nums", scoreColor(stats.score))}>{formatPercent(stats.score)}</span>
            <span className="text-xs text-slate-400">{weighted ? "weighted" : "simple"}</span>
          </div>
          {editableStatus && (
            <button
              type="button"
              onClick={() => setShowIssues((s) => !s)}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm font-medium",
                issues.length ? "bg-amber-50 text-amber-800 hover:bg-amber-100" : "text-green-700",
              )}
              aria-expanded={showIssues}
              aria-controls="validation-issues"
            >
              {issues.length ? <AlertTriangle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {issues.length ? `${issues.length} validation issue${issues.length === 1 ? "" : "s"}` : "No validation issues"}
            </button>
          )}
          {openCommentCount > 0 && (
            <button
              type="button"
              onClick={() => scrollToId("review-comments")}
              className="inline-flex items-center gap-1.5 rounded-md bg-purple-50 px-2 py-0.5 text-sm font-medium text-purple-800 hover:bg-purple-100"
            >
              <MessageSquareWarning className="h-4 w-4" aria-hidden />
              {openCommentCount} open review comment{openCommentCount === 1 ? "" : "s"}
            </button>
          )}
          <div className="ml-auto flex items-center gap-1">
            {canExecute && pendingIds.size > 0 && (
              <Button variant="secondary" size="sm" icon={<SkipForward className="h-4 w-4" />} onClick={goToNextPending}>
                Next to answer ({pendingIds.size})
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="hidden md:inline-flex"
              icon={<Keyboard className="h-4 w-4" />}
              onClick={() => setShowShortcuts((s) => !s)}
              aria-expanded={showShortcuts}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            />
          </div>
        </div>
        {showShortcuts && (
          <div className="mt-2 hidden flex-wrap gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 md:flex">
            {SHORTCUTS.map(([keys, label]) => (
              <span key={keys}>
                <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                  {keys}
                </kbd>{" "}
                {label}
              </span>
            ))}
            <span className="text-slate-400">Click a question to select it; answers apply to the selected question.</span>
          </div>
        )}
      </div>

      {/* ---- notices */}
      <div className="mb-6 space-y-3">
        {!canExecute && (
          <Notice tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{readOnlyReason(audit)}</span>
              {p.can_start && (
                <Button size="sm" icon={<Play className="h-4 w-4" />} onClick={() => setConfirmStart(true)}>
                  {audit.status === "REWORK_REQUIRED" ? "Resume audit" : "Start audit"}
                </Button>
              )}
            </div>
          </Notice>
        )}
        {canExecute && audit.status === "REWORK_REQUIRED" && (
          <Notice tone="warning">
            The reviewer requested rework. Saving a change or resolving a review comment resumes the audit; resubmit once
            every comment is resolved. See the{" "}
            <button type="button" onClick={() => scrollToId("review-comments")} className="font-medium underline">
              review comments
            </button>{" "}
            and the decision history on the{" "}
            <Link to={`/audits/${auditId}?tab=review`} className="font-medium underline">
              audit page
            </Link>
            .
          </Notice>
        )}
        {p.can_add_review_comments && (
          <Notice>
            You are reviewing this audit. Add comments on individual questions (or for the audit as a whole), then approve
            or request rework from the{" "}
            <Link to={`/audits/${auditId}`} className="font-medium underline">
              audit page
            </Link>
            . The audit team must resolve every comment before resubmitting.
          </Notice>
        )}
        {editableStatus && issues.length > 0 && showIssues && (
          <IssuesPanel
            issues={issues}
            onSelect={(questionId) => (questionId === null ? scrollToId("review-comments") : scrollToQuestion(questionId))}
            canSubmit={p.can_submit}
          />
        )}
        {(ws.review_comments?.length > 0 || p.can_add_review_comments) && (
          <section id="review-comments" className="card scroll-mt-48 p-4" aria-label="Review comments">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Review comments</h2>
              <span className="text-xs text-slate-500">
                {openCommentCount} open · {(ws.review_comments?.length ?? 0) - openCommentCount} resolved
                {ws.review_comments?.length ? " · question comments appear on each question" : ""}
              </span>
            </div>
            <ReviewComments
              compact
              comments={generalComments}
              canAdd={p.can_add_review_comments}
              canResolve={p.can_resolve_review_comments}
              onAdd={(body) => addComment(null, body)}
              onResolve={resolveComment}
            />
            {!generalComments.length && !p.can_add_review_comments && (
              <p className="text-sm text-slate-500">No audit-level comments.</p>
            )}
          </section>
        )}
      </div>

      {/* ---- checklist */}
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6">
        <nav className="hidden lg:block" aria-label="Checklist sections">
          <div className="sticky top-48 max-h-[calc(100vh-13rem)] overflow-y-auto">
            <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sections</p>
            <ul className="space-y-0.5">
              {sectionStats.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => scrollToId(`section-${s.id}`)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-white hover:shadow-card"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {i + 1}. {s.title}
                      </span>
                      <span className={clsx("text-xs tabular-nums", s.answered === s.total ? "text-green-700" : "text-slate-500")}>
                        {s.answered}/{s.total} answered
                      </span>
                    </span>
                    {s.issues > 0 && (
                      <span
                        className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 text-xs font-medium text-amber-800"
                        title={`${s.issues} validation issue(s)`}
                      >
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {s.issues}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="min-w-0 space-y-8">
          {ws.sections.length > 1 && (
            <div className="lg:hidden">
              <label htmlFor="section-jump" className="label">
                Jump to section
              </label>
              <select
                id="section-jump"
                className="input"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) scrollToId(`section-${e.target.value}`);
                  e.target.value = "";
                }}
              >
                <option value="">Select a section…</option>
                {sectionStats.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    {i + 1}. {s.title} ({s.answered}/{s.total}
                    {s.issues ? `, ${s.issues} issue${s.issues === 1 ? "" : "s"}` : ""})
                  </option>
                ))}
              </select>
            </div>
          )}

          {ws.sections.map((section, i) => {
            const st = sectionStats[i];
            return (
              <section key={section.id} id={`section-${section.id}`} className="scroll-mt-48" aria-labelledby={`section-title-${section.id}`}>
                <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div className="min-w-0">
                    <h2 id={`section-title-${section.id}`} className="text-base font-semibold text-slate-900">
                      {i + 1}. {section.title}
                    </h2>
                    {section.description && <p className="mt-0.5 text-sm text-slate-500">{section.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-slate-500">
                      {st.answered}/{st.total} answered
                    </span>
                    {canExecute && section.questions.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Ban className="h-4 w-4" />}
                        onClick={() => setSectionNaFor(section)}
                      >
                        Mark section N/A
                      </Button>
                    )}
                  </div>
                </header>
                <div className="space-y-4">
                  {section.questions.map((q) => (
                    <QuestionCard
                      key={q.id}
                      question={q}
                      value={drafts[q.id] ?? baseDrafts[q.id]}
                      dirty={!!drafts[q.id]}
                      issues={issuesByQuestion.get(q.id)}
                      weighted={weighted}
                      readOnly={!canExecute}
                      focused={focusedId === q.id}
                      auditId={auditId}
                      canRaiseFinding={p.can_raise_findings}
                      canUpload={p.can_upload_evidence}
                      canSaveAnswers={canExecute}
                      canDeleteEvidence={canDeleteEvidence}
                      comments={commentsByQuestion.get(q.id) ?? NO_COMMENTS}
                      canAddComment={p.can_add_review_comments}
                      canResolveComment={p.can_resolve_review_comments}
                      onAddComment={addComment}
                      onResolveComment={resolveComment}
                      onFocusQuestion={setFocusedId}
                      onChange={updateDraft}
                      onRecordFinding={setFindingFor}
                      onUpload={uploadEvidence}
                      onDeleteEvidence={requestEvidenceDelete}
                    />
                  ))}
                  {section.questions.length === 0 && (
                    <p className="text-sm text-slate-500">This section has no questions.</p>
                  )}
                </div>
              </section>
            );
          })}

          <Card title="Overall summary & recommendation" description="Saved with the checklist; shown to the reviewer and in reports.">
            <div className="grid gap-4 md:grid-cols-2">
              <Textarea
                label="Overall summary"
                rows={5}
                value={overallSummary}
                disabled={!canExecute}
                placeholder="Key observations and the overall control environment…"
                onChange={(e) => updateOverall({ summary: e.target.value })}
              />
              <Textarea
                label="Overall recommendation"
                rows={5}
                value={overallRecommendation}
                disabled={!canExecute}
                placeholder="Priority improvements for management…"
                onChange={(e) => updateOverall({ recommendation: e.target.value })}
              />
            </div>
          </Card>

          <details className="card group px-5 py-4 text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-slate-800">
              <Info className="h-4 w-4 text-slate-400" aria-hidden />
              How the score is calculated
              <ChevronDown className="ml-auto h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <p className="mt-3 leading-relaxed text-slate-600">{ws.scoring_explanation}</p>
            <p className="mt-2 text-xs text-slate-500">
              Template: {ws.template_version.name} v{ws.template_version.version}
              {ws.template_version.applicable_standard ? ` · ${ws.template_version.applicable_standard}` : ""} ·{" "}
              {weighted ? "weighted scoring (question weights apply)" : "simple scoring (every question weighs 1)"}.
            </p>
          </details>
        </div>
      </div>

      {/* ---- dialogs */}
      <FindingFormModal
        open={!!findingFor}
        onClose={() => setFindingFor(null)}
        auditId={auditId}
        question={findingQuestion}
      />
      <ConfirmDialog
        open={!!evidenceToDelete}
        onClose={() => setEvidenceToDelete(null)}
        onConfirm={() => evidenceToDelete && removeEvidence.mutate(evidenceToDelete)}
        loading={removeEvidence.isPending}
        tone="danger"
        title="Remove evidence"
        confirmLabel="Remove"
        message={
          <>
            Remove <strong>{evidenceToDelete?.original_name}</strong>? The removal is recorded in the audit history.
          </>
        }
      />
      <ConfirmDialog
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        onConfirm={() => submit.mutate()}
        loading={submit.isPending}
        title="Submit for review"
        confirmLabel="Submit"
        message={
          <>
            {dirty && <p className="mb-2">Your unsaved changes will be saved first.</p>}
            <p>
              The checklist becomes read-only and {audit.reviewer?.full_name ?? "the reviewer"} is asked to review it.
              Current score: <strong>{formatPercent(stats.score)}</strong>.
            </p>
          </>
        }
      />
      <ReasonDialog
        open={!!sectionNaFor}
        onClose={() => setSectionNaFor(null)}
        onSubmit={(reason) => sectionNaFor && markSectionNotApplicable(sectionNaFor, reason)}
        title={`Mark "${sectionNaFor?.title ?? ""}" not applicable`}
        message={`All ${sectionNaFor?.questions.length ?? 0} question(s) in this section are marked N/A and excluded from the score. The justification is recorded as the observation where none exists.`}
        label="Justification"
        confirmLabel="Mark not applicable"
      />
      <ConfirmDialog
        open={confirmStart}
        onClose={() => setConfirmStart(false)}
        onConfirm={() => start.mutate()}
        loading={start.isPending}
        title={audit.status === "REWORK_REQUIRED" ? "Resume audit" : "Start audit"}
        confirmLabel={audit.status === "REWORK_REQUIRED" ? "Resume" : "Start"}
        message="The audit moves to In Progress and you can begin recording responses."
      />
    </>
  );
}

// ---------------------------------------------------------------- pieces

function SaveIndicator({
  state,
  dirty,
  lastSavedAt,
  onRetry,
}: {
  state: "idle" | "saving" | "error";
  dirty: boolean;
  lastSavedAt: Date | null;
  onRetry: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" aria-live="polite">
      {state === "saving" ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" aria-hidden />
          <span className="text-slate-600">Saving…</span>
        </>
      ) : state === "error" ? (
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-medium text-red-600 hover:underline">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Save failed · Retry
        </button>
      ) : dirty ? (
        <>
          <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
          <span className="text-amber-700">Unsaved changes</span>
        </>
      ) : lastSavedAt ? (
        <>
          <Check className="h-3.5 w-3.5 text-green-600" aria-hidden />
          <span className="text-slate-500">Saved · {format(lastSavedAt, "HH:mm")}</span>
        </>
      ) : (
        <>
          <Check className="h-3.5 w-3.5 text-green-600" aria-hidden />
          <span className="text-slate-500">All changes saved</span>
        </>
      )}
    </span>
  );
}

function IssuesPanel({
  issues,
  onSelect,
  canSubmit,
}: {
  issues: ValidationIssue[];
  onSelect: (questionId: number | null) => void;
  canSubmit: boolean;
}) {
  return (
    <section id="validation-issues" className="rounded-xl border border-amber-200 bg-amber-50/60 p-4" aria-label="Validation issues">
      <div className="mb-3 flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-amber-900">
            {issues.length} issue{issues.length === 1 ? "" : "s"} to resolve
          </p>
          <p className="text-xs text-amber-800">
            {canSubmit
              ? "Submission is blocked until these are resolved. Issues refresh each time the checklist is saved."
              : "These must be resolved before the audit can be submitted. Issues refresh each time the checklist is saved."}
          </p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {groupIssues(issues).map(([code, list]) => (
          <div key={code}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
              {ISSUE_LABELS[code] ?? code} ({list.length})
            </h3>
            <ul className="space-y-0.5">
              {list.map((issue, i) => (
                <li key={`${issue.question_id}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(issue.question_id)}
                    className="text-left text-sm text-amber-900 underline-offset-2 hover:underline"
                  >
                    {issue.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

const CHOICES: Partial<Record<WorkspaceQuestion["response_type"], { value: ChoiceValue; label: string; tone: "good" | "bad" | "neutral" }[]>> = {
  YES_NO: [
    { value: "YES", label: "Yes", tone: "good" },
    { value: "NO", label: "No", tone: "bad" },
  ],
  YES_NO_NA: [
    { value: "YES", label: "Yes", tone: "good" },
    { value: "NO", label: "No", tone: "bad" },
    { value: "NA", label: "N/A", tone: "neutral" },
  ],
  PASS_FAIL: [
    { value: "PASS", label: "Pass", tone: "good" },
    { value: "FAIL", label: "Fail", tone: "bad" },
  ],
};

const SELECTED_TONE = {
  good: "border-green-600 bg-green-600 text-white",
  bad: "border-red-600 bg-red-600 text-white",
  neutral: "border-slate-600 bg-slate-600 text-white",
  brand: "border-brand-600 bg-brand-600 text-white",
};

function Segment({
  selected,
  tone,
  disabled,
  onClick,
  children,
  label,
}: {
  selected: boolean;
  tone: keyof typeof SELECTED_TONE;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "min-w-[3rem] rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        selected ? SELECTED_TONE[tone] : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400",
        disabled && selected && "opacity-70",
      )}
    >
      {children}
    </button>
  );
}

interface QuestionCardProps {
  question: WorkspaceQuestion;
  value: Draft;
  dirty: boolean;
  issues?: ValidationIssue[];
  weighted: boolean;
  readOnly: boolean;
  focused: boolean;
  auditId: number;
  canRaiseFinding: boolean;
  canUpload: boolean;
  canSaveAnswers: boolean;
  canDeleteEvidence: (ev: Evidence) => boolean;
  comments: ReviewComment[];
  canAddComment: boolean;
  canResolveComment: boolean;
  onAddComment: (questionId: number, body: string) => Promise<unknown>;
  onResolveComment: (comment: ReviewComment, note: string) => Promise<unknown>;
  onFocusQuestion: (questionId: number) => void;
  onChange: (questionId: number, patch: Partial<Draft>) => void;
  onRecordFinding: (q: WorkspaceQuestion) => void;
  onUpload: (q: WorkspaceQuestion, file: File) => Promise<void>;
  onDeleteEvidence: (ev: Evidence) => void;
}

const QuestionCard = memo(function QuestionCard({
  question: q,
  value,
  dirty,
  issues,
  weighted,
  readOnly,
  focused,
  auditId,
  canRaiseFinding,
  canUpload,
  canSaveAnswers,
  canDeleteEvidence,
  comments,
  canAddComment,
  canResolveComment,
  onAddComment,
  onResolveComment,
  onFocusQuestion,
  onChange,
  onRecordFinding,
  onUpload,
  onDeleteEvidence,
}: QuestionCardProps) {
  const hasOpenComment = comments.some((c) => !c.is_resolved);
  const [showGuidance, setShowGuidance] = useState(false);
  const set = (patch: Partial<Draft>) => onChange(q.id, patch);
  const na = value.is_not_applicable;
  const answerDisabled = readOnly || na;
  const saved = q.response;
  const compliance: Compliance = saved?.compliance ?? "UNANSWERED";
  const evidence = saved?.evidence ?? [];
  const anyDeletable = evidence.some(canDeleteEvidence);
  const uploadPossible = canUpload && (!!saved || (canSaveAnswers && dirty));
  const inputId = `answer-${q.id}`;

  const numericHint =
    q.numeric_min !== null && q.numeric_max !== null
      ? `Compliant range: ${Number(q.numeric_min)} – ${Number(q.numeric_max)}`
      : q.numeric_min !== null
        ? `Compliant when ≥ ${Number(q.numeric_min)}`
        : q.numeric_max !== null
          ? `Compliant when ≤ ${Number(q.numeric_max)}`
          : "Informational value — record an assessment below if needed.";

  let control: ReactNode;
  const choices = CHOICES[q.response_type];
  if (choices) {
    control = (
      <div role="group" aria-label="Answer" className="flex flex-wrap gap-2">
        {choices.map((c) => (
          <Segment
            key={c.value}
            selected={value.choice_value === c.value}
            tone={c.tone}
            disabled={readOnly || (na && c.value !== "NA")}
            onClick={() => set({ choice_value: value.choice_value === c.value ? "" : c.value })}
          >
            {c.label}
          </Segment>
        ))}
      </div>
    );
  } else if (q.response_type === "RATING") {
    control = (
      <div>
        <div role="group" aria-label={`Rating from 1 to ${q.rating_max}`} className="flex flex-wrap gap-1.5">
          {Array.from({ length: q.rating_max }, (_, i) => i + 1).map((n) => (
            <Segment
              key={n}
              selected={value.rating_value === n}
              tone={n >= q.rating_pass_threshold ? "good" : "bad"}
              disabled={answerDisabled}
              label={`Rating ${n}`}
              onClick={() => set({ rating_value: value.rating_value === n ? null : n })}
            >
              {n}
            </Segment>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Pass mark: {q.rating_pass_threshold} or higher (scale 1–{q.rating_max}).
        </p>
      </div>
    );
  } else if (q.response_type === "NUMBER") {
    control = (
      <div className="max-w-xs">
        <label htmlFor={inputId} className="sr-only">
          Answer
        </label>
        <input
          id={inputId}
          type="number"
          step="any"
          inputMode="decimal"
          className="input"
          value={value.number_value}
          disabled={answerDisabled}
          onChange={(e) => set({ number_value: e.target.value })}
        />
        <p className="mt-1 text-xs text-slate-500">{numericHint}</p>
      </div>
    );
  } else if (q.response_type === "DATE") {
    control = (
      <div className="max-w-xs">
        <label htmlFor={inputId} className="sr-only">
          Answer
        </label>
        <input
          id={inputId}
          type="date"
          className="input"
          value={value.date_value}
          disabled={answerDisabled}
          onChange={(e) => set({ date_value: e.target.value })}
        />
      </div>
    );
  } else {
    control = (
      <div>
        <label htmlFor={inputId} className="sr-only">
          Answer
        </label>
        <textarea
          id={inputId}
          rows={3}
          className="input"
          value={value.text_value}
          disabled={answerDisabled}
          placeholder="Record your answer…"
          onChange={(e) => set({ text_value: e.target.value })}
        />
      </div>
    );
  }

  return (
    <article
      id={`q-${q.id}`}
      className={clsx(
        "card scroll-mt-48 p-4 sm:p-5",
        issues?.length && "border-amber-300 ring-1 ring-amber-200",
        hasOpenComment && !issues?.length && "border-purple-300 ring-1 ring-purple-200",
        focused && "ring-2 ring-brand-400",
      )}
      aria-labelledby={`q-text-${q.id}`}
      aria-current={focused ? "true" : undefined}
      onMouseDown={() => onFocusQuestion(q.id)}
      onFocusCapture={() => onFocusQuestion(q.id)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {q.code && <span className="font-mono text-xs font-semibold text-slate-500">{q.code}</span>}
            {q.is_mandatory && <Badge tone="red">Mandatory</Badge>}
            {q.evidence_required && <Badge tone="blue">Evidence required</Badge>}
            {weighted && <Badge tone="gray">Weight {Number(q.weight)}</Badge>}
            <Badge tone={SEVERITY_TONE[q.failure_severity]}>If failed: {SEVERITY_LABELS[q.failure_severity]}</Badge>
            {q.requires_corrective_action && <Badge tone="orange">Finding required on failure</Badge>}
          </div>
          <h3 id={`q-text-${q.id}`} className="text-sm font-medium leading-relaxed text-slate-900">
            {q.text}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs font-medium text-amber-700">Unsaved</span>}
          <ComplianceBadge compliance={compliance} />
        </div>
      </header>

      {q.guidance && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowGuidance((s) => !s)}
            aria-expanded={showGuidance}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
          >
            {showGuidance ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {showGuidance ? "Hide guidance" : "Show guidance"}
          </button>
          {showGuidance && (
            <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{q.guidance}</p>
          )}
        </div>
      )}

      {issues?.length ? (
        <ul className="mt-3 space-y-0.5">
          {issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {(comments.length > 0 || canAddComment) && (
        <div className="mt-3">
          <ReviewComments
            compact
            comments={comments}
            canAdd={canAddComment}
            canResolve={canResolveComment}
            onAdd={(body) => onAddComment(q.id, body)}
            onResolve={onResolveComment}
          />
        </div>
      )}

      <div className="mt-4 space-y-4">
        {control}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {q.response_type !== "YES_NO_NA" && (
            <Checkbox
              label="Not applicable"
              checked={na}
              disabled={readOnly}
              onChange={(e) => set({ is_not_applicable: e.target.checked })}
            />
          )}
          {!q.is_scored && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-600">Assessment:</span>
              <div role="group" aria-label="Assessment" className="flex gap-1.5">
                <Segment
                  selected={value.manual_assessment === "COMPLIANT"}
                  tone="good"
                  disabled={answerDisabled}
                  onClick={() => set({ manual_assessment: value.manual_assessment === "COMPLIANT" ? "" : "COMPLIANT" })}
                >
                  Compliant
                </Segment>
                <Segment
                  selected={value.manual_assessment === "NON_COMPLIANT"}
                  tone="bad"
                  disabled={answerDisabled}
                  onClick={() =>
                    set({ manual_assessment: value.manual_assessment === "NON_COMPLIANT" ? "" : "NON_COMPLIANT" })
                  }
                >
                  Non-compliant
                </Segment>
              </div>
            </div>
          )}
          <button
            type="button"
            aria-pressed={value.risk_flagged}
            disabled={readOnly}
            onClick={() => set({ risk_flagged: !value.risk_flagged })}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium disabled:cursor-not-allowed",
              value.risk_flagged
                ? "border-amber-400 bg-amber-50 text-amber-800"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:text-slate-400",
            )}
          >
            <Flag className={clsx("h-4 w-4", value.risk_flagged && "fill-amber-400")} aria-hidden />
            {value.risk_flagged ? "Flagged as potential risk" : "Flag as potential risk"}
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Textarea
            label="Observation"
            rows={2}
            value={value.observation}
            disabled={readOnly}
            placeholder="What did you see?"
            onChange={(e) => set({ observation: e.target.value })}
          />
          <Textarea
            label="Recommendation"
            rows={2}
            value={value.recommendation}
            disabled={readOnly}
            placeholder="What should change?"
            onChange={(e) => set({ recommendation: e.target.value })}
          />
        </div>

        {(evidence.length > 0 || canUpload || q.evidence_required) && (
          <div className="border-t border-slate-100 pt-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Evidence{evidence.length ? ` (${evidence.length})` : ""}
              </span>
              {canUpload && (
                <FileUploadButton label="Attach evidence" disabled={!uploadPossible} onUpload={(file) => onUpload(q, file)} />
              )}
            </div>
            {evidence.length > 0 ? (
              <FileList
                files={evidence}
                onDelete={
                  anyDeletable
                    ? (file) => {
                        const ev = evidence.find((e) => e.id === file.id);
                        if (ev) onDeleteEvidence(ev);
                      }
                    : undefined
                }
                canDelete={(file) => {
                  const ev = evidence.find((e) => e.id === file.id);
                  return !!ev && canDeleteEvidence(ev);
                }}
              />
            ) : (
              <p className={clsx("text-xs", q.evidence_required ? "text-amber-700" : "text-slate-500")}>
                {canUpload && !uploadPossible
                  ? "Answer the question before attaching evidence."
                  : q.evidence_required
                    ? "Supporting evidence is required for this question."
                    : "No evidence attached."}
              </p>
            )}
          </div>
        )}

        {(compliance === "NON_COMPLIANT" || q.findings_count > 0) && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-100 bg-red-50/50 px-3 py-2">
            <span className="text-sm text-red-800">
              {q.findings_count > 0 ? (
                <Link to={`/audits/${auditId}?tab=findings`} className="font-medium underline-offset-2 hover:underline">
                  {q.findings_count} finding{q.findings_count === 1 ? "" : "s"} recorded
                </Link>
              ) : (
                "Failed check — no finding recorded yet."
              )}
            </span>
            {compliance === "NON_COMPLIANT" && canRaiseFinding && (
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => onRecordFinding(q)}
              >
                Record finding
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
