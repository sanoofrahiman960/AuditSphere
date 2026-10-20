import { toApiError } from "@/api/client";
import type { ValidationIssue } from "@/types/api";

export const ISSUE_LABELS: Record<ValidationIssue["code"], string> = {
  mandatory_unanswered: "Mandatory questions unanswered",
  evidence_missing: "Supporting evidence missing",
  finding_required: "Failed checks without a recorded finding",
  review_comment_open: "Reviewer comments to address",
};

/**
 * The submit endpoint answers 400 `incomplete_checklist` with `errors.issues`. ApiError.fieldErrors
 * flattens nested objects, so read the raw error body instead.
 */
export function extractIssues(error: unknown): ValidationIssue[] | null {
  const err = toApiError(error);
  if (err.code !== "incomplete_checklist") return null;
  const raw = err.raw as { issues?: ValidationIssue[] } | null | undefined;
  return Array.isArray(raw?.issues) ? raw!.issues : [];
}

export function groupIssues(issues: ValidationIssue[]) {
  const groups = new Map<ValidationIssue["code"], ValidationIssue[]>();
  for (const issue of issues) {
    const list = groups.get(issue.code) ?? [];
    list.push(issue);
    groups.set(issue.code, list);
  }
  return Array.from(groups.entries());
}
