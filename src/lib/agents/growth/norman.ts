import { SITE_URL } from "@/lib/constants";
import type { sql } from "@/lib/data-store/connection";
import { contentSchemaReady, insertContentDraft } from "@/lib/data-store/content-drafts";
import { funnelCounts, lastStepDetail, unsentOutreachLinks, type FunnelCounts } from "@/lib/data-store/growth-intel";
import { fetchText, type Fetcher } from "./contacts";

type SqlTag = typeof sql;

/**
 * NORMAN's weekly conversion check (`growth-os/agents/norman.md`), step `growth-conversion`.
 * Free and deterministic: no model call, nothing posted or sent, no page or price changed.
 *
 * 1. Destinations: every page a buyer is sent to must load. It reads the main buying pages and
 *    the link in every outreach draft not yet sent (James, 22:23 UTC Oct 8: "Every outreach
 *    email must have a verified, working destination"). A link that doesn't load, or loads our
 *    not-found page, is a broken destination and the brief leads with it.
 * 2. The funnel, this week against last week, from our own tables only: tracked visits, snapshot
 *    opens and report clicks, report requests, quotes sent, paid reports (`funnelCounts`). A
 *    table that doesn't exist yet is "not measured", never zero.
 * 3. The week's one fix: the first funnel step where people stop (a step with people before it
 *    and none after it), or the broken destinations. NORMAN's fix for it comes as a pull request
 *    or a preview; this week's counts are its "before", and next week's brief shows the "after"
 *    beside them (`previous` from the last run).
 *
 * The brief lands in the growth queue as NORMAN's `brief`, one a week.
 */

export const CONVERSION_WORKFLOW = "conversion";
const DAY_MS = 86_400_000;
const MAX_LINK_CHECKS = 60;

/** The pages every buyer path runs through. */
export const BUYING_PAGES: readonly string[] = ["/", "/for-institutions", "/subscribe", "/reports", "/institutions"];

/** Funnel steps in order, with how the brief names each. */
export const FUNNEL_STEPS: ReadonlyArray<{ key: keyof FunnelCounts; label: string }> = [
  { key: "trackedVisits", label: "visits from a tracked link" },
  { key: "snapshotOpened", label: "free snapshot opened" },
  { key: "snapshotReportClicks", label: "report click on a snapshot" },
  { key: "reportRequests", label: "report request sent" },
  { key: "quotesSent", label: "quote sent" },
  { key: "paidReports", label: "paid report" },
];

export type Funnel = { [K in keyof FunnelCounts]: number | null };

export interface DestinationCheck {
  url: string;
  draftId: number | null;
  status: number | null;
  ok: boolean;
}

export interface ConversionResult {
  schemaReady: boolean;
  dryRun: boolean;
  weekStart: string;
  thisWeek: Funnel | null;
  lastWeek: Funnel | null;
  /** The funnel the previous brief recorded as its "before", when there was one. */
  previous: Funnel | null;
  destinations: DestinationCheck[];
  broken: DestinationCheck[];
  stopPoint: { from: string; to: string; count: number } | null;
  fix: string;
  draftId: number | null;
  reason: string | null;
}

/** Our not-found page, by its title (src/app/not-found.tsx), in case it is served with a 200. */
const NOT_FOUND = /<title>[^<]*page not found/i;

/** The first step people reach and nobody passes: a count before it and zero after it. */
export function stopPointOf(funnel: Funnel): { from: string; to: string; count: number } | null {
  for (let i = 0; i < FUNNEL_STEPS.length - 1; i += 1) {
    const here = funnel[FUNNEL_STEPS[i].key];
    const next = funnel[FUNNEL_STEPS[i + 1].key];
    if (here !== null && here > 0 && next === 0) return { from: FUNNEL_STEPS[i].label, to: FUNNEL_STEPS[i + 1].label, count: here };
  }
  return null;
}

/** What NORMAN works on this week, in priority order. */
export function fixFor(broken: DestinationCheck[], stop: ConversionResult["stopPoint"], funnel: Funnel): string {
  if (broken.length) {
    const outreach = broken.filter((check) => check.draftId !== null).length;
    return outreach
      ? `Fix the destination first: ${outreach} outreach draft${outreach === 1 ? "" : "s"} link${outreach === 1 ? "s" : ""} to a page that doesn't load. No draft should be sent until its link works.`
      : `Fix the destination first: ${broken.length} buying page${broken.length === 1 ? "" : "s"} didn't load.`;
  }
  if (stop) return `${stop.count} reached "${stop.from}" and none went on to "${stop.to}". Make that next step plainer on the page they were on, and count it again next week.`;
  const anyone = FUNNEL_STEPS.some((step) => (funnel[step.key] ?? 0) > 0);
  return anyone
    ? "No step lost everyone this week. Keep the pages as they are and compare next week."
    : "Nobody came through a tracked link this week, so there is nothing to fix on the pages yet. The first sends and posts start the count.";
}

