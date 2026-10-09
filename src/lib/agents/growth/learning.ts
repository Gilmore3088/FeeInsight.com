import { sql } from "@/lib/data-store/connection";
import { contentSchemaReady, insertContentDraft, recentSubjects } from "@/lib/data-store/content-drafts";
import { listQualifiedLeads, type QualifiedLeadMark } from "@/lib/data-store/lead-qualified";
import { journeySchemaReady } from "@/lib/data-store/outreach-journey";
import {
  BUYER_LOG_FIELDS,
  type BuyerLog,
  journeyFunnel,
  journeyStage,
  OUTREACH_OUTCOME_LABELS,
  type OutreachOutcome,
  type SnapshotEvent,
} from "@/lib/outreach-journey";
import { OUTREACH_CAMPAIGN, OUTREACH_WORKFLOW } from "./outreach";

/**
 * DRAPER's weekly "what we learned" report (James, 15:33 UTC Oct 8: "DRAPER should produce a
 * weekly report: what we learned this week"). It reads only what happened: the outcomes James
 * recorded on sent emails (with his notes, decline reasons included), the snapshot page's
 * first-party events, the outreach drafts, the posted items' scores and outreach leads. The sales
 * metrics are the ones the GTM plan names: qualified conversations per 100 contacts, share
 * reaching a proposal, proposal to paid, days from email to purchase. A metric with no data says
 * so. No model call; the report lands in the growth queue as DRAPER's brief for James to read.
 * Nothing sends.
 */

type SqlTag = typeof sql;

export const LEARNING_WORKFLOW = "learning";
const DAY_MS = 86_400_000;

export interface LearningOutcome {
  institutionId: number;
  institutionName: string | null;
  outcome: OutreachOutcome;
  note: string | null;
  answers?: BuyerLog | null;
  at: string;
}

export interface LearningInput {
  weekStart: Date;
  weekEnd: Date;
  /** Every recorded outcome to date, oldest first (the metrics are cumulative). */
  outcomes: LearningOutcome[];
  /** Snapshot page events from outreach links, to date. */
  events: Array<{ institutionId: number; event: SnapshotEvent; at: string }>;
  draftsThisWeek: { drafted: number; done: number; skipped: number };
  scoredThisWeek: Array<{ title: string; score: number | null }>;
  leadsThisWeek: { total: number; fromOutreach: number } | null;
  /** Leads James marked qualified on /admin/leads, to date (empty before migration 20270110000032). */
  qualifiedLeads?: QualifiedLeadMark[];
}

const QUALIFIED: ReadonlySet<OutreachOutcome> = new Set(["conversation", "report_requested", "proposal", "purchased_report", "purchased_pro"]);
const PROPOSAL_OR_LATER: ReadonlySet<OutreachOutcome> = new Set(["proposal", "purchased_report", "purchased_pro"]);
const PAID: ReadonlySet<OutreachOutcome> = new Set(["purchased_report", "purchased_pro"]);

const inWeek = (at: string, input: Pick<LearningInput, "weekStart" | "weekEnd">) => {
  const time = Date.parse(at);
  return time >= input.weekStart.getTime() && time < input.weekEnd.getTime();
};

const day = (date: Date) => date.toISOString().slice(0, 10);
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

export interface LearningMetrics {
  contacted: number;
  qualified: number;
  qualifiedPer100: number | null;
  /** Leads marked qualified that are not an outreach contact already counted in `qualified`. */
  qualifiedInbound: number;
  reachedProposal: number;
  paid: number;
  medianDaysToPurchase: number | null;
}

/**
 * The plan's sales metrics from every outcome to date, per institution. A lead James marked
 * qualified counts as a qualified conversation: toward the per-100 rate when its quote names an
 * institution we emailed, otherwise as an inbound qualified lead (each institution once).
 */
