import type { ContentDraft, ContentDraftStatus } from "@/lib/data-store/content-drafts";
import { isGrowthAgent, isQueueKind, type GrowthAgent, type QueueKind } from "@/lib/agents/growth/roster";

/** The page's filter, from `?agent=` and `?kind=`. Anything not on the roster or kind list is ignored. */
export interface QueueFilter {
  agent: GrowthAgent | null;
  kind: QueueKind | null;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseQueueFilter(params: Record<string, string | string[] | undefined>): QueueFilter {
  const agent = first(params.agent);
  const kind = first(params.kind);
  return { agent: isGrowthAgent(agent) ? agent : null, kind: isQueueKind(kind) ? kind : null };
}

export function filterQueue(items: ContentDraft[], filter: QueueFilter): ContentDraft[] {
  return items.filter((item) => (!filter.agent || item.agent === filter.agent) && (!filter.kind || item.kind === filter.kind));
}

/** The link for a filter, keeping the other one. `null` clears that part. */
export function filterHref(filter: QueueFilter, change: Partial<QueueFilter>): string {
  const next = { ...filter, ...change };
  const query = new URLSearchParams();
  if (next.agent) query.set("agent", next.agent);
  if (next.kind) query.set("kind", next.kind);
  const text = query.toString();
  return text ? `/admin/growth?${text}` : "/admin/growth";
}

export const QUEUE_SECTIONS: { status: ContentDraftStatus; title: string; note: string; empty: string }[] = [
  {
    status: "draft",
    title: "To review",
    note: "Approve, edit or skip. A skip reason becomes a lesson in that agent's next brief. Nothing posts or sends from this page.",
    empty: "Nothing is waiting for review.",
  },
  {
    status: "approved",
    title: "Approved",
    note: "Post or send it yourself (or merge the PR), then mark it done.",
    empty: "Nothing is approved and waiting to go out.",
  },
  {
    status: "posted",
    title: "Done",
    note: "Posted, sent or merged. Scored from tracked visits a week later, once weekly scoring is turned on.",
    empty: "Nothing is marked done yet.",
  },
  {
    status: "skipped",
    title: "Skipped",
    note: "Send one back to review to withdraw its lesson.",
    empty: "Nothing has been skipped.",
  },
];

export function label(value: string): string {
  return value.replace(/_/g, " ");
}
