/**
 * Our own log of outgoing email (migration 20270110000034, table `email_send_log`).
 * `sendResendEmail` records one row per attempt; the Resend webhook
 * (/api/webhooks/resend) stamps the latest delivery event on the row by Resend's id.
 * The Publishing room reads it, so the sent-email list needs no Resend read key.
 * Before the migration the reader says so and the writers write nothing.
 */
import { sql } from "./connection";

type SqlTag = typeof sql;

export type EmailSendStatus = "sent" | "failed" | "not_configured";

export interface EmailSendLogEntry {
  label: string | null;
  recipient: string | null;
  subject: string | null;
  status: EmailSendStatus;
  providerId: string | null;
  error: string | null;
}

export interface EmailSendLogRow extends EmailSendLogEntry {
  id: number;
  createdAt: string;
  lastEvent: string | null;
  lastEventAt: string | null;
}

export interface EmailSendCounts {
  /** All attempts on record (Resend configured or not). */
  total: number;
  /** Attempts made while Resend was configured (sent + failed). */
  configured: number;
  notConfigured: number;
  /** Resend accepted the send (answered with an id). */
  accepted: number;
  failed: number;
  /** Rows whose Resend webhook reported email.delivered (or a later open/click). */
  delivered: number;
  /** Rows Resend reported as bounced, complained or failed after accepting. */
  undelivered: number;
  /** Rows with any webhook event at all; 0 means no event has arrived yet. */
  withEvents: number;
}

export type EmailSendLog =
  | { status: "ok"; rows: EmailSendLogRow[]; counts: EmailSendCounts }
  | { status: "not_migrated" }
  | { status: "failed"; reason: string };

/** Events that prove the mail reached the inbox (opens and clicks come after delivery). */
export const DELIVERED_EVENTS = ["email.delivered", "email.opened", "email.clicked"] as const;
export const UNDELIVERED_EVENTS = ["email.bounced", "email.complained", "email.failed"] as const;

/** True when the app has a database to log to (unset in unit tests and some previews). */
export function emailSendLogConfigured(): boolean {
  return Boolean((process.env.DATABASE_URL || "").trim());
}

export async function insertEmailSendLog(entry: EmailSendLogEntry, db: SqlTag = sql): Promise<void> {
  await db`
    INSERT INTO email_send_log (label, recipient, subject, status, provider_id, error)
    VALUES (${entry.label}, ${entry.recipient}, ${entry.subject}, ${entry.status}, ${entry.providerId}, ${entry.error})
    ON CONFLICT (provider_id) WHERE provider_id IS NOT NULL DO NOTHING`;
}

/**
 * Stamps a Resend webhook event on the logged send with that Resend id. An older event
 * arriving late never overwrites a newer one. Returns the number of rows changed.
 */
export async function recordEmailEvent(
  providerId: string,
  event: string,
  at: Date,
  db: SqlTag = sql,
): Promise<number> {
  const rows = await db`
    UPDATE email_send_log
       SET last_event = ${event}, last_event_at = ${at.toISOString()}
     WHERE provider_id = ${providerId}
       AND (last_event_at IS NULL OR last_event_at <= ${at.toISOString()})
    RETURNING id`;
  return rows.length;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toStatus(value: unknown): EmailSendStatus {
  return value === "sent" || value === "failed" ? value : "not_configured";
}

export function mapEmailSendLogRow(row: Record<string, unknown>): EmailSendLogRow {
  const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
  return {
    id: Number(row.id),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    label: text(row.label),
    recipient: text(row.recipient),
    subject: text(row.subject),
    status: toStatus(row.status),
    providerId: text(row.provider_id),
    error: text(row.error),
    lastEvent: text(row.last_event),
    lastEventAt: iso(row.last_event_at),
  };
}

export function mapEmailSendCounts(row: Record<string, unknown> | undefined): EmailSendCounts {
  const n = (value: unknown) => Number(value ?? 0) || 0;
  const accepted = n(row?.accepted);
  const failed = n(row?.failed);
  return {
    total: n(row?.total),
    configured: accepted + failed,
    notConfigured: n(row?.not_configured),
    accepted,
    failed,
    delivered: n(row?.delivered),
    undelivered: n(row?.undelivered),
    withEvents: n(row?.with_events),
  };
}

/** The latest sends (newest first) and the all-time counts behind the Publishing room. */
export async function getEmailSendLog(limit = 25, db: SqlTag = sql): Promise<EmailSendLog> {
  if (!emailSendLogConfigured()) return { status: "failed", reason: "DATABASE_URL is not set." };
  try {
    const [ready] = await db`SELECT to_regclass('public.email_send_log') IS NOT NULL AS ready`;
    if (!ready?.ready) return { status: "not_migrated" };
    const [rows, [counts]] = await Promise.all([
      db`
        SELECT id, created_at, label, recipient, subject, status, provider_id, error, last_event, last_event_at
          FROM email_send_log
         ORDER BY created_at DESC, id DESC
         LIMIT ${limit}`,
      db`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'sent')::int AS accepted,
               COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
               COUNT(*) FILTER (WHERE status = 'not_configured')::int AS not_configured,
               COUNT(*) FILTER (WHERE last_event = ANY(${[...DELIVERED_EVENTS]}))::int AS delivered,
               COUNT(*) FILTER (WHERE last_event = ANY(${[...UNDELIVERED_EVENTS]}))::int AS undelivered,
               COUNT(*) FILTER (WHERE last_event IS NOT NULL)::int AS with_events
          FROM email_send_log`,
    ]);
    return {
      status: "ok",
      rows: rows.map((row) => mapEmailSendLogRow(row as Record<string, unknown>)),
      counts: mapEmailSendCounts(counts as Record<string, unknown> | undefined),
    };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "The email log could not be read." };
  }
}
