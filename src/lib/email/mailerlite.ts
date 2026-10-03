/**
 * Optional MailerLite sync for confirmed email-capture leads. Off unless
 * MAILERLITE_SYNC_ENABLED=true and MAILERLITE_API_KEY is set. Leads sync only
 * after double opt-in (confirm) and are marked unsubscribed on unsubscribe, so
 * MailerLite never holds an address that has not confirmed.
 *
 * Plain fetch, no SDK. Never throws into request paths.
 */
const MAILERLITE_SUBSCRIBERS_ENDPOINT = "https://connect.mailerlite.com/api/subscribers";

export type MailerLiteSyncResult =
  | { status: "synced"; subscriberId: string | null }
  | { status: "disabled"; reason: string }
  | { status: "failed"; error: string };

export interface MailerLiteLeadInput {
  email: string;
  subscribed: boolean;
  /** Comma-separated lead sources, stored on a MailerLite custom field when configured. */
  source?: string | null;
}

export function isMailerLiteSyncEnabled() {
  return (
    (process.env.MAILERLITE_SYNC_ENABLED || "").trim().toLowerCase() === "true" &&
    Boolean((process.env.MAILERLITE_API_KEY || "").trim())
  );
}

// Each lead joins one group, so it runs one nurture sequence at a time. Highest intent
// wins: report requests, then institution/state watchers, then the newsletter group.
const REPORT_GROUP_SOURCES = new Set(["report", "capture_report_sample"]);
const WATCHER_GROUP_SOURCES = new Set(["capture_institution", "capture_state"]);

export function mailerLiteGroupForSource(source?: string | null): string {
  const env = (name: string) => (process.env[name] || "").trim();
  const sources = new Set((source || "").split(",").map((s) => s.trim()).filter(Boolean));
  const has = (set: Set<string>) => [...sources].some((s) => set.has(s));
  if (has(REPORT_GROUP_SOURCES) && env("MAILERLITE_REPORT_GROUP_ID")) return env("MAILERLITE_REPORT_GROUP_ID");
  if (has(WATCHER_GROUP_SOURCES) && env("MAILERLITE_WATCHER_GROUP_ID")) return env("MAILERLITE_WATCHER_GROUP_ID");
  return env("MAILERLITE_GROUP_ID");
}

export function buildMailerLitePayload(input: MailerLiteLeadInput) {
  const groupId = mailerLiteGroupForSource(input.source);
  const sourceField = (process.env.MAILERLITE_SOURCE_FIELD || "").trim();
  const payload: Record<string, unknown> = {
    email: input.email,
    status: input.subscribed ? "active" : "unsubscribed",
  };
  if (input.subscribed && groupId) payload.groups = [groupId];
  if (sourceField && input.source) payload.fields = { [sourceField]: input.source };
  return payload;
}

/** Upserts the subscriber (MailerLite's POST /subscribers is create-or-update). */
export async function syncLeadToMailerLite(input: MailerLiteLeadInput): Promise<MailerLiteSyncResult> {
  if (!isMailerLiteSyncEnabled()) {
    return { status: "disabled", reason: "MAILERLITE_SYNC_ENABLED is not true or MAILERLITE_API_KEY is missing." };
  }
  try {
    const response = await fetch(process.env.MAILERLITE_SUBSCRIBERS_ENDPOINT || MAILERLITE_SUBSCRIBERS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(process.env.MAILERLITE_API_KEY || "").trim()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(buildMailerLitePayload(input)),
    });
    const body = (await response.json().catch(() => null)) as {
      data?: { id?: unknown };
      message?: unknown;
    } | null;
    if (!response.ok) {
      const message = typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
      return { status: "failed", error: `MailerLite sync failed: ${message}` };
    }
    const id = body?.data?.id;
    return { status: "synced", subscriberId: typeof id === "string" ? id : null };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "MailerLite sync failed.",
    };
  }
}