export function learningMetrics(outcomes: LearningOutcome[], qualifiedLeads: QualifiedLeadMark[] = []): LearningMetrics {
  const byInstitution = new Map<number, LearningOutcome[]>();
  for (const outcome of outcomes) byInstitution.set(outcome.institutionId, [...(byInstitution.get(outcome.institutionId) ?? []), outcome]);
  const qualifiedByLead = new Set(qualifiedLeads.map((lead) => lead.institutionId).filter((id): id is number => id !== null));
  let contacted = 0;
  let qualified = 0;
  let reachedProposal = 0;
  let paid = 0;
  const daysToPurchase: number[] = [];
  for (const list of byInstitution.values()) {
    const sent = list.find((item) => item.outcome === "sent");
    if (sent) contacted++;
    if (list.some((item) => QUALIFIED.has(item.outcome)) || (sent && qualifiedByLead.has(list[0].institutionId))) qualified++;
    if (list.some((item) => PROPOSAL_OR_LATER.has(item.outcome))) reachedProposal++;
    const bought = list.find((item) => PAID.has(item.outcome));
    if (bought) {
      paid++;
      if (sent) daysToPurchase.push(Math.max(0, Math.round((Date.parse(bought.at) - Date.parse(sent.at)) / DAY_MS)));
    }
  }
  const inboundInstitutions = new Set<number>();
  let qualifiedInbound = 0;
  for (const lead of qualifiedLeads) {
    if (lead.institutionId === null) {
      qualifiedInbound++;
      continue;
    }
    if (byInstitution.get(lead.institutionId)?.some((item) => item.outcome === "sent")) continue;
    if (byInstitution.get(lead.institutionId)?.some((item) => QUALIFIED.has(item.outcome))) continue;
    if (inboundInstitutions.has(lead.institutionId)) continue;
    inboundInstitutions.add(lead.institutionId);
    qualifiedInbound++;
  }
  daysToPurchase.sort((a, b) => a - b);
  const middle = Math.floor(daysToPurchase.length / 2);
  return {
    contacted,
    qualified,
    qualifiedPer100: contacted ? Math.round((qualified / contacted) * 1000) / 10 : null,
    qualifiedInbound,
    reachedProposal,
    paid,
    medianDaysToPurchase: daysToPurchase.length
      ? daysToPurchase.length % 2
        ? daysToPurchase[middle]
        : (daysToPurchase[middle - 1] + daysToPurchase[middle]) / 2
      : null,
  };
}

