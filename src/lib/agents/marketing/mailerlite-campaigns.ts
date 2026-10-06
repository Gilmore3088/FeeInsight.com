/**
 * The MailerLite campaign calls Hamilton's marketing agent makes: list its own campaigns,
 * create an A/B subject-test draft, read results, and send a draft James approved.
 * Plain fetch with MAILERLITE_API_KEY (the same key the lead sync uses). Nothing here
 * sends on its own; `sendCampaignNow` is called only by the approval run.
 */

const API = "https://connect.mailerlite.com/api";

/** The verified MailerLite sender. Reply-To stays the contact address. */
export const MARKETING_SENDER = { from: "hello@bankfeeindex.com", fromName: "Fee Insight", replyTo: "hello@bankfeeindex.com" };

/**
 * Who gets the monthly emails: MAILERLITE_MARKETING_GROUP_ID when set, else every signup
 * group (newsletter, report requests, watchers), so no confirmed reader is left out.
 * Each lead sits in one of those groups, so their counts add up without double counting.
 */
export function marketingGroupIds(): string[] {
  const env = (name: string) => (process.env[name] || "").trim();
  if (env("MAILERLITE_MARKETING_GROUP_ID")) return [env("MAILERLITE_MARKETING_GROUP_ID")];
  return [...new Set(["MAILERLITE_GROUP_ID", "MAILERLITE_REPORT_GROUP_ID", "MAILERLITE_WATCHER_GROUP_ID"].map(env).filter(Boolean))];
}

export function mailerLiteConfigured(): boolean {
  return Boolean((process.env.MAILERLITE_API_KEY || "").trim());
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function call<T>(path: string, init: RequestInit = {}, fetcher: FetchLike = fetch): Promise<T> {
  const key = (process.env.MAILERLITE_API_KEY || "").trim();
  if (!key) throw new Error("MAILERLITE_API_KEY is not set.");
  const response = await fetcher(`${API}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
  });
  if (response.status === 204) return null as T;
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) throw new Error(`MailerLite ${init.method ?? "GET"} ${path} answered ${response.status}: ${body?.message ?? "no message"}`);
  return body as T;
}

export interface AgentCampaign {
  id: string;
  name: string;
  status: string;
  type: string;
  previewUrl: string | null;
  recipients: number;
  openRate: number;
  clickRate: number;
  unsubscribeRate: number;
  finishedAt: string | null;
  subjects: string[];
  winnerSubject: string | null;
}

interface RawStats {
  sent?: number;
  open_rate?: { float?: number };
  click_rate?: { float?: number };
  unsubscribe_rate?: { float?: number };
}
interface RawEmail {
  subject?: string;
  preview_url?: string;
  is_winner?: boolean;
  stats?: RawStats;
}
interface RawCampaign {
  id: string;
  name: string;
  status: string;
  type: string;
  finished_at?: string | null;
  emails?: RawEmail[];
  stats?: RawStats;
}

/** Campaign-level stats when MailerLite gives them, else the sum over its emails. */
export function toAgentCampaign(raw: RawCampaign): AgentCampaign {
  const emails = raw.emails ?? [];
  const stats = raw.stats ?? emails[0]?.stats ?? {};
  const recipients = raw.stats?.sent ?? emails.reduce((sum, email) => sum + (email.stats?.sent ?? 0), 0);
  const winner = emails.find((email) => email.is_winner);
  return {
    id: String(raw.id),
    name: raw.name,
    status: raw.status,
    type: raw.type,
    previewUrl: emails[0]?.preview_url ?? null,
    recipients,
    openRate: stats.open_rate?.float ?? 0,
    clickRate: stats.click_rate?.float ?? 0,
    unsubscribeRate: stats.unsubscribe_rate?.float ?? 0,
    finishedAt: raw.finished_at ?? null,
    subjects: emails.map((email) => email.subject ?? "").filter(Boolean),
    winnerSubject: winner?.subject ?? null,
  };
}

/** Every campaign whose name starts with `prefix`, in one status. */
export async function listCampaigns(
  status: "draft" | "sent" | "ready",
  prefix: string,
  fetcher?: FetchLike,
): Promise<AgentCampaign[]> {
  const found: AgentCampaign[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const body = await call<{ data: RawCampaign[]; meta?: { last_page?: number } }>(
      `campaigns?filter[status]=${status}&limit=100&page=${page}`,
      {},
      fetcher,
    );
    for (const raw of body.data ?? []) if (raw.name.startsWith(prefix)) found.push(toAgentCampaign(raw));
    if (!body.meta?.last_page || page >= body.meta.last_page) break;
  }
  return found;
}

export interface DraftInput {
  name: string;
  subjectA: string;
  subjectB: string;
  html: string;
  groupIds: string[];
}

/**
 * Creates an A/B subject-test draft: 20% of the group gets the two subjects, and the one
 * with more clicks after 4 hours goes to the rest. Status stays "draft" until approved.
 */
export async function createAbDraft(input: DraftInput, fetcher?: FetchLike): Promise<AgentCampaign> {
  const body = await call<{ data: RawCampaign }>(
    "campaigns",
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        type: "ab",
        groups: input.groupIds,
        emails: [{
          subject: input.subjectA,
          from_name: MARKETING_SENDER.fromName,
          from: MARKETING_SENDER.from,
          reply_to: MARKETING_SENDER.replyTo,
          content: input.html,
        }],
        ab_settings: {
          test_type: "subject",
          select_winner_by: "c",
          after_time_amount: 4,
          after_time_unit: "h",
          test_split: 20,
          b_value: { subject: input.subjectB },
        },
      }),
    },
    fetcher,
  );
  return toAgentCampaign(body.data);
}

export async function getCampaign(id: string, fetcher?: FetchLike): Promise<AgentCampaign> {
  const body = await call<{ data: RawCampaign }>(`campaigns/${encodeURIComponent(id)}`, {}, fetcher);
  return toAgentCampaign(body.data);
}

export interface DraftContent {
  name: string;
  subjects: string[];
  html: string;
  groupIds: string[];
  settings: Record<string, unknown>;
}

/** A draft's html, subjects and audience, so the send step can finish its footer. */
export async function getDraftContent(id: string, fetcher?: FetchLike): Promise<DraftContent> {
  const body = await call<{
    data: RawCampaign & {
      emails?: Array<RawEmail & { content?: string }>;
      filter?: Array<Array<{ args?: unknown[] }>>;
      settings?: Record<string, unknown>;
    };
  }>(`campaigns/${encodeURIComponent(id)}`, {}, fetcher);
  const raw = body.data;
  const groupArg = raw.filter?.[0]?.[0]?.args?.[1];
  return {
    name: raw.name,
    subjects: (raw.emails ?? []).map((email) => email.subject ?? "").filter(Boolean),
    html: raw.emails?.[0]?.content ?? "",
    groupIds: Array.isArray(groupArg) ? groupArg.map(String) : [],
    settings: raw.settings ?? {},
  };
}

/** Replaces an A/B draft's html (both variants share it), keeping its subjects, audience and test settings. */
export async function updateAbDraftHtml(id: string, draft: DraftContent, html: string, fetcher?: FetchLike): Promise<void> {
  const [subjectA, subjectB] = draft.subjects;
  const s = draft.settings;
  await call(
    `campaigns/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        name: draft.name,
        type: "ab",
        groups: draft.groupIds,
        emails: [{
          subject: subjectA,
          from_name: MARKETING_SENDER.fromName,
          from: MARKETING_SENDER.from,
          reply_to: MARKETING_SENDER.replyTo,
          content: html,
        }],
        ab_settings: {
          test_type: s.test_type ?? "subject",
          select_winner_by: s.select_winner_by ?? "c",
          after_time_amount: s.after_time_amount ?? 4,
          after_time_unit: s.after_time_unit ?? "h",
          test_split: s.test_split ?? 20,
          b_value: { subject: subjectB },
        },
      }),
    },
    fetcher,
  );
}

