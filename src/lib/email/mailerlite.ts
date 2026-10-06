/**
 * Optional MailerLite sync for confirmed email-capture leads. Off unless
 * MAILERLITE_SYNC_ENABLED=true and MAILERLITE_API_KEY is set. Leads sync only
 * after double opt-in (confirm) and are marked unsubscribed on unsubscribe, so
 * MailerLite never holds an address that has not confirmed.
 *
 * Plain fetch, no SDK. Never throws into request paths.
 */
import { listStateGroups, stateGroupName } from "@/lib/agents/marketing/mailerlite-campaigns";

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
  /**
   * Two-letter state the reader chose; they join that state's group for its monthly edition
   * and leave any other state group. Null leaves their state group as it is.
   */
  state?: string | null;
  /**
   * True only right after the reader clicked a confirm link. MailerLite keeps an address that
   * unsubscribed earlier unsubscribed unless the upsert says to resubscribe it, and only a
   * fresh double opt-in may do that.
   */
  reconfirmed?: boolean;
}

export function isMailerLiteSyncEnabled() {
  return (
    (process.env.MAILERLITE_SYNC_ENABLED || "").trim().toLowerCase() === "true" &&
    Boolean((process.env.MAILERLITE_API_KEY || "").trim())
  );
}

// Each lead joins one group, so it runs one nurture sequence at a time. Highest intent
// wins: report requests, then institution/state watchers, then the newsletter group.
const REPORT_GROUP_SOURCES = new Set(["report", "report_national", "report_district", "capture_report_sample"]);
const WATCHER_GROUP_SOURCES = new Set(["capture_institution", "capture_state"]);

export function mailerLiteGroupForSource(source?: string | null): string {
  const env = (name: string) => (process.env[name] || "").trim();
  const sources = new Set((source || "").split(",").map((s) => s.trim()).filter(Boolean));
  const has = (set: Set<string>) => [...sources].some((s) => set.has(s));
  if (has(REPORT_GROUP_SOURCES) && env("MAILERLITE_REPORT_GROUP_ID")) return env("MAILERLITE_REPORT_GROUP_ID");
  if (has(WATCHER_GROUP_SOURCES) && env("MAILERLITE_WATCHER_GROUP_ID")) return env("MAILERLITE_WATCHER_GROUP_ID");
  return env("MAILERLITE_GROUP_ID");
}

export function buildMailerLitePayload(input: MailerLiteLeadInput, stateGroupId?: string | null) {
  const groupId = mailerLiteGroupForSource(input.source);
  const sourceField = (process.env.MAILERLITE_SOURCE_FIELD || "").trim();
  const payload: Record<string, unknown> = {
    email: input.email,
    status: input.subscribed ? "active" : "unsubscribed",
  };
  const groups = [groupId, stateGroupId].filter((id): id is string => Boolean(id));
  if (input.subscribed && groups.length) payload.groups = groups;
  if (input.subscribed && input.reconfirmed) payload.resubscribe = true;
  if (sourceField && input.source) payload.fields = { [sourceField]: input.source };
  return payload;
}

function apiBase() {
  return (process.env.MAILERLITE_SUBSCRIBERS_ENDPOINT || MAILERLITE_SUBSCRIBERS_ENDPOINT).replace(/\/subscribers\/?$/, "");
}

function authHeaders() {
  return {
    Authorization: `Bearer ${(process.env.MAILERLITE_API_KEY || "").trim()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** The chosen state's group (made the first time) and every other state group with readers. */
async function stateGroups(state: string): Promise<{ target: string; others: string[] }> {
  const all = await listStateGroups();
  let target = all.find((group) => group.stateCode === state)?.groupId ?? null;
  if (!target) {
    const response = await fetch(`${apiBase()}/groups`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: stateGroupName(state) }),
    });
    const body = (await response.json().catch(() => null)) as { data?: { id?: unknown } } | null;
    if (!response.ok || body?.data?.id === undefined) throw new Error(`MailerLite group create failed: HTTP ${response.status}`);
    target = String(body.data.id);
  }
  return { target, others: all.filter((group) => group.groupId !== target && group.activeCount > 0).map((group) => group.groupId) };
}

/** Upserts the subscriber (MailerLite's POST /subscribers is create-or-update). */
export async function syncLeadToMailerLite(input: MailerLiteLeadInput): Promise<MailerLiteSyncResult> {
  if (!isMailerLiteSyncEnabled()) {
    return { status: "disabled", reason: "MAILERLITE_SYNC_ENABLED is not true or MAILERLITE_API_KEY is missing." };
  }
  try {
    // A state group that can't be found or made shouldn't block the signup itself.
    const state = input.subscribed && input.state
      ? await stateGroups(input.state).catch(() => null)
      : null;
    const response = await fetch(process.env.MAILERLITE_SUBSCRIBERS_ENDPOINT || MAILERLITE_SUBSCRIBERS_ENDPOINT, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(buildMailerLitePayload(input, state?.target ?? null)),
    });
    const body = (await response.json().catch(() => null)) as {
      data?: { id?: unknown; status?: unknown };
      message?: unknown;
    } | null;
    if (!response.ok) {
      const message = typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
      return { status: "failed", error: `MailerLite sync failed: ${message}` };
    }
    const id = typeof body?.data?.id === "string" || typeof body?.data?.id === "number" ? String(body.data.id) : null;
    // MailerLite answers 200 even when it keeps the old status, so check what it stored.
    const stored = typeof body?.data?.status === "string" ? body.data.status : null;
    const wanted = input.subscribed ? "active" : "unsubscribed";
    if (stored && stored !== wanted) {
      return { status: "failed", error: `MailerLite kept this subscriber as "${stored}" instead of "${wanted}".` };
    }
    // A reader belongs to the one state they picked last: leave every other state group.
    if (id && state) {
      await Promise.all(state.others.map((groupId) =>
        fetch(`${apiBase()}/subscribers/${id}/groups/${groupId}`, { method: "DELETE", headers: authHeaders() }).catch(() => null),
      ));
    }
    return { status: "synced", subscriberId: id };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "MailerLite sync failed.",
    };
  }
}
