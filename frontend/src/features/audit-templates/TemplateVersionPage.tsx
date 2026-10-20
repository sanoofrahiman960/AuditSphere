import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  GitBranchPlus,
  Lock,
  Pencil,
  Plus,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toApiError } from "@/api/client";
import { templatesApi } from "@/api/endpoints";
import { Badge, SeverityBadge, VersionStatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Form";
import { ConfirmDialog, Modal, ReasonDialog } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import type {
  Question,
  ResponseType,
  RiskCategory,
  ScoringMethod,
  Section,
  Severity,
  TemplateVersion,
  VersionSummary,
} from "@/types/api";
import {
  RESPONSE_TYPE_LABELS,
  RISK_CATEGORY_LABELS,
  SEVERITY_LABELS,
  formatDate,
  formatDateTime,
  humanize,
  options,
} from "@/utils/format";

// ---------------------------------------------------------------- local draft model

interface QDraft {
  key: string;
  code: string;
  text: string;
  guidance: string;
  response_type: ResponseType;
  is_mandatory: boolean;
  evidence_required: boolean;
  weight: string;
  risk_category: RiskCategory;
  failure_severity: Severity;
  requires_corrective_action: boolean;
  rating_max: string;
  rating_pass_threshold: string;
  numeric_min: string;
  numeric_max: string;
}

interface SDraft {
  key: string;
  title: string;
  description: string;
  questions: QDraft[];
}

interface Draft {
  applicable_standard: string;
  scoring_method: ScoringMethod;
  change_notes: string;
  sections: SDraft[];
}

type QuestionErrors = Partial<Record<keyof QDraft, string>>;

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

const SCORING_OPTIONS = [
  { value: "SIMPLE", label: "Simple — every scored question counts equally" },
  { value: "WEIGHTED", label: "Weighted — questions carry individual weights" },
];

const BLANK_QUESTION: Omit<QDraft, "key"> = {
  code: "",
  text: "",
  guidance: "",
  response_type: "YES_NO",
  is_mandatory: true,
  evidence_required: false,
  weight: "1.00",
  risk_category: "COMPLIANCE",
  failure_severity: "MEDIUM",
  requires_corrective_action: false,
  rating_max: "5",
  rating_pass_threshold: "3",
  numeric_min: "",
  numeric_max: "",
};

function questionToDraft(q: Question): QDraft {
  return {
    key: newKey(),
    code: q.code ?? "",
    text: q.text ?? "",
    guidance: q.guidance ?? "",
    response_type: q.response_type,
    is_mandatory: q.is_mandatory,
    evidence_required: q.evidence_required,
    weight: q.weight ?? "1.00",
    risk_category: q.risk_category,
    failure_severity: q.failure_severity,
    requires_corrective_action: q.requires_corrective_action,
    rating_max: String(q.rating_max ?? 5),
    rating_pass_threshold: String(q.rating_pass_threshold ?? 3),
    numeric_min: q.numeric_min ?? "",
    numeric_max: q.numeric_max ?? "",
  };
}

function versionToDraft(v: TemplateVersion): Draft {
  return {
    applicable_standard: v.applicable_standard ?? "",
    scoring_method: v.scoring_method,
    change_notes: v.change_notes ?? "",
    sections: v.sections.map((s) => ({
      key: newKey(),
      title: s.title,
      description: s.description ?? "",
      questions: s.questions.map(questionToDraft),
    })),
  };
}

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const WEIGHT_RE = /^\d+(\.\d{1,2})?$/;

/** Canonical decimal string so "1" and "1.00" compare equal. */
function normalizeDecimal(value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (!DECIMAL_RE.test(v)) return v;
  return String(Number(v));
}

function isScored(q: Pick<QDraft, "response_type" | "numeric_min" | "numeric_max">): boolean {
  if (["YES_NO", "PASS_FAIL", "YES_NO_NA", "RATING"].includes(q.response_type)) return true;
  if (q.response_type === "NUMBER") return q.numeric_min.trim() !== "" || q.numeric_max.trim() !== "";
  return false;
}

function toPayload(d: Draft): {
  applicable_standard: string;
  scoring_method: ScoringMethod;
  change_notes: string;
  sections: Section[];
} {
  return {
    applicable_standard: d.applicable_standard.trim(),
    scoring_method: d.scoring_method,
    change_notes: d.change_notes.trim(),
    sections: d.sections.map((s, si) => ({
      title: s.title.trim(),
      description: s.description.trim(),
      order: si,
      questions: s.questions.map((q, qi) => {
        const weight = WEIGHT_RE.test(q.weight.trim()) ? Number(q.weight).toFixed(2) : "1.00";
        const numeric = q.response_type === "NUMBER";
        return {
          code: q.code.trim(),
          text: q.text.trim(),
          guidance: q.guidance.trim(),
          response_type: q.response_type,
          is_mandatory: q.is_mandatory,
          evidence_required: q.evidence_required,
          weight,
          risk_category: q.risk_category,
          failure_severity: q.failure_severity,
          requires_corrective_action: q.requires_corrective_action,
          rating_max: Number.parseInt(q.rating_max, 10) || 5,
          rating_pass_threshold: Number.parseInt(q.rating_pass_threshold, 10) || 1,
          numeric_min: numeric ? normalizeDecimal(q.numeric_min) : null,
          numeric_max: numeric ? normalizeDecimal(q.numeric_max) : null,
          order: qi,
        };
      }),
    })),
  };
}

function validateQuestion(q: QDraft, scoring: ScoringMethod): QuestionErrors {
  const errors: QuestionErrors = {};
  if (!q.text.trim()) errors.text = "Question text is required.";
  if (q.code.trim().length > 30) errors.code = "Codes are at most 30 characters.";
  if (scoring === "WEIGHTED") {
    const w = q.weight.trim();
    if (!w) errors.weight = "Weight is required for weighted scoring.";
    else if (!WEIGHT_RE.test(w)) errors.weight = "Use a number ≥ 0 with up to 2 decimals.";
    else if (Number(w) >= 10000) errors.weight = "Weight must be below 10,000.";
  }
  if (q.response_type === "RATING") {
    const max = Number(q.rating_max);
    const threshold = Number(q.rating_pass_threshold);
    if (!Number.isInteger(max) || max < 2 || max > 10) errors.rating_max = "Scale maximum must be a whole number from 2 to 10.";
    if (!Number.isInteger(threshold) || threshold < 1 || (Number.isInteger(max) && threshold > max)) {
      errors.rating_pass_threshold = `Pass threshold must be between 1 and ${Number.isInteger(max) ? max : "the maximum"}.`;
    }
  }
  if (q.response_type === "NUMBER") {
    const min = q.numeric_min.trim();
    const max = q.numeric_max.trim();
    if (min && !DECIMAL_RE.test(min)) errors.numeric_min = "Enter a number.";
    if (max && !DECIMAL_RE.test(max)) errors.numeric_max = "Enter a number.";
    if (min && max && DECIMAL_RE.test(min) && DECIMAL_RE.test(max) && Number(min) > Number(max)) {
      errors.numeric_max = "Maximum must be greater than or equal to the minimum.";
    }
  }
  return errors;
}

interface DraftErrors {
  applicable_standard?: string;
  sections: Record<string, string>;
  questions: Record<string, QuestionErrors>;
  count: number;
}

function validateDraft(d: Draft): DraftErrors {
  const result: DraftErrors = { sections: {}, questions: {}, count: 0 };
  if (d.applicable_standard.length > 255) {
    result.applicable_standard = "Keep the standard under 255 characters.";
    result.count++;
  }
  for (const s of d.sections) {
    if (!s.title.trim()) {
      result.sections[s.key] = "Every section needs a title.";
      result.count++;
    } else if (s.title.trim().length > 200) {
      result.sections[s.key] = "Section titles are at most 200 characters.";
      result.count++;
    }
    for (const q of s.questions) {
      const qe = validateQuestion(q, d.scoring_method);
      if (Object.keys(qe).length) {
        result.questions[q.key] = qe;
        result.count++;
      }
    }
  }
  return result;
}

/** Flatten DRF's nested error structure into readable lines ("Section 2 › Question 1 › Text: …"). */
function flattenErrors(value: unknown, path: string[] = []): string[] {
  const prefix = path.length ? `${path.join(" › ")}: ` : "";
  if (typeof value === "string") return [`${prefix}${value}`];
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) return value.map((v) => `${prefix}${v}`);
    const last = path[path.length - 1];
    return value.flatMap((v, i) => {
      const label = last === "Sections" ? `Section ${i + 1}` : last === "Questions" ? `Question ${i + 1}` : `#${i + 1}`;
      const base = last === "Sections" || last === "Questions" ? path.slice(0, -1) : path;
      return flattenErrors(v, [...base, label]);
    });
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      flattenErrors(v, k === "non_field_errors" ? path : [...path, humanize(k)]),
    );
  }
  return [];
}

