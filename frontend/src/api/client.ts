import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";
import type { ApiErrorBody } from "@/types/api";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

// ---------------------------------------------------------------- token storage
// Tokens are kept in localStorage so a session survives page reloads. Access tokens are
// short-lived (15 min by default) and refresh tokens rotate and are blacklisted on logout.
const STORAGE_KEY = "auditsphere.auth";

interface StoredTokens {
  access: string;
  refresh: string;
}

export const tokenStore = {
  get(): StoredTokens | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StoredTokens) : null;
    } catch {
      return null;
    }
  },
  set(tokens: StoredTokens) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  },
  clear() {
    localStorage.removeItem(STORAGE_KEY);
  },
};

// Fired when the refresh token is no longer valid; AuthProvider listens and signs out.
export const SESSION_EXPIRED_EVENT = "auditsphere:session-expired";

// ---------------------------------------------------------------- errors
export class ApiError extends Error {
  status: number;
  code: string;
  fieldErrors: Record<string, string[]>;
  raw: unknown;

  constructor(status: number, body: Partial<ApiErrorBody> | undefined, fallback: string) {
    super(body?.detail || fallback);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code || "error";
    this.raw = body?.errors;
    this.fieldErrors = normaliseFieldErrors(body?.errors);
  }
}

function normaliseFieldErrors(errors: unknown): Record<string, string[]> {
  if (!errors || typeof errors !== "object" || Array.isArray(errors)) return {};
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
    if (Array.isArray(value)) result[key] = value.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
    else if (typeof value === "string") result[key] = [value];
  }
  return result;
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    if (!error.response) return new ApiError(0, undefined, "Cannot reach the server. Check your connection.");
    const data = error.response.data as Partial<ApiErrorBody> | undefined;
    const fallback =
      status === 403
        ? "You do not have permission to perform this action."
        : status === 404
          ? "The requested record was not found."
          : status >= 500
            ? "The server encountered an error. Please try again."
            : "The request could not be completed.";
    return new ApiError(status, data && typeof data === "object" && "detail" in data ? data : undefined, fallback);
  }
  return new ApiError(0, undefined, error instanceof Error ? error.message : "Unexpected error");
}

// ---------------------------------------------------------------- axios instance
export const http = axios.create({ baseURL: API_BASE_URL, timeout: 60_000 });

http.interceptors.request.use((config) => {
  const tokens = tokenStore.get();
  if (tokens?.access) config.headers.Authorization = `Bearer ${tokens.access}`;
  return config;
});

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const tokens = tokenStore.get();
  if (!tokens?.refresh) throw new Error("No refresh token");
  // A bare axios call so this request never goes through the 401 interceptor.
  const { data } = await axios.post<{ access: string; refresh?: string }>(`${API_BASE_URL}/auth/refresh/`, {
    refresh: tokens.refresh,
  });
  tokenStore.set({ access: data.access, refresh: data.refresh ?? tokens.refresh });
  return data.access;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const isAuthCall = original?.url?.includes("/auth/login") || original?.url?.includes("/auth/refresh");
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall && tokenStore.get()) {
      original._retried = true;
      try {
        // Concurrent 401s share one refresh request.
        refreshPromise = refreshPromise ?? refreshAccessToken().finally(() => (refreshPromise = null));
        const access = await refreshPromise;
        original.headers.Authorization = `Bearer ${access}`;
        return http(original);
      } catch {
        tokenStore.clear();
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }
    }
    return Promise.reject(toApiError(error));
  },
);

// ---------------------------------------------------------------- helpers
export async function get<T>(url: string, params?: object): Promise<T> {
  const { data } = await http.get<T>(url, { params: cleanParams(params) });
  return data;
}

export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const { data } = await http.post<T>(url, body, config);
  return data;
}

export async function put<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await http.put<T>(url, body);
  return data;
}

export async function patch<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await http.patch<T>(url, body);
  return data;
}

export async function del(url: string): Promise<void> {
  await http.delete(url);
}

export async function upload<T>(url: string, fields: Record<string, string | number | Blob | null | undefined>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") form.append(key, value as string | Blob);
  }
  return post<T>(url, form, { headers: { "Content-Type": "multipart/form-data" } });
}

/** Drop empty values and join arrays the way django-filter expects (repeated keys). */
export function cleanParams(params?: object): URLSearchParams | undefined {
  if (!params) return undefined;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, String(v)));
    else search.append(key, String(value));
  }
  return search;
}

/**
 * Download a protected file (evidence, report export). Uses the authenticated client,
 * so authorisation is enforced by the API; the browser never gets a public file URL.
 */
export async function downloadFile(url: string, params?: object, fallbackName = "download"): Promise<void> {
  const path = url.startsWith(API_BASE_URL) ? url.slice(API_BASE_URL.length) : url.replace(/^\/api/, "");
  const response = await http.get<Blob>(path, { params: cleanParams(params), responseType: "blob" });
  const disposition = String(response.headers["content-disposition"] || "");
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;
  const href = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
