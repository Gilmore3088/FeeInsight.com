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
 * MAILERLITE_MARKETING_GROUP_ID, when set, replaces the national audience with that one group
 * (for a test list). Unset, the national email goes to `NATIONAL_GROUP_NAME`.
 */
export function marketingGroupOverride(): string | null {
  return (process.env.MAILERLITE_MARKETING_GROUP_ID || "").trim() || null;
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
  type: string;
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
    type: raw.type,
    subjects: (raw.emails ?? []).map((email) => email.subject ?? "").filter(Boolean),
    html: raw.emails?.[0]?.content ?? "",
    groupIds: Array.isArray(groupArg) ? groupArg.map(String) : [],
    settings: raw.settings ?? {},
  };
}

/**
 * Replaces a draft's html, keeping its subjects, audience and (for an A/B draft, whose two
 * variants share the html) its test settings. State editions are regular drafts.
 */
export async function updateDraftHtml(id: string, draft: DraftContent, html: string, fetcher?: FetchLike): Promise<void> {
  const [subjectA, subjectB] = draft.subjects;
  const s = draft.settings;
  const email = {
    subject: subjectA,
    from_name: MARKETING_SENDER.fromName,
    from: MARKETING_SENDER.from,
    reply_to: MARKETING_SENDER.replyTo,
    content: html,
  };
  const body = draft.type === "ab"
    ? {
        name: draft.name,
        type: "ab",
        groups: draft.groupIds,
        emails: [email],
        ab_settings: {
          test_type: s.test_type ?? "subject",
          select_winner_by: s.select_winner_by ?? "c",
          after_time_amount: s.after_time_amount ?? 4,
          after_time_unit: s.after_time_unit ?? "h",
          test_split: s.test_split ?? 20,
          b_value: { subject: subjectB },
        },
      }
    : { name: draft.name, type: "regular", groups: draft.groupIds, emails: [email] };
  await call(`campaigns/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }, fetcher);
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

export interface MailerLiteGroup {
  id: string;
  name: string;
  activeCount: number;
}

/** Every MailerLite group, with its active subscriber count. */
export async function listGroups(fetcher?: FetchLike): Promise<MailerLiteGroup[]> {
  const groups: MailerLiteGroup[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const body = await call<{ data?: Array<{ id: string; name: string; active_count?: number }>; meta?: { last_page?: number } }>(
      `groups?limit=100&page=${page}`,
      {},
      fetcher,
    );
    for (const group of body.data ?? []) groups.push({ id: String(group.id), name: group.name, activeCount: group.active_count ?? 0 });
    if (!body.meta?.last_page || page >= body.meta.last_page) break;
  }
  return groups;
}

export function toStateGroups(groups: MailerLiteGroup[]): StateGroup[] {
  return groups
    .filter((group) => group.name.startsWith(STATE_GROUP_PREFIX))
    .map((group) => ({ stateCode: group.name.slice(STATE_GROUP_PREFIX.length), groupId: group.id, activeCount: group.activeCount }));
}

/** Every state group, with its active subscriber count. */
export async function listStateGroups(fetcher?: FetchLike): Promise<StateGroup[]> {
  return toStateGroups(await listGroups(fetcher));
}

/** The group's id by name, creating it the first time. */
export async function ensureGroupNamed(name: string, fetcher?: FetchLike, known?: MailerLiteGroup[]): Promise<string> {
  const existing = (known ?? (await listGroups(fetcher))).find((group) => group.name === name);
  if (existing) return existing.id;
  const body = await call<{ data: { id: string } }>("groups", { method: "POST", body: JSON.stringify({ name }) }, fetcher);
  return String(body.data.id);
}

/** The state's group id, creating the group the first time a reader picks that state. */
export async function ensureStateGroup(stateCode: string, fetcher?: FetchLike): Promise<string> {
  return ensureGroupNamed(stateGroupName(stateCode), fetcher);
}

// ---------------------------------------------------------------- national audience

/**
 * Readers who haven't picked a state. The monthly national email goes to this group (plus the
 * state groups whose state has too little data for its own edition), so each reader gets one
 * marketing email a month: their state's edition, or the national one. The lead sync keeps a
 * reader in this group exactly while they are in no state group.
 */
export const NATIONAL_GROUP_NAME = "Fee Insight · Monthly · National";

/**
 * The national email's own group: the override when set, else the national group, made the
 * first time unless `create` is false (a dry run), when a missing group gives null.
 */
export async function nationalGroupId(fetcher?: FetchLike, known?: MailerLiteGroup[], create = true): Promise<string | null> {
  const override = marketingGroupOverride();
  if (override) return override;
  if (create) return ensureGroupNamed(NATIONAL_GROUP_NAME, fetcher, known);
  return (known ?? (await listGroups(fetcher))).find((group) => group.name === NATIONAL_GROUP_NAME)?.id ?? null;
}
