import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { ApiError, cleanParams, toApiError } from "./client";

function axiosError(status: number, data: unknown) {
  const headers = new AxiosHeaders();
  return new AxiosError("Request failed", "ERR_BAD_RESPONSE", { headers }, null, {
    status,
    statusText: "",
    headers: {},
    config: { headers },
    data,
  });
}

describe("toApiError", () => {
  it("uses the backend's uniform error body", () => {
    const err = toApiError(
      axiosError(400, {
        detail: "title: This field is required.",
        code: "validation_error",
        errors: { title: ["This field is required."], due_date: "Bad date" },
      }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("validation_error");
    expect(err.message).toBe("title: This field is required.");
    expect(err.fieldErrors).toEqual({ title: ["This field is required."], due_date: ["Bad date"] });
  });

  it("falls back to friendly messages by status", () => {
    expect(toApiError(axiosError(403, "<html>")).message).toMatch(/permission/i);
    expect(toApiError(axiosError(404, null)).message).toMatch(/not found/i);
    expect(toApiError(axiosError(502, null)).message).toMatch(/server/i);
  });

  it("reports network failures", () => {
    const err = toApiError(new AxiosError("Network Error", "ERR_NETWORK"));
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/cannot reach/i);
  });

  it("keeps the issues list for business-rule errors", () => {
    const issues = [{ question_id: 1, code: "mandatory_unanswered", message: "Q1: a response is mandatory." }];
    const err = toApiError(axiosError(400, { detail: "Incomplete", code: "incomplete_checklist", errors: { issues } }));
    expect(err.code).toBe("incomplete_checklist");
    expect((err.raw as { issues: unknown[] }).issues).toHaveLength(1);
  });
});

describe("cleanParams", () => {
  it("drops empty values and repeats array keys", () => {
    const params = cleanParams({ search: "", status: ["OPEN", "CLOSED"], page: 2, owner: undefined, mine: false });
    expect(params?.toString()).toBe("status=OPEN&status=CLOSED&page=2&mine=false");
  });
});
