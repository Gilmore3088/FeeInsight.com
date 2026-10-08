import type { ContentDraft, ContentDraftStatus } from "@/lib/data-store/content-drafts";
import { isGrowthAgent, isQueueKind, type GrowthAgent, type QueueKind } from "@/lib/agents/growth/roster";

/** The page's filter, from `?agent=` and `?kind=`. Anything not on the roster or kind list is ignored. */
export interface QueueFilter {
  agent: GrowthAgent | null;
  kind: QueueKind | null;
}

/** Which part of the page renders, from `?view=`. Only one renders at a time. */
export const GROWTH_VIEWS = ["review", "approved", "done", "skipped", "team"] as const;
export type GrowthView = (typeof GROWTH_VIEWS)[number];
export const DEFAULT_VIEW: GrowthView = "review";

/** Everything the page's URL carries. */
export interface GrowthPageState {
  view: GrowthView;
  filter: QueueFilter;
}

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseQueueFilter(params: Params): QueueFilter {
  const agent = first(params.agent);
  const kind = first(params.kind);
  return { agent: isGrowthAgent(agent) ? agent : null, kind: isQueueKind(kind) ? kind : null };
}

/** `?view=`, falling back to the review list for anything unknown. */
export function parseGrowthView(params: Params): GrowthView {
  const view = first(params.view);
  return (GROWTH_VIEWS as readonly string[]).includes(view ?? "") ? (view as GrowthView) : DEFAULT_VIEW;
}

export function parseGrowthPage(params: Params): GrowthPageState {
  return { view: parseGrowthView(params), filter: parseQueueFilter(params) };
}

export function filterQueue(items: ContentDraft[], filter: QueueFilter): ContentDraft[] {
  return items.filter((item) => (!filter.agent || item.agent === filter.agent) && (!filter.kind || item.kind === filter.kind));
}

/** The link for a page state. The default view stays out of the URL; the filter carries across views. */
function pageHref(view: GrowthView, filter: QueueFilter): string {
  const query = new URLSearchParams();
  if (view !== DEFAULT_VIEW) query.set("view", view);
  if (filter.agent) query.set("agent", filter.agent);
  if (filter.kind) query.set("kind", filter.kind);
  const text = query.toString();
  return text ? `/admin/growth?${text}` : "/admin/growth";
}

/** The link for a filter, keeping the other one and the view. `null` clears that part. */
export function filterHref(filter: QueueFilter, change: Partial<QueueFilter>, view: GrowthView = DEFAULT_VIEW): string {
  return pageHref(view, { ...filter, ...change });
}

/** The link to another view, keeping the filter. */
export function viewHref(state: GrowthPageState, view: GrowthView): string {
  return pageHref(view, state.filter);
}

export interface QueueSection {
  view: Exclude<GrowthView, "team">;
  status: ContentDraftStatus;
  title: string;
  note: string;
  empty: string;
}

export const QUEUE_SECTIONS: QueueSection[] = [
  {
    view: "review",
    status: "draft",
    title: "To review",
    note: "A skip reason becomes a lesson in that agent's next brief. Nothing posts or sends from this page.",
    empty: "Nothing waiting for review.",
  },
  {
    view: "approved",
    status: "approved",
    title: "Approved",
    note: "Post or send it yourself (or merge the PR), then mark it done.",
    empty: "Nothing is approved and waiting to go out.",
  },
  {
    view: "done",
    status: "posted",
    title: "Done",
    note: "Posted, sent or merged. Scored from tracked visits a week later, once weekly scoring is turned on.",
    empty: "Nothing is marked done yet.",
  },
  {
    view: "skipped",
    status: "skipped",
    title: "Skipped",
    note: "Send one back to review to withdraw its lesson.",
    empty: "Nothing has been skipped.",
  },
];

/** The queue section a view shows, or `null` for the team view. */
export function sectionFor(view: GrowthView): QueueSection | null {
  return QUEUE_SECTIONS.find((section) => section.view === view) ?? null;
}

export function label(value: string): string {
  return value.replace(/_/g, " ");
}
