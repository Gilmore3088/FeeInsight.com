/**
 * Optional MailerLite sync for confirmed email-capture leads. Off unless
 * MAILERLITE_SYNC_ENABLED=true and MAILERLITE_API_KEY is set. Leads sync only
 * after double opt-in (confirm) and are marked unsubscribed on unsubscribe, so
 * MailerLite never holds an address that has not confirmed.
 *
 * Plain fetch, no SDK. Never throws into request paths.
 */
import {
  STATE_GROUP_PREFIX,
  listGroups,
  nationalGroupId,
  stateGroupName,
  toStateGroups,
} from "@/lib/agents/marketing/mailerlite-campaigns";

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
  /**
   * Custom fields the lifecycle emails read (report_name, report_url, report_finding,
   * follow_name, follow_url). Each field must exist in MailerLite; a null value is left out.
   */
  fields?: Record<string, string | null>;
}

export function isMailerLiteSyncEnabled() {
  return (
    (process.env.MAILERLITE_SYNC_ENABLED || "").trim().toLowerCase() === "true" &&
    Boolean((process.env.MAILERLITE_API_KEY || "").trim())
  );
}

// Each person runs one lifecycle sequence at a time (James, Oct 17). Highest intent wins:
// Pro customers, then report requests, then institution/state followers, then free research
// subscribers. Sources outside these sets (account sign-ups, contact forms, paid report quotes)
// join no lifecycle group; they still get the monthly edition.
const REPORT_GROUP_SOURCES = new Set(["report_national", "report_district", "capture_report_sample", "capture_homepage"]);
const WATCHER_GROUP_SOURCES = new Set(["capture_institution", "capture_state"]);
const NEWSLETTER_GROUP_SOURCES = new Set(["newsletter", "capture_national_index"]);

const env = (name: string) => (process.env[name] || "").trim();

/** Lifecycle group ids, highest intent first; unset ones are left out. */
export function lifecycleGroupIds(): string[] {
  return ["MAILERLITE_PRO_GROUP_ID", "MAILERLITE_REPORT_GROUP_ID", "MAILERLITE_WATCHER_GROUP_ID", "MAILERLITE_GROUP_ID"]
    .map(env)
    .filter(Boolean);
}

/** The lifecycle group a lead's sources call for, or "" when none does. */
export function mailerLiteGroupForSource(source?: string | null): string {
  const sources = new Set((source || "").split(",").map((s) => s.trim()).filter(Boolean));
  const has = (set: Set<string>) => [...sources].some((s) => set.has(s));
  if (has(REPORT_GROUP_SOURCES) && env("MAILERLITE_REPORT_GROUP_ID")) return env("MAILERLITE_REPORT_GROUP_ID");
  if (has(WATCHER_GROUP_SOURCES) && env("MAILERLITE_WATCHER_GROUP_ID")) return env("MAILERLITE_WATCHER_GROUP_ID");
  if (has(NEWSLETTER_GROUP_SOURCES)) return env("MAILERLITE_GROUP_ID");
  return "";
}

/**
 * Which lifecycle group to join and which to leave, given the ones the subscriber is in now.
 * Nobody joins a sequence while in one of equal or higher intent (a Pro customer gets no
 * nurture at all), and joining a higher one leaves the lower ones.
 */
export function planLifecycleGroups(target: string, current: Set<string>): { join: string | null; leave: string[] } {
  const ranked = lifecycleGroupIds();
  const rank = (id: string) => ranked.indexOf(id);
  if (!target || rank(target) < 0) return { join: null, leave: [] };
  const held = ranked.filter((id) => current.has(id));
  if (held.some((id) => rank(id) <= rank(target))) return { join: null, leave: [] };
  return { join: target, leave: held };
}

