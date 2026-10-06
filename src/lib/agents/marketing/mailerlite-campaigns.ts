/**
 * The MailerLite campaign calls Hamilton's marketing agent makes: list its own campaigns,
 * create an A/B subject-test draft, read results, and send a draft James approved.
 * Plain fetch with MAILERLITE_API_KEY (the same key the lead sync uses). Nothing here
 * sends on its own; `sendCampaignNow` is called only by the approval run.
 */

const API = "https://connect.mailerlite.com/api";

/** The verified MailerLite sender. Reply-To stays the contact address. */
export const MARKETING_SENDER = { from: "hello@bankfeeindex.com", fromName: "Fee Insight", replyTo: "hello@bankfeeindex.com" };

export function marketingGroupId(): string | null {
  return (process.env.MAILERLITE_MARKETING_GROUP_ID || process.env.MAILERLITE_GROUP_ID || "").trim() || null;
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
  groupId: string;
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
        groups: [input.groupId],
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

/** Sends a draft now. Only the approval run calls this. */
export async function sendCampaignNow(id: string, fetcher?: FetchLike): Promise<void> {
  await call(`campaigns/${encodeURIComponent(id)}/schedule`, { method: "POST", body: JSON.stringify({ delivery: "instant" }) }, fetcher);
}

export async function activeSubscriberCount(groupId: string, fetcher?: FetchLike): Promise<number | null> {
  const body = await call<{ data?: Array<{ id: string; active_count?: number }> }>("groups?limit=100", {}, fetcher).catch(() => null);
  const group = body?.data?.find((row) => String(row.id) === groupId);
  return typeof group?.active_count === "number" ? group.active_count : null;
}
