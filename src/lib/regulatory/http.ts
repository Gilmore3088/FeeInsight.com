import { crawlerUserAgent } from "@/lib/agents/crawler-identity";
import { CONTACT_EMAIL } from "@/lib/constants";

/**
 * Shared HTTP client for published regulator data (FDIC, NCUA, CFPB, SEC, Fed).
 * Pure transport: no DB access. Retries transient failures with backoff and
 * identifies the pipeline with a contact address (SEC EDGAR requires one).
 */

export type FetchImpl = typeof fetch;

export const REGISTRY_USER_AGENT = `${crawlerUserAgent("Magellan")} ${CONTACT_EMAIL}`;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class RegistryHttpError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "RegistryHttpError";
  }
}

export interface RegistryFetchOptions {
  fetchImpl?: FetchImpl;
  retries?: number;
  timeoutMs?: number;
  /** Base backoff in ms; doubled per attempt. Tests pass 0. */
  backoffMs?: number;
  /** Extra request headers, e.g. an API key that must stay out of URLs and error messages. */
  headers?: Record<string, string>;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** A POST body for APIs that take their parameters as JSON (BLS). */
export interface RegistryJsonBody {
  json: unknown;
}

/** A multipart POST body for APIs that take an uploaded file (Census batch geocoder). */
export interface RegistryFormBody {
  form: () => FormData;
}

export async function registryFetch(
  url: string,
  options: RegistryFetchOptions = {},
  body?: RegistryJsonBody | RegistryFormBody,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const backoffMs = options.backoffMs ?? 1_000;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
    try {
      const isJson = body !== undefined && "json" in body;
      const response = await fetchImpl(url, {
        // A FormData body is rebuilt per attempt and sets its own multipart Content-Type.
        ...(body ? { method: "POST", body: isJson ? JSON.stringify(body.json) : body.form() } : {}),
        headers: {
          "User-Agent": REGISTRY_USER_AGENT,
          Accept: "application/json, */*",
          ...(isJson ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (response.ok) return response;
      if (!RETRYABLE_STATUS.has(response.status)) {
        throw new RegistryHttpError(`HTTP ${response.status} from ${url}`, url, response.status);
      }
      lastError = new RegistryHttpError(`HTTP ${response.status} from ${url}`, url, response.status);
    } catch (error) {
      if (error instanceof RegistryHttpError && error.status !== null && !RETRYABLE_STATUS.has(error.status)) {
        throw error;
      }
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new RegistryHttpError(`Request failed: ${url}`, url, null);
}

export async function registryFetchJson<T>(
  url: string,
  options: RegistryFetchOptions = {},
  body?: RegistryJsonBody,
): Promise<T> {
  const response = await registryFetch(url, options, body);
  return (await response.json()) as T;
}