export function buildMailerLitePayload(input: MailerLiteLeadInput, stateGroupId?: string | null) {
  const sourceField = env("MAILERLITE_SOURCE_FIELD");
  const payload: Record<string, unknown> = {
    email: input.email,
    status: input.subscribed ? "active" : "unsubscribed",
  };
  // The lifecycle group is added after the upsert (planLifecycleGroups), once the subscriber's
  // current groups are known, so nobody is dropped into an overlapping sequence.
  if (input.subscribed && stateGroupId) payload.groups = [stateGroupId];
  if (input.subscribed && input.reconfirmed) payload.resubscribe = true;
  const fields: Record<string, string> = {};
  if (sourceField && input.source) fields[sourceField] = input.source;
  for (const [key, value] of Object.entries(input.fields ?? {})) if (value) fields[key] = value;
  if (Object.keys(fields).length) payload.fields = fields;
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

/** The chosen state's group (made the first time) and every other state group. */
async function stateGroups(state: string): Promise<{ target: string; others: string[] }> {
  const all = toStateGroups(await listGroups());
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
  return { target, others: all.filter((group) => group.groupId !== target).map((group) => group.groupId) };
}

/** Puts the subscriber in the national group when they have no state, and takes them out when they do. */
async function syncNationalGroup(id: string, inState: boolean, joined: Set<string> | null): Promise<void> {
  const national = await nationalGroupId();
  if (!national) return;
  const isIn = joined ? joined.has(national) : null;
  if (inState && isIn !== false) {
    await fetch(`${apiBase()}/subscribers/${id}/groups/${national}`, { method: "DELETE", headers: authHeaders() });
  } else if (!inState && !isIn) {
    await fetch(`${apiBase()}/subscribers/${id}/groups/${national}`, { method: "POST", headers: authHeaders() });
  }
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
      data?: { id?: unknown; status?: unknown; groups?: Array<{ id?: unknown; name?: unknown }> };
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
      // The upsert answers with the subscriber's groups; when it does, only those are touched.
      const joined = Array.isArray(body?.data?.groups)
        ? new Set(body.data.groups.map((group) => String(group.id)))
        : null;
      const leave = joined ? state.others.filter((groupId) => joined.has(groupId)) : state.others;
      await Promise.all(leave.map((groupId) =>
        fetch(`${apiBase()}/subscribers/${id}/groups/${groupId}`, { method: "DELETE", headers: authHeaders() }).catch(() => null),
      ));
    }
    if (id && input.subscribed && Array.isArray(body?.data?.groups)) {
      const current = new Set(body.data.groups.map((group) => String(group.id)));
      await applyLifecycleGroups(id, planLifecycleGroups(mailerLiteGroupForSource(input.source), current)).catch(() => null);
    }
    // One marketing email a month: a reader with no state gets the national email (its own
    // group); a reader in a state group gets that state's edition instead.
    if (id && input.subscribed) {
      const joined = Array.isArray(body?.data?.groups) ? body.data.groups : null;
      const inState = Boolean(state) || Boolean(joined?.some((group) => String(group.name ?? "").startsWith(STATE_GROUP_PREFIX)));
      // Without the groups in the answer (and no state picked now) there's no telling; leave it.
      if (state || joined) {
        await syncNationalGroup(id, inState, joined ? new Set(joined.map((group) => String(group.id))) : null).catch(() => null);
      }
    }
    return { status: "synced", subscriberId: id };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "MailerLite sync failed.",
    };
  }
}

async function applyLifecycleGroups(id: string, plan: { join: string | null; leave: string[] }): Promise<void> {
  await Promise.all(plan.leave.map((groupId) =>
    fetch(`${apiBase()}/subscribers/${id}/groups/${groupId}`, { method: "DELETE", headers: authHeaders() }).catch(() => null),
  ));
  if (plan.join) await fetch(`${apiBase()}/subscribers/${id}/groups/${plan.join}`, { method: "POST", headers: authHeaders() });
}

/**
 * A new Hamilton Pro customer joins the Pro customers group (its onboarding sequence) and
 * leaves every other lifecycle group, which also ends generic upgrade prompts. It never sets a
 * status: an address that unsubscribed stays unsubscribed.
 */
export async function syncProCustomerToMailerLite(email: string): Promise<MailerLiteSyncResult> {
  const pro = env("MAILERLITE_PRO_GROUP_ID");
  if (!isMailerLiteSyncEnabled() || !pro) {
    return { status: "disabled", reason: "MailerLite sync is off or MAILERLITE_PRO_GROUP_ID is unset." };
  }
  try {
    const response = await fetch(process.env.MAILERLITE_SUBSCRIBERS_ENDPOINT || MAILERLITE_SUBSCRIBERS_ENDPOINT, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email }),
      // Runs inside the Stripe webhook response; a slow MailerLite must not hold it.
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json().catch(() => null)) as {
      data?: { id?: unknown; groups?: Array<{ id?: unknown }> };
      message?: unknown;
    } | null;
    if (!response.ok) {
      const message = typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
      return { status: "failed", error: `MailerLite Pro sync failed: ${message}` };
    }
    const id = typeof body?.data?.id === "string" || typeof body?.data?.id === "number" ? String(body.data.id) : null;
    if (!id) return { status: "failed", error: "MailerLite returned no subscriber id." };
    const current = new Set((body?.data?.groups ?? []).map((group) => String(group.id)));
    await applyLifecycleGroups(id, planLifecycleGroups(pro, current));
    return { status: "synced", subscriberId: id };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "MailerLite Pro sync failed." };
  }
}