export async function runConversionCheck(input: {
  db: SqlTag;
  runId: number | null;
  dryRun: boolean;
  fetcher?: Fetcher;
  now?: Date;
  siteUrl?: string;
}): Promise<ConversionResult> {
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? new Date();
  const siteUrl = (input.siteUrl ?? SITE_URL).replace(/\/$/, "");
  const weekEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekStart = new Date(weekEnd.getTime() - 7 * DAY_MS);
  const result: ConversionResult = {
    schemaReady: false,
    dryRun: input.dryRun,
    weekStart: weekStart.toISOString().slice(0, 10),
    thisWeek: null,
    lastWeek: null,
    previous: null,
    destinations: [],
    broken: [],
    stopPoint: null,
    fix: "",
    draftId: null,
    reason: null,
  };
  if (!(await contentSchemaReady(input.db))) return { ...result, reason: "content_drafts is missing" };
  result.schemaReady = true;

  // 1. Destinations.
  const outreach = await unsentOutreachLinks(MAX_LINK_CHECKS, input.db);
  const targets = [
    ...BUYING_PAGES.map((path) => ({ url: `${siteUrl}${path}`, draftId: null as number | null })),
    ...outreach.map((item) => ({ url: item.link, draftId: item.draftId })),
  ].slice(0, MAX_LINK_CHECKS);
  for (const target of targets) {
    const page = await fetchText(target.url, fetcher);
    const ok = page.ok && !NOT_FOUND.test(page.text.slice(0, 20_000));
    result.destinations.push({ ...target, status: page.status, ok });
  }
  result.broken = result.destinations.filter((check) => !check.ok);

  // 2. The funnel.
  result.thisWeek = await funnelCounts(weekStart, weekEnd, input.db);
  result.lastWeek = await funnelCounts(new Date(weekStart.getTime() - 7 * DAY_MS), weekStart, input.db);
  const previous = await lastStepDetail("growth-conversion", input.db);
  result.previous = previous?.thisWeek && typeof previous.thisWeek === "object" ? (previous.thisWeek as Funnel) : null;

  // 3. This week's one fix.
  result.stopPoint = stopPointOf(result.thisWeek);
  result.fix = fixFor(result.broken, result.stopPoint, result.thisWeek);

  if (input.dryRun) return result;
  result.draftId = await insertContentDraft(
    {
      agent: "norman",
      kind: "brief",
      workflow: CONVERSION_WORKFLOW,
      channel: "internal",
      subjectKey: `conversion:${result.weekStart}`,
      title: result.broken.length
        ? `Conversion check, week of ${result.weekStart}: ${result.broken.length} broken destination${result.broken.length === 1 ? "" : "s"}`
        : `Conversion check, week of ${result.weekStart}`,
      caption: conversionText(result),
      facts: {
        source: "growth-conversion",
        week_start: result.weekStart,
        this_week: result.thisWeek,
        last_week: result.lastWeek,
        broken: result.broken,
      },
      asOf: now,
      agentRunId: input.runId,
    },
    input.db,
  );
  return result;
}

const shown = (value: number | null | undefined) => (value === null || value === undefined ? "not measured" : String(value));

/** The brief as James reads it in the queue. */
export function conversionText(result: ConversionResult): string {
  const lines = [`NORMAN conversion check, week of ${result.weekStart}. Internal: nothing here changes a page or sends anything.`, ""];
  lines.push(`This week's fix: ${result.fix}`, "");
  if (result.broken.length) {
    lines.push("Broken destinations:");
    for (const check of result.broken) lines.push(`- ${check.url} (${check.status ?? "no answer"})${check.draftId !== null ? ` in outreach draft ${check.draftId}` : ""}`);
    lines.push("");
  }
  lines.push(`Checked ${result.destinations.length} destinations; ${result.destinations.length - result.broken.length} loaded.`, "");
  lines.push("Funnel (this week / last week" + (result.previous ? " / last brief's before" : "") + "):");
  for (const step of FUNNEL_STEPS) {
    const cells = [shown(result.thisWeek?.[step.key]), shown(result.lastWeek?.[step.key])];
    if (result.previous) cells.push(shown(result.previous[step.key]));
    lines.push(`- ${step.label}: ${cells.join(" / ")}`);
  }
  lines.push("", "Counts come from our own tables (marketing_touches, snapshot_events, leads). Nothing is estimated.");
  return lines.join("\n");
}

export function summarizeConversionCheck(result: ConversionResult): string {
  if (!result.schemaReady) return `Wrote no check: ${result.reason ?? "queue not ready"}.`;
  const loaded = result.destinations.length - result.broken.length;
  return `Checked ${result.destinations.length} destinations (${loaded} loaded, ${result.broken.length} broken) and the week's funnel; ${result.dryRun ? "would file" : "filed"} NORMAN's brief.`;
}
