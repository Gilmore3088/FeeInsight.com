import { getResendApiKey } from "./resend";

/**
 * The last emails Resend sent for us, read live from Resend's list endpoint
 * (GET /emails). Nothing is stored on our side; when Resend can't be reached the
 * result says so instead of showing an empty log.
 */

export interface SentEmail {
  id: string;
  to: string[];
  subject: string;
  createdAt: string | null;
  /** Resend's latest delivery event, e.g. delivered, bounced, opened. */
  lastEvent: string | null;
}

export type SentEmailLog =
  | { status: "ok"; emails: SentEmail[] }
  | { status: "not_configured" | "failed"; reason: string };

const RESEND_LIST_ENDPOINT = "https://api.resend.com/emails";

/** Resend sends Postgres-style times ("2026-10-06 12:00:01.5+00"); JavaScript needs "T" and "+00:00". */
function toIso(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseSentEmails(payload: unknown): SentEmail[] {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      id: String(row.id ?? ""),
      to: Array.isArray(row.to) ? row.to.map(String) : row.to ? [String(row.to)] : [],
      subject: String(row.subject ?? ""),
      createdAt: toIso(row.created_at),
      lastEvent: row.last_event ? String(row.last_event) : null,
    }));
}

export async function getSentEmailLog(limit = 25): Promise<SentEmailLog> {
  const apiKey = getResendApiKey();
  if (!apiKey) return { status: "not_configured", reason: "RESEND_API_KEY is not set." };
  try {
    const response = await fetch(`${RESEND_LIST_ENDPOINT}?limit=${limit}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403
        ? " The key may be limited to sending; a key with full access can list sent emails."
        : "";
      return { status: "failed", reason: `Resend answered ${response.status}.${hint}` };
    }
    return { status: "ok", emails: parseSentEmails(await response.json()) };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "Resend could not be reached." };
  }
}