function move<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = items.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ---------------------------------------------------------------- shared presentational pieces

type SummarySource = {
  sections: { questions: Pick<QDraft, "is_mandatory" | "evidence_required" | "weight">[] }[];
};

function StructureSummary({ source, scoring }: { source: SummarySource; scoring: ScoringMethod }) {
  const questions = source.sections.flatMap((s) => s.questions);
  const totalWeight = questions.reduce((sum, q) => {
    const w = Number(q.weight);
    return sum + (Number.isFinite(w) ? w : 0);
  }, 0);
  const stats: { label: string; value: ReactNode; hint?: string }[] = [
    { label: "Sections", value: source.sections.length },
    { label: "Questions", value: questions.length },
    { label: "Mandatory", value: questions.filter((q) => q.is_mandatory).length },
    { label: "Evidence required", value: questions.filter((q) => q.evidence_required).length },
    {
      label: "Total weight",
      value: totalWeight.toFixed(2).replace(/\.00$/, ""),
      hint: scoring === "WEIGHTED" ? "Used for weighted scoring" : "Not used (simple scoring)",
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Checklist summary">
      {stats.map((s) => (
        <div key={s.label} className="card px-4 py-3">
          <dt className="text-xs font-medium text-slate-500">{s.label}</dt>
          <dd className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{s.value}</dd>
          {s.hint && <dd className="text-[11px] text-slate-400">{s.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

function QuestionBadges({ q, scoring }: { q: QDraft; scoring: ScoringMethod }) {
  const scored = isScored(q);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <Badge tone="blue">{RESPONSE_TYPE_LABELS[q.response_type]}</Badge>
      {q.response_type === "RATING" && (
        <Badge tone="indigo">
          Scale 1–{q.rating_max}, pass ≥ {q.rating_pass_threshold}
        </Badge>
      )}
      {q.response_type === "NUMBER" && scored && (
        <Badge tone="indigo">
          Range {q.numeric_min.trim() || "−∞"} to {q.numeric_max.trim() || "+∞"}
        </Badge>
      )}
      {!scored && <Badge>Informational (not scored)</Badge>}
      {q.is_mandatory ? <Badge tone="purple">Mandatory</Badge> : <Badge>Optional</Badge>}
      {q.evidence_required && <Badge tone="teal">Evidence required</Badge>}
      {scoring === "WEIGHTED" && <Badge tone="gray">Weight {q.weight || "—"}</Badge>}
      <Badge tone="gray">{RISK_CATEGORY_LABELS[q.risk_category]}</Badge>
      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
        Fails as <SeverityBadge severity={q.failure_severity} />
      </span>
      {q.requires_corrective_action && <Badge tone="orange">Corrective action on failure</Badge>}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={
        "rounded-md p-1.5 transition disabled:cursor-not-allowed disabled:opacity-30 " +
        (danger ? "text-slate-400 hover:bg-red-50 hover:text-red-600" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")
      }
    >
      {children}
    </button>
  );
}

function VersionHeader({ version, actions }: { version: TemplateVersion; actions?: ReactNode }) {
  return (
    <PageHeader
      title={`${version.template_name} — v${version.version}`}
      breadcrumbs={[
        { label: "Templates", to: "/templates" },
        { label: version.template_name, to: `/templates/${version.template}` },
        { label: `Version ${version.version}` },
      ]}
      meta={
        <>
          <VersionStatusBadge status={version.status} />
          <Badge tone="gray">{version.scoring_method === "WEIGHTED" ? "Weighted scoring" : "Simple scoring"}</Badge>
          {version.applicable_standard && <Badge tone="blue">{version.applicable_standard}</Badge>}
          <span className="text-xs text-slate-500">
            Created {formatDate(version.created_at)}
            {version.created_by ? ` by ${version.created_by.full_name}` : ""}
            {version.approved_at &&
              ` · Approved ${formatDate(version.approved_at)}${version.approved_by ? ` by ${version.approved_by.full_name}` : ""}`}
            {` · Used by ${version.audit_count} audit${version.audit_count === 1 ? "" : "s"}`}
          </span>
        </>
      }
      actions={actions}
    />
  );
}

// ---------------------------------------------------------------- question editor

function QuestionEditorModal({
  open,
  initial,
  isNew,
  scoring,
  onClose,
  onApply,
}: {
  open: boolean;
  initial: QDraft | null;
  isNew: boolean;
  scoring: ScoringMethod;
  onClose: () => void;
  onApply: (q: QDraft) => void;
}) {
  const [q, setQ] = useState<QDraft | null>(initial);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      setQ(initial);
      setAttempted(false);
    }
  }, [open, initial]);

  if (!q) return null;
  const errors = validateQuestion(q, scoring);
  const show = (field: keyof QDraft) => (attempted ? errors[field] : undefined);
  const set = <K extends keyof QDraft>(field: K, value: QDraft[K]) => setQ((prev) => (prev ? { ...prev, [field]: value } : prev));

  const apply = () => {
    setAttempted(true);
    if (Object.keys(errors).length === 0) onApply(q);
  };

  const ratingMax = Number.parseInt(q.rating_max, 10);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isNew ? "Add question" : "Edit question"}
      description="Changes are applied to the draft. Remember to save the draft afterwards."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply}>{isNew ? "Add question" : "Apply changes"}</Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <Input
            label="Code"
            placeholder="e.g. IT-AC-01"
            maxLength={30}
            value={q.code}
            onChange={(e) => set("code", e.target.value)}
            error={show("code")}
          />
          <Select
            label="Response type"
            options={options(RESPONSE_TYPE_LABELS)}
            value={q.response_type}
            onChange={(e) => set("response_type", e.target.value as ResponseType)}
          />
        </div>
        <Textarea
          label="Question"
          required
          rows={2}
          value={q.text}
          onChange={(e) => set("text", e.target.value)}
          error={show("text")}
        />
        <Textarea
          label="Guidance / expected criteria"
          hint="What the auditor should check and what a compliant answer looks like."
          rows={3}
          value={q.guidance}
          onChange={(e) => set("guidance", e.target.value)}
        />

        {q.response_type === "RATING" && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Scale maximum"
                type="number"
                min={2}
                max={10}
                step={1}
                required
                value={q.rating_max}
                onChange={(e) => set("rating_max", e.target.value)}
                error={show("rating_max")}
                hint="Ratings run from 1 to this value (2–10)."
              />
              <Input
                label="Pass threshold"
                type="number"
                min={1}
                max={Number.isFinite(ratingMax) ? ratingMax : 10}
                step={1}
                required
                value={q.rating_pass_threshold}
                onChange={(e) => set("rating_pass_threshold", e.target.value)}
                error={show("rating_pass_threshold")}
                hint="Ratings at or above this value are compliant."
              />
            </div>
          </div>
        )}

        {q.response_type === "NUMBER" && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Minimum acceptable value"
                inputMode="decimal"
                placeholder="No minimum"
                value={q.numeric_min}
                onChange={(e) => set("numeric_min", e.target.value)}
                error={show("numeric_min")}
              />
              <Input
                label="Maximum acceptable value"
                inputMode="decimal"
                placeholder="No maximum"
                value={q.numeric_max}
                onChange={(e) => set("numeric_max", e.target.value)}
                error={show("numeric_max")}
              />
            </div>
            <p className="text-xs text-slate-500">
              Values inside the range are compliant. Without any bound the question is informational: the value is
              recorded but does not affect the compliance score.
            </p>
          </div>
        )}

        {(q.response_type === "TEXT" || q.response_type === "DATE") && (
          <Notice>
            {RESPONSE_TYPE_LABELS[q.response_type]} answers are informational: they are recorded but do not affect the
            compliance score. Auditors can still flag a risk or raise a finding.
          </Notice>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Risk category"
            options={options(RISK_CATEGORY_LABELS)}
            value={q.risk_category}
            onChange={(e) => set("risk_category", e.target.value as RiskCategory)}
          />
          <Select
            label="Failure severity"
            hint="Suggested severity when this check fails."
            options={options(SEVERITY_LABELS)}
            value={q.failure_severity}
            onChange={(e) => set("failure_severity", e.target.value as Severity)}
          />
          {scoring === "WEIGHTED" && (
            <Input
              label="Weight"
              required
              inputMode="decimal"
              value={q.weight}
              onChange={(e) => set("weight", e.target.value)}
              error={show("weight")}
              hint="Relative importance (≥ 0)."
            />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Checkbox
            label="Mandatory"
            description="Must be answered before submission."
            checked={q.is_mandatory}
            onChange={(e) => set("is_mandatory", e.target.checked)}
          />
          <Checkbox
            label="Evidence required"
            description="Answer needs at least one attachment."
            checked={q.evidence_required}
            onChange={(e) => set("evidence_required", e.target.checked)}
          />
          <Checkbox
            label="Requires corrective action"
            description="A failure must lead to a finding."
            checked={q.requires_corrective_action}
            onChange={(e) => set("requires_corrective_action", e.target.checked)}
          />
        </div>
        {/* Allow Enter to submit from single-line inputs. */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- builder (editable draft)

function VersionBuilder({ version, versions }: { version: TemplateVersion; versions?: VersionSummary[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = useState<Draft>(() => versionToDraft(version));
  const [draft, setDraft] = useState<Draft>(baseline);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [editor, setEditor] = useState<{ sectionKey: string; question: QDraft; isNew: boolean } | null>(null);
  const [removingSection, setRemovingSection] = useState<SDraft | null>(null);
  const [approving, setApproving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const payload = useMemo(() => toPayload(draft), [draft]);
  const baselinePayload = useMemo(() => JSON.stringify(toPayload(baseline)), [baseline]);
  const dirty = JSON.stringify(payload) !== baselinePayload;
  const errors = useMemo(() => validateDraft(draft), [draft]);
  const questionCount = draft.sections.reduce((n, s) => n + s.questions.length, 0);
  const previousApproved = versions?.find((v) => v.status === "APPROVED" && v.id !== version.id) ?? null;

  const leaveGuard = useUnsavedChanges(dirty, "You have unsaved changes to this draft. Leave without saving?");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["template-versions", version.template] });
    queryClient.invalidateQueries({ queryKey: ["template", version.template] });
    queryClient.invalidateQueries({ queryKey: ["templates"] });
    queryClient.invalidateQueries({ queryKey: ["lookup"] });
  };

  const save = useMutation({
    mutationFn: () => templatesApi.updateVersion(version.id, payload),
    onSuccess: (saved) => {
      queryClient.setQueryData(["template-version", version.id], saved);
      const next = versionToDraft(saved);
      setBaseline(next);
      setDraft(next);
      setAttempted(false);
      setServerErrors([]);
      invalidate();
      toast.success("Draft saved");
    },
    onError: (e) => {
      const err = toApiError(e);
      const lines = flattenErrors(err.raw);
      setServerErrors(lines.length ? lines : [err.message]);
      toast.error(lines.length ? "The draft could not be saved — see the errors listed above the checklist." : e);
    },
  });

  const approve = useMutation({
    mutationFn: () => templatesApi.approveVersion(version.id),
    onSuccess: (approved) => {
      setApproving(false);
      invalidate();
      toast.success(`Version ${approved.version} approved and locked`);
      // Switches the page to the read-only view.
      queryClient.setQueryData(["template-version", version.id], approved);
    },
    onError: (e) => {
      setApproving(false);
      toast.error(e);
    },
  });

  const handleSave = () => {
    setAttempted(true);
    if (errors.count > 0) {
      toast.error(`Fix ${errors.count} problem${errors.count === 1 ? "" : "s"} before saving.`);
      return;
    }
    save.mutate();
  };

  // --- structure mutations
  const updateSection = (key: string, patch: Partial<SDraft>) =>
    setDraft((d) => ({ ...d, sections: d.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
  const addSection = () => {
    const key = newKey();
    setDraft((d) => ({ ...d, sections: [...d.sections, { key, title: "", description: "", questions: [] }] }));
    setFocusKey(key);
  };
  const moveSection = (index: number, delta: number) =>
    setDraft((d) => ({ ...d, sections: move(d.sections, index, delta) }));
  const removeSection = (key: string) =>
    setDraft((d) => ({ ...d, sections: d.sections.filter((s) => s.key !== key) }));
  const updateQuestions = (sectionKey: string, fn: (qs: QDraft[]) => QDraft[]) =>
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s) => (s.key === sectionKey ? { ...s, questions: fn(s.questions) } : s)),
    }));
  const applyQuestion = (sectionKey: string, q: QDraft, isNew: boolean) =>
    updateQuestions(sectionKey, (qs) => (isNew ? [...qs, q] : qs.map((x) => (x.key === q.key ? q : x))));
  const duplicateQuestion = (sectionKey: string, index: number) =>
    updateQuestions(sectionKey, (qs) => {
      const copy = { ...qs[index], key: newKey() };
      return [...qs.slice(0, index + 1), copy, ...qs.slice(index + 1)];
    });

  const approveBlocked = dirty
    ? "Save your changes before approving."
    : questionCount === 0
      ? "Add at least one question before approving."
      : null;

  return (
    <>
      {leaveGuard}
      <VersionHeader
        version={version}
        actions={
          <>
            {dirty && (
              <>
                <Badge tone="amber">Unsaved changes</Badge>
                <Button variant="ghost" icon={<Undo2 className="h-4 w-4" />} onClick={() => setDiscarding(true)}>
                  Discard
                </Button>
              </>
            )}
            <Button
              variant="secondary"
              icon={<Save className="h-4 w-4" />}
              onClick={handleSave}
              loading={save.isPending}
              disabled={!dirty}
            >
              Save draft
            </Button>
            <span title={approveBlocked ?? undefined}>
              <Button
                variant="success"
                icon={<CheckCircle2 className="h-4 w-4" />}
                onClick={() => setApproving(true)}
                disabled={!!approveBlocked || save.isPending}
              >
                Approve version
              </Button>
            </span>
          </>
        }
      />

      <div className="space-y-6">
        <Notice>
          This is an unused draft, so its checklist can be changed freely. Once approved it is locked; later changes
          need a new version. {approveBlocked && <strong>{approveBlocked}</strong>}
        </Notice>

        {(serverErrors.length > 0 || (attempted && errors.count > 0)) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {serverErrors.length > 0 ? (
              <>
                <p className="font-medium">The server rejected the draft:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {serverErrors.slice(0, 15).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>
                {errors.count} item{errors.count === 1 ? " needs" : "s need"} attention. Sections need a title and
                questions need text and valid scoring settings — look for the highlighted items below.
              </p>
            )}
          </div>
        )}

        <Card title="Version settings" description="Apply to this version only; earlier versions keep their own settings.">
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Applicable standard"
              placeholder="e.g. ISO 27001:2022, SOX, internal policy"
              maxLength={255}
              value={draft.applicable_standard}
              onChange={(e) => setDraft((d) => ({ ...d, applicable_standard: e.target.value }))}
              error={attempted ? errors.applicable_standard : undefined}
            />
            <Select
              label="Scoring method"
              options={SCORING_OPTIONS}
              value={draft.scoring_method}
              onChange={(e) => setDraft((d) => ({ ...d, scoring_method: e.target.value as ScoringMethod }))}
              hint={
                draft.scoring_method === "WEIGHTED"
                  ? "Score = weight of compliant answers ÷ weight of all scored answers."
                  : "Score = compliant answers ÷ all scored answers."
              }
            />
            <Textarea
              className="md:col-span-2"
              label="Change notes"
              rows={2}
              placeholder="What changed in this version and why"
              value={draft.change_notes}
              onChange={(e) => setDraft((d) => ({ ...d, change_notes: e.target.value }))}
            />
          </div>
        </Card>

        <StructureSummary source={draft} scoring={draft.scoring_method} />

        {draft.sections.length === 0 ? (
          <div className="card">
            <EmptyState
              title="No sections yet"
              description="Organise the checklist into sections (e.g. Access control, Backups), then add questions to each."
              action={
                <Button icon={<Plus className="h-4 w-4" />} onClick={addSection}>
                  Add first section
                </Button>
              }
            />
          </div>
        ) : (
          <ol className="space-y-4">
            {draft.sections.map((section, si) => (
              <li key={section.key} className="card overflow-hidden">
                <div className="flex flex-wrap items-start gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
                  <span className="mt-2 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-brand-100 px-1.5 text-xs font-semibold text-brand-800">
                    {si + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      aria-label={`Section ${si + 1} title`}
                      placeholder="Section title"
                      maxLength={200}
                      autoFocus={focusKey === section.key}
                      value={section.title}
                      onChange={(e) => updateSection(section.key, { title: e.target.value })}
                      error={attempted ? errors.sections[section.key] : undefined}
                    />
                    <Textarea
                      aria-label={`Section ${si + 1} description`}
                      placeholder="Description (optional)"
                      rows={1}
                      value={section.description}
                      onChange={(e) => updateSection(section.key, { description: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center gap-0.5">
                    <IconButton label="Move section up" onClick={() => moveSection(si, -1)} disabled={si === 0}>
                      <ArrowUp className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      label="Move section down"
                      onClick={() => moveSection(si, 1)}
                      disabled={si === draft.sections.length - 1}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </IconButton>
                    <IconButton label="Delete section" danger onClick={() => setRemovingSection(section)}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                </div>

                {section.questions.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-slate-500">No questions in this section yet.</p>
                ) : (
                  <ol className="divide-y divide-slate-100">
                    {section.questions.map((q, qi) => {
                      const qErrors = attempted ? errors.questions[q.key] : undefined;
                      return (
                        <li
                          key={q.key}
                          className={"flex flex-wrap items-start gap-3 px-4 py-3 " + (qErrors ? "bg-red-50/60" : "")}
                        >
                          <span className="mt-0.5 w-8 shrink-0 text-xs font-medium tabular-nums text-slate-400">
                            {si + 1}.{qi + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-800">
                              {q.code && <span className="mr-1.5 font-mono text-xs text-slate-500">{q.code}</span>}
                              {q.text || <span className="italic text-slate-400">No question text</span>}
                            </p>
                            {q.guidance && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{q.guidance}</p>}
                            <QuestionBadges q={q} scoring={draft.scoring_method} />
                            {qErrors && (
                              <p className="mt-1 text-xs text-red-600" role="alert">
                                {Object.values(qErrors).join(" ")}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5">
                            <IconButton
                              label="Edit question"
                              onClick={() => setEditor({ sectionKey: section.key, question: q, isNew: false })}
                            >
                              <Pencil className="h-4 w-4" />
                            </IconButton>
                            <IconButton label="Duplicate question" onClick={() => duplicateQuestion(section.key, qi)}>
                              <Copy className="h-4 w-4" />
                            </IconButton>
                            <IconButton
                              label="Move question up"
                              onClick={() => updateQuestions(section.key, (qs) => move(qs, qi, -1))}
                              disabled={qi === 0}
                            >
                              <ArrowUp className="h-4 w-4" />
                            </IconButton>
                            <IconButton
                              label="Move question down"
                              onClick={() => updateQuestions(section.key, (qs) => move(qs, qi, 1))}
                              disabled={qi === section.questions.length - 1}
                            >
                              <ArrowDown className="h-4 w-4" />
                            </IconButton>
                            <IconButton
                              label="Delete question"
                              danger
                              onClick={() => updateQuestions(section.key, (qs) => qs.filter((x) => x.key !== q.key))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconButton>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
                <div className="border-t border-slate-100 px-4 py-2.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Plus className="h-4 w-4" />}
                    onClick={() =>
                      setEditor({ sectionKey: section.key, question: { ...BLANK_QUESTION, key: newKey() }, isNew: true })
                    }
                  >
                    Add question
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}

        {draft.sections.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={addSection}>
              Add section
            </Button>
            <Button
              icon={<Save className="h-4 w-4" />}
              onClick={handleSave}
              loading={save.isPending}
              disabled={!dirty}
            >
              Save draft
            </Button>
          </div>
        )}
      </div>

      <QuestionEditorModal
        open={!!editor}
        initial={editor?.question ?? null}
        isNew={editor?.isNew ?? false}
        scoring={draft.scoring_method}
        onClose={() => setEditor(null)}
        onApply={(q) => {
          if (editor) applyQuestion(editor.sectionKey, q, editor.isNew);
          setEditor(null);
        }}
      />

      <ConfirmDialog
        open={!!removingSection}
        onClose={() => setRemovingSection(null)}
        onConfirm={() => {
          if (removingSection) removeSection(removingSection.key);
          setRemovingSection(null);
        }}
        tone="danger"
        title="Delete section?"
        confirmLabel="Delete section"
        message={
          <>
            <strong>{removingSection?.title || "This untitled section"}</strong> and its{" "}
            {removingSection?.questions.length ?? 0} question(s) will be removed from the draft. The change is final once
            you save the draft.
          </>
        }
      />

      <ConfirmDialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        onConfirm={() => {
          setDraft(baseline);
          setAttempted(false);
          setServerErrors([]);
          setDiscarding(false);
        }}
        tone="danger"
        title="Discard unsaved changes?"
        confirmLabel="Discard changes"
        message="The draft returns to its last saved state."
      />

      <ConfirmDialog
        open={approving}
        onClose={() => setApproving(false)}
        onConfirm={() => approve.mutate()}
        loading={approve.isPending}
        title={`Approve version ${version.version}?`}
        confirmLabel="Approve and lock"
        message={
          <div className="space-y-2">
            <p>
              Approving locks this version permanently: its {questionCount} question{questionCount === 1 ? "" : "s"} can
              no longer be edited, and it becomes the version used for new audits.
            </p>
            <p>
              {previousApproved
                ? `The currently approved version v${previousApproved.version} will be archived. Audits already created from it keep using it unchanged.`
                : "Any previously approved version will be archived; audits already created keep their version unchanged."}
            </p>
          </div>
        }
      />
    </>
  );
}

// ---------------------------------------------------------------- read-only view

function VersionReadOnly({
  version,
  canManage,
  versions,
}: {
  version: TemplateVersion;
  canManage: boolean;
  versions?: VersionSummary[];
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [archiving, setArchiving] = useState(false);
  const [branching, setBranching] = useState(false);
  const existingDraft = versions?.find((v) => v.status === "DRAFT") ?? null;

  const sections = useMemo(
    () => version.sections.map((s) => ({ ...s, questions: s.questions.map(questionToDraft) })),
    [version],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["template-versions", version.template] });
    queryClient.invalidateQueries({ queryKey: ["template", version.template] });
    queryClient.invalidateQueries({ queryKey: ["templates"] });
    queryClient.invalidateQueries({ queryKey: ["lookup"] });
  };

  const branch = useMutation({
    mutationFn: (change_notes: string) =>
      templatesApi.newVersion(version.template, { source_version: version.id, change_notes }),
    onSuccess: (created) => {
      setBranching(false);
      invalidate();
      queryClient.setQueryData(["template-version", created.id], created);
      toast.success(`Draft version ${created.version} created from v${version.version}`);
      navigate(`/templates/${version.template}/versions/${created.id}`);
    },
    onError: (e) => toast.error(e),
  });

  const archive = useMutation({
    mutationFn: () => templatesApi.archiveVersion(version.id),
    onSuccess: (archived) => {
      setArchiving(false);
      queryClient.setQueryData(["template-version", version.id], archived);
      invalidate();
      toast.success(`Version ${archived.version} archived`);
    },
    onError: (e) => {
      setArchiving(false);
      toast.error(e);
    },
  });

  let reason: ReactNode;
  if (version.status === "APPROVED") {
    reason = (
      <>
        <strong>Approved versions are locked.</strong> This is the version used for new audits. To change the checklist,
        create a new version from it and approve that.
      </>
    );
  } else if (version.status === "ARCHIVED") {
    reason = (
      <>
        <strong>This version is archived.</strong> It is kept unchanged for the audits created from it and cannot be used
        for new audits.
      </>
    );
  } else if (version.audit_count > 0) {
    reason = (
      <>
        <strong>This draft is already used by {version.audit_count} audit(s)</strong>, so its checklist can no longer be
        edited. Create a new version to make changes.
      </>
    );
  } else {
    reason = <>You are viewing a draft. Only audit administrators can edit or approve template versions.</>;
  }

  return (
    <>
      <VersionHeader
        version={version}
        actions={
          canManage && (
            <>
              {version.status === "APPROVED" && (
                <Button variant="secondary" icon={<Archive className="h-4 w-4" />} onClick={() => setArchiving(true)}>
                  Archive
                </Button>
              )}
              <span
                title={existingDraft ? `Draft v${existingDraft.version} already exists — edit or approve it first.` : undefined}
              >
                <Button
                  icon={<GitBranchPlus className="h-4 w-4" />}
                  disabled={!!existingDraft}
                  onClick={() => setBranching(true)}
                >
                  Create new version from this
                </Button>
              </span>
            </>
          )
        }
      />

      <div className="space-y-6">
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-card">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <div>
            <p>{reason}</p>
            {canManage && existingDraft && existingDraft.id !== version.id && (
              <p className="mt-1 text-slate-500">
                Draft v{existingDraft.version} is already in progress.{" "}
                <Link to={`/templates/${version.template}/versions/${existingDraft.id}`} className="link">
                  Open the draft
                </Link>
              </p>
            )}
          </div>
        </div>

        {version.change_notes && (
          <Card title="Change notes">
            <p className="whitespace-pre-line text-sm text-slate-700">{version.change_notes}</p>
          </Card>
        )}

        <StructureSummary source={{ sections }} scoring={version.scoring_method} />

        {sections.length === 0 ? (
          <div className="card">
            <EmptyState title="This version has no sections" />
          </div>
        ) : (
          <ol className="space-y-4">
            {sections.map((section, si) => (
              <li key={section.id ?? si} className="card overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-brand-100 px-1.5 text-xs font-semibold text-brand-800">
                      {si + 1}
                    </span>
                    {section.title}
                    <span className="text-xs font-normal text-slate-500">
                      · {section.questions.length} question{section.questions.length === 1 ? "" : "s"}
                    </span>
                  </h2>
                  {section.description && <p className="mt-1 text-sm text-slate-500">{section.description}</p>}
                </div>
                {section.questions.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-slate-500">No questions in this section.</p>
                ) : (
                  <ol className="divide-y divide-slate-100">
                    {section.questions.map((q, qi) => (
                      <li key={q.key} className="flex gap-3 px-4 py-3">
                        <span className="mt-0.5 w-8 shrink-0 text-xs font-medium tabular-nums text-slate-400">
                          {si + 1}.{qi + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-800">
                            {q.code && <span className="mr-1.5 font-mono text-xs text-slate-500">{q.code}</span>}
                            {q.text}
                          </p>
                          {q.guidance && (
                            <p className="mt-1 whitespace-pre-line text-xs text-slate-500">
                              <span className="font-medium text-slate-600">Guidance: </span>
                              {q.guidance}
                            </p>
                          )}
                          <QuestionBadges q={q} scoring={version.scoring_method} />
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-slate-400">Last updated {formatDateTime(version.updated_at)}</p>
      </div>

      {canManage && (
        <>
          <ReasonDialog
            open={branching}
            onClose={() => setBranching(false)}
            onSubmit={(notes) => branch.mutate(notes)}
            title={`New version from v${version.version}`}
            message="A new draft is created with a copy of this checklist. This version and the audits using it are not changed."
            label="Change notes (optional)"
            required={false}
            confirmLabel="Create draft"
            loading={branch.isPending}
          />
          <ConfirmDialog
            open={archiving}
            onClose={() => setArchiving(false)}
            onConfirm={() => archive.mutate()}
            loading={archive.isPending}
            tone="danger"
            title={`Archive version ${version.version}?`}
            confirmLabel="Archive version"
            message={
              <div className="space-y-2">
                <p>Archived versions can no longer be used for new audits. Audits already created from it keep it unchanged.</p>
                <p>Until another version is approved, this template cannot be used to create audits.</p>
              </div>
            }
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- page

export default function TemplateVersionPage() {
  const { id, versionId } = useParams();
  const templateId = Number(id);
  const vId = Number(versionId);
  const { can } = useAuth();
  const canManage = can("manage_templates");

  const query = useQuery({
    queryKey: ["template-version", vId],
    queryFn: () => templatesApi.getVersion(vId),
    enabled: Number.isFinite(vId),
  });
  const versions = useQuery({
    queryKey: ["template-versions", templateId],
    queryFn: () => templatesApi.versions(templateId),
    enabled: canManage && Number.isFinite(templateId),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const version = query.data;
  if (version.is_editable && canManage) {
    return <VersionBuilder key={version.id} version={version} versions={versions.data} />;
  }
  return <VersionReadOnly version={version} canManage={canManage} versions={versions.data} />;
}