/** The report's title and text. Every line is a count or a note James wrote; nothing is estimated. */
export function buildLearningReport(input: LearningInput): { title: string; body: string; metrics: LearningMetrics } {
  const metrics = learningMetrics(input.outcomes, input.qualifiedLeads ?? []);
  const week = input.outcomes.filter((item) => inWeek(item.at, input));
  const weekEvents = input.events.filter((item) => inWeek(item.at, input));
  const title = `What we learned, week of ${day(input.weekStart)}`;
  const lines: string[] = [title, ""];

  lines.push("This week");
  const sentThisWeek = week.filter((item) => item.outcome === "sent").length;
  lines.push(`- Outreach: ${plural(input.draftsThisWeek.drafted, "email")} drafted, ${sentThisWeek} sent, ${input.draftsThisWeek.skipped} skipped.`);
  const institutionsOpened = new Set(weekEvents.filter((item) => item.event === "opened").map((item) => item.institutionId)).size;
  const counts = (event: SnapshotEvent) => weekEvents.filter((item) => item.event === event).length;
  lines.push(
    weekEvents.length
      ? `- Snapshots: opened by ${plural(institutionsOpened, "institution")}; ${counts("source_click")} schedule clicks, ${counts("fee_view")} other fees opened, ${counts("competitor_click")} competitor clicks, ${counts("report_click")} report requests clicked.`
      : "- Snapshots: no snapshot page was opened from an outreach link.",
  );
  if (input.leadsThisWeek) lines.push(`- Leads: ${input.leadsThisWeek.total} new, ${input.leadsThisWeek.fromOutreach} from outreach links.`);
  const scored = input.scoredThisWeek.filter((item) => item.score !== null);
  if (scored.length) {
    const best = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    lines.push(`- Posts scored: ${scored.length}; most visits: "${best.title}" (${best.score}).`);
  }
  lines.push("");

  const heard = week.filter((item) => item.outcome !== "sent");
  lines.push("What buyers said");
  if (heard.length === 0) lines.push("- Nothing recorded this week.");
  for (const item of heard) {
    const who = item.institutionName ?? `Institution ${item.institutionId}`;
    lines.push(`- ${who}: ${OUTREACH_OUTCOME_LABELS[item.outcome]}${item.note ? `: "${item.note}"` : " (no note)"}`);
  }
  lines.push("");

  const logged = input.outcomes.filter((item) => item.answers && Object.keys(item.answers).length);
  lines.push("Buyer log to date");
  if (logged.length === 0) lines.push("- No call notes recorded yet.");
  for (const field of BUYER_LOG_FIELDS) {
    const answers = logged.map((item) => item.answers?.[field.key]).filter((value): value is string => Boolean(value));
    if (answers.length === 0) continue;
    if (field.options) {
      const tally = new Map<string, number>();
      for (const answer of answers) tally.set(answer, (tally.get(answer) ?? 0) + 1);
      lines.push(`- ${field.label}: ${[...tally].sort((a, b) => b[1] - a[1]).map(([answer, n]) => `${answer} ${n}`).join(", ")}.`);
    } else {
      lines.push(`- ${field.label}: ${answers.map((answer) => `"${answer}"`).join("; ")}.`);
    }
  }
  lines.push("");

  const declines = input.outcomes.filter((item) => item.outcome === "declined");
  lines.push("Decline reasons to date");
  if (declines.length === 0) lines.push("- None recorded.");
  for (const item of declines) lines.push(`- ${item.institutionName ?? `Institution ${item.institutionId}`}: ${item.note ?? "no reason given"}`);
  lines.push("");

  lines.push("Sales metrics to date");
  if (metrics.contacted === 0) {
    lines.push("- No email is marked sent yet, so there is nothing to measure.");
  } else {
    lines.push(`- Qualified conversations per 100 contacts: ${metrics.qualifiedPer100} (${metrics.qualified} of ${metrics.contacted} contacted).`);
    lines.push(`- Reached a proposal: ${metrics.reachedProposal} (${percent(metrics.reachedProposal, metrics.contacted)} of contacted).`);
    lines.push(
      metrics.reachedProposal
        ? `- Proposal to paid: ${metrics.paid} of ${metrics.reachedProposal} (${percent(metrics.paid, metrics.reachedProposal)}).`
        : "- Proposal to paid: no proposal yet.",
    );
    lines.push(
      metrics.medianDaysToPurchase === null
        ? "- Days from email to purchase: no purchase yet."
        : `- Days from email to purchase (median): ${metrics.medianDaysToPurchase}.`,
    );
  }
  lines.push(`- Leads marked qualified outside outreach: ${metrics.qualifiedInbound}.`);
  const stages = new Map<number, { events: SnapshotEvent[]; outcomes: OutreachOutcome[] }>();
  const entry = (id: number) => stages.get(id) ?? stages.set(id, { events: [], outcomes: [] }).get(id)!;
  for (const item of input.events) entry(item.institutionId).events.push(item.event);
  for (const item of input.outcomes) entry(item.institutionId).outcomes.push(item.outcome);
  const funnel = journeyFunnel([...stages.values()].map((value) => journeyStage(value.events, value.outcomes)));
  lines.push(`- Journey: ${funnel.map((stage) => `${stage.label} ${stage.count}`).join(", ")}.`);
  lines.push("");
  lines.push("Month-one floor (GTM plan): 5 qualified conversations and 2 purchase discussions by Nov 6.");
  lines.push(`So far: ${metrics.qualified + metrics.qualifiedInbound} qualified, ${metrics.reachedProposal} at a proposal or later.`);

  return { title, body: lines.join("\n"), metrics };
}

/** The Monday-to-Monday week that ended most recently before `now` (UTC). */
export function lastWeek(now: Date): { weekStart: Date; weekEnd: Date } {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  const weekEnd = new Date(midnight - sinceMonday * DAY_MS);
  return { weekStart: new Date(weekEnd.getTime() - 7 * DAY_MS), weekEnd };
}