/** Sends a draft now. Only the approval run calls this. */
export async function sendCampaignNow(id: string, fetcher?: FetchLike): Promise<void> {
  await call(`campaigns/${encodeURIComponent(id)}/schedule`, { method: "POST", body: JSON.stringify({ delivery: "instant" }) }, fetcher);
}

/** Active subscribers across the given groups; null when MailerLite can't be read. */
export async function activeSubscriberCount(groupIds: string[], fetcher?: FetchLike): Promise<number | null> {
  const body = await call<{ data?: Array<{ id: string; active_count?: number }> }>("groups?limit=100", {}, fetcher).catch(() => null);
  if (!body) return null;
  const counts = groupIds.map((id) => body.data?.find((row) => String(row.id) === id)?.active_count);
  return counts.every((count) => typeof count === "number") ? counts.reduce<number>((sum, count) => sum + (count ?? 0), 0) : null;
}

/** A regular (single-subject) draft, for audiences too small for an A/B test. */
export async function createRegularDraft(
  input: { name: string; subject: string; html: string; groupId: string },
  fetcher?: FetchLike,
): Promise<AgentCampaign> {
  const body = await call<{ data: RawCampaign }>(
    "campaigns",
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        type: "regular",
        groups: [input.groupId],
        emails: [{
          subject: input.subject,
          from_name: MARKETING_SENDER.fromName,
          from: MARKETING_SENDER.from,
          reply_to: MARKETING_SENDER.replyTo,
          content: input.html,
        }],
      }),
    },
    fetcher,
  );
  return toAgentCampaign(body.data);
}

// ---------------------------------------------------------------- state groups

/** Readers who chose a state sit in that state's group, e.g. "Fee Insight · State · TX". */
export const STATE_GROUP_PREFIX = "Fee Insight · State · ";

export function stateGroupName(stateCode: string): string {
  return `${STATE_GROUP_PREFIX}${stateCode}`;
}

export interface StateGroup {
  stateCode: string;
  groupId: string;
  activeCount: number;
}

/** Every state group, with its active subscriber count. */
export async function listStateGroups(fetcher?: FetchLike): Promise<StateGroup[]> {
  const groups: StateGroup[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const body = await call<{ data?: Array<{ id: string; name: string; active_count?: number }>; meta?: { last_page?: number } }>(
      `groups?limit=100&page=${page}`,
      {},
      fetcher,
    );
    for (const group of body.data ?? []) {
      if (!group.name.startsWith(STATE_GROUP_PREFIX)) continue;
      groups.push({ stateCode: group.name.slice(STATE_GROUP_PREFIX.length), groupId: String(group.id), activeCount: group.active_count ?? 0 });
    }
    if (!body.meta?.last_page || page >= body.meta.last_page) break;
  }
  return groups;
}

/** The state's group id, creating the group the first time a reader picks that state. */
export async function ensureStateGroup(stateCode: string, fetcher?: FetchLike): Promise<string> {
  const existing = (await listStateGroups(fetcher)).find((group) => group.stateCode === stateCode);
  if (existing) return existing.groupId;
  const body = await call<{ data: { id: string } }>("groups", { method: "POST", body: JSON.stringify({ name: stateGroupName(stateCode) }) }, fetcher);
  return String(body.data.id);
}