async function loadLearningInput(db: SqlTag, weekStart: Date, weekEnd: Date): Promise<LearningInput> {
  const from = weekStart.toISOString();
  const to = weekEnd.toISOString();
  const [outcomes, events, drafts, scored] = await Promise.all([
    db`
      SELECT o.institution_id, s.institution_name, o.outcome, o.note, o.answers, o.created_at
        FROM outreach_outcomes o LEFT JOIN institution_sources s ON s.id = o.institution_id
       WHERE o.created_at < ${to}
       ORDER BY o.created_at, o.id
    `,
    db`
      SELECT institution_id, event, created_at FROM snapshot_events
       WHERE utm_campaign = ${OUTREACH_CAMPAIGN} AND created_at < ${to}
    `,
    db`
      SELECT COUNT(*)::int AS drafted,
             COUNT(*) FILTER (WHERE status = 'posted')::int AS done,
             COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped
        FROM content_drafts
       WHERE workflow = ${OUTREACH_WORKFLOW} AND created_at >= ${from} AND created_at < ${to}
    `,
    db`
      SELECT title, score FROM content_drafts
       WHERE scored_at >= ${from} AND scored_at < ${to}
    `,
  ]);
  let leadsThisWeek: LearningInput["leadsThisWeek"] = null;
  const [leadColumns] = await db`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'leads' AND column_name IN ('created_at', 'first_utm_campaign')
  `;
  if (Number(leadColumns?.n) === 2) {
    const [leads] = await db`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE first_utm_campaign = ${OUTREACH_CAMPAIGN})::int AS from_outreach
        FROM leads WHERE created_at >= ${from} AND created_at < ${to}
    `;
    leadsThisWeek = { total: Number(leads.total), fromOutreach: Number(leads.from_outreach) };
  }
  const iso = (value: unknown) => new Date(value as string).toISOString();
  const qualifiedLeads = await listQualifiedLeads(weekEnd, db);
  return {
    weekStart,
    weekEnd,
    outcomes: outcomes.map((row) => ({
      institutionId: Number(row.institution_id),
      institutionName: row.institution_name === null ? null : String(row.institution_name),
      outcome: row.outcome as OutreachOutcome,
      note: row.note === null ? null : String(row.note),
      answers: row.answers && typeof row.answers === "object" ? (row.answers as BuyerLog) : null,
      at: iso(row.created_at),
    })),
    events: events.map((row) => ({ institutionId: Number(row.institution_id), event: row.event as SnapshotEvent, at: iso(row.created_at) })),
    draftsThisWeek: { drafted: Number(drafts[0]?.drafted ?? 0), done: Number(drafts[0]?.done ?? 0), skipped: Number(drafts[0]?.skipped ?? 0) },
    scoredThisWeek: scored.map((row) => ({ title: String(row.title), score: row.score === null ? null : Number(row.score) })),
    leadsThisWeek,
    qualifiedLeads,
  };
}

export interface LearningRunResult {
  schemaReady: boolean;
  dryRun: boolean;
  week: string;
  draftId: number | null;
  alreadyFiled: boolean;
  metrics: LearningMetrics | null;
}

export async function runLearningReport(input: { db?: SqlTag; runId: number | null; dryRun?: boolean; now?: Date }): Promise<LearningRunResult> {
  const db = input.db ?? sql;
  const dryRun = input.dryRun ?? false;
  const { weekStart, weekEnd } = lastWeek(input.now ?? new Date());
  const week = day(weekStart);
  const result: LearningRunResult = { schemaReady: false, dryRun, week, draftId: null, alreadyFiled: false, metrics: null };
  if (!(await contentSchemaReady(db)) || !(await journeySchemaReady(db))) return result;
  result.schemaReady = true;
  const subjectKey = `week:${week}`;
  if ((await recentSubjects(LEARNING_WORKFLOW, 30, db)).has(subjectKey)) {
    result.alreadyFiled = true;
    return result;
  }
  const report = buildLearningReport(await loadLearningInput(db, weekStart, weekEnd));
  result.metrics = report.metrics;
  if (dryRun) return result;
  result.draftId = await insertContentDraft(
    {
      agent: "draper",
      kind: "brief",
      workflow: LEARNING_WORKFLOW,
      channel: "internal",
      subjectKey,
      title: report.title,
      caption: report.body,
      facts: { week_start: week, week_end: day(weekEnd), metrics: report.metrics, source: "outreach_outcomes, snapshot_events, content_drafts, leads (incl. qualified marks)" },
      asOf: weekEnd,
      agentRunId: input.runId,
    },
    db,
  );
  return result;
}

export function summarizeLearning(result: LearningRunResult): string {
  if (!result.schemaReady) return "No report: the queue or outreach journey tables are not there yet.";
  if (result.alreadyFiled) return `The report for the week of ${result.week} is already in the queue.`;
  const metrics = result.metrics;
  const head = `${result.dryRun ? "Would file" : "Filed"} what we learned for the week of ${result.week}`;
  return metrics && metrics.contacted
    ? `${head}: ${metrics.qualified} qualified conversations from ${metrics.contacted} contacted, ${metrics.qualifiedInbound} qualified inbound, ${metrics.paid} paid.`
    : `${head}: no email marked sent yet${metrics?.qualifiedInbound ? `; ${metrics.qualifiedInbound} qualified inbound` : ""}.`;
}
