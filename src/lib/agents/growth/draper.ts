import { sql } from "@/lib/data-store/connection";
import { contentSchemaReady, insertContentDraft, recentSubjects } from "@/lib/data-store/content-drafts";
import { journeySchemaReady } from "@/lib/data-store/outreach-journey";
import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";
import { OUTREACH_OUTCOME_LABELS, OUTREACH_OUTCOMES, type OutreachOutcome } from "@/lib/outreach-journey";
import { LEARNING_WORKFLOW, lastWeek, learningMetrics, type LearningMetrics, MONTH_ONE_FLOOR } from "./learning";
import { SKIP_LESSON_KIND } from "./lessons";
import {
  CAMPAIGN_LETTER,
  FINAL_FOLLOW_UP_AFTER_DAYS,
  FINAL_FOLLOW_UP_WORKFLOW,
  FOLLOW_UP_AFTER_DAYS,
  FOLLOW_UP_WORKFLOW,
  type OutreachCampaign,
  OUTREACH_WORKFLOW,
} from "./outreach";

/**
 * DRAPER's two Monday drafts for James (growth-os/agents/draper.md: "the Monday growth report ...
 * next week's three jobs"). Both are free steps (no model call) that read the growth tables and
 * file one item each into the `/admin/growth` queue; nothing sends.
 *
 * - The Monday plan (`growth-plan`): the week's work. Outreach drafts waiting for review, the
 *   follow-ups that come due this week, content drafts queued, what the latest learning report and
 *   proposals said, and the GTM plan's month-one floor with progress against it.
 * - Proposals (`growth-proposals`): at most 3 changes the evidence supports, each citing the counts
 *   behind it (a campaign with nothing heard back after RETIRE_AFTER_SENDS sends, a workflow James
 *   keeps skipping, a decline reason heard more than once). When nothing meets those bars it files
 *   one line saying so, with the counts; it never fills the gap with a guess.
 *
 * The conversation log is `outreach_outcomes` (what James recorded after each email); both drafts
 * carry its counts. No fee advice, no figures beyond the counts read here.
 */

type SqlTag = typeof sql;

export const PLAN_WORKFLOW = "draper-plan";
export const PROPOSALS_WORKFLOW = "draper-proposals";
const DAY_MS = 86_400_000;

/** A campaign is proposed for retirement after this many first emails marked sent with nothing heard back. */
export const RETIRE_AFTER_SENDS = 20;
/** A workflow is proposed for a change after James skips this many of its items, with a reason, in SKIP_WINDOW_DAYS. */
export const SKIP_PATTERN_MIN = 3;
export const SKIP_WINDOW_DAYS = 30;
/** A decline reason heard this many times is proposed as something the first email should answer. */
export const DECLINE_PATTERN_MIN = 2;
export const MAX_PROPOSALS = 3;

const day = (date: Date) => date.toISOString().slice(0, 10);
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString());

/** The Monday-to-Monday week that `now` falls in (UTC). */
export function thisWeek(now: Date): { weekStart: Date; weekEnd: Date } {
  const { weekEnd } = lastWeek(now);
  return { weekStart: weekEnd, weekEnd: new Date(weekEnd.getTime() + 7 * DAY_MS) };
}

// ---------------------------------------------------------------------------------------------
// The conversation log (outreach_outcomes)
// ---------------------------------------------------------------------------------------------

export interface LoggedOutcome {
  institutionId: number;
  outcome: OutreachOutcome;
  note: string | null;
  at: string;
}

export interface ConversationLog {
  /** Outcomes recorded to date, by kind. */
  toDate: Record<OutreachOutcome, number>;
  /** Outcomes recorded in the week before `weekStart`. */
  lastWeek: Record<OutreachOutcome, number>;
  /** Institutions with any outcome recorded. */
  institutions: number;
}

const zeroCounts = () => Object.fromEntries(OUTREACH_OUTCOMES.map((outcome) => [outcome, 0])) as Record<OutreachOutcome, number>;

export function conversationLog(outcomes: LoggedOutcome[], weekStart: Date): ConversationLog {
  const toDate = zeroCounts();
  const previous = zeroCounts();
  const from = weekStart.getTime() - 7 * DAY_MS;
  for (const item of outcomes) {
    toDate[item.outcome]++;
    const time = Date.parse(item.at);
    if (time >= from && time < weekStart.getTime()) previous[item.outcome]++;
  }
  return { toDate, lastWeek: previous, institutions: new Set(outcomes.map((item) => item.institutionId)).size };
}

const outcomeCounts = (counts: Record<OutreachOutcome, number>) =>
  OUTREACH_OUTCOMES.map((outcome) => `${OUTREACH_OUTCOME_LABELS[outcome]} ${counts[outcome]}`).join(", ");

export function conversationLines(log: ConversationLog): string[] {
  const total = Object.values(log.toDate).reduce((sum, n) => sum + n, 0);
  if (total === 0) return ["- Nothing recorded in outreach_outcomes yet: no email is marked sent."];
  return [
    `- To date (${plural(log.institutions, "institution")}): ${outcomeCounts(log.toDate)}.`,
    `- Last week: ${outcomeCounts(log.lastWeek)}.`,
  ];
}

// ---------------------------------------------------------------------------------------------
// The Monday plan
// ---------------------------------------------------------------------------------------------

export interface QueueGroup {
  workflow: string;
  agent: string;
  kind: string;
  status: "draft" | "approved";
  campaign: string | null;
  count: number;
  oldest: string;
}

/** One first email marked sent, with what has happened since (for the follow-up dates). */
export interface SentEmail {
  institutionId: number;
  institutionName: string;
  sentAt: string;
  /** Any outcome other than "sent" recorded for the institution: the follow-ups stop. */
  heardBack: boolean;
  followUpDrafted: boolean;
  followUpSent: boolean;
  finalDrafted: boolean;
}

export interface DueFollowUp {
  institutionName: string;
  stage: 1 | 2;
  dueAt: string;
  sentAt: string;
}

/**
 * The follow-ups CARNEGIE drafts before `until`, by the rule in `runOutreachFollowUps`: the first
 * FOLLOW_UP_AFTER_DAYS after a first email marked sent, the final FINAL_FOLLOW_UP_AFTER_DAYS after
 * it once the first follow-up is marked sent, and none once anything else is recorded.
 */
export function dueFollowUps(sent: SentEmail[], until: Date): DueFollowUp[] {
  const due: DueFollowUp[] = [];
  for (const email of sent) {
    if (email.heardBack) continue;
    const sentTime = Date.parse(email.sentAt);
    let stage: 1 | 2 | null = null;
    if (!email.followUpDrafted) stage = 1;
    else if (email.followUpSent && !email.finalDrafted) stage = 2;
    if (stage === null) continue;
    const dueAt = new Date(sentTime + (stage === 1 ? FOLLOW_UP_AFTER_DAYS : FINAL_FOLLOW_UP_AFTER_DAYS) * DAY_MS);
    if (dueAt.getTime() < until.getTime()) due.push({ institutionName: email.institutionName, stage, dueAt: dueAt.toISOString(), sentAt: email.sentAt });
  }
  return due.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export interface PriorItem {
  id: number;
  title: string;
  createdAt: string;
  status: string;
}

export interface PlanInput {
  weekStart: Date;
  weekEnd: Date;
  now: Date;
  queue: QueueGroup[];
  sent: SentEmail[];
  outcomes: LoggedOutcome[];
  learning: (PriorItem & { metrics: LearningMetrics | null }) | null;
  proposals: (PriorItem & { lines: string[] }) | null;
}

const campaignLabel = (campaign: string | null) =>
  campaign && campaign in CAMPAIGN_LETTER ? `campaign ${CAMPAIGN_LETTER[campaign as OutreachCampaign]}` : "no campaign recorded";

const FOLLOW_UP_WORKFLOWS = new Set([FOLLOW_UP_WORKFLOW, FINAL_FOLLOW_UP_WORKFLOW]);

export interface PlanCounts {
  outreachAwaiting: number;
  followUpsAwaiting: number;
  outreachApproved: number;
  followUpsDue: number;
  contentQueued: number;
}

/** The plan's title and text. Every line is a count read from the tables or a title already in the queue. */
export function buildMondayPlan(input: PlanInput): { title: string; body: string; counts: PlanCounts } {
  const title = `Monday plan, week of ${day(input.weekStart)}`;
  const lines: string[] = [title, ""];
  const outreach = input.queue.filter((group) => group.kind === "outreach_email");
  const firstDrafts = outreach.filter((group) => group.status === "draft" && group.workflow === OUTREACH_WORKFLOW);
  const followDrafts = outreach.filter((group) => group.status === "draft" && FOLLOW_UP_WORKFLOWS.has(group.workflow));
  const approved = outreach.filter((group) => group.status === "approved");
  const sum = (groups: QueueGroup[]) => groups.reduce((total, group) => total + group.count, 0);
  const oldest = (groups: QueueGroup[]) => groups.map((group) => group.oldest).sort()[0];

  lines.push("Outreach waiting for your review");
  if (sum(firstDrafts) === 0 && sum(followDrafts) === 0 && sum(approved) === 0) lines.push("- None in the queue.");
  if (sum(firstDrafts)) {
    const byCampaign = new Map<string, number>();
    for (const group of firstDrafts) byCampaign.set(campaignLabel(group.campaign), (byCampaign.get(campaignLabel(group.campaign)) ?? 0) + group.count);
    lines.push(
      `- ${plural(sum(firstDrafts), "first email")} to audit (${[...byCampaign].map(([label, n]) => `${label} ${n}`).join(", ")}); oldest drafted ${day(new Date(oldest(firstDrafts)))}.`,
    );
  }
  if (sum(followDrafts)) lines.push(`- ${plural(sum(followDrafts), "follow-up")} drafted, waiting to be checked and sent; oldest ${day(new Date(oldest(followDrafts)))}.`);
  if (sum(approved)) lines.push(`- ${plural(sum(approved), "approved email")} not yet marked sent.`);
  lines.push("");

  const due = dueFollowUps(input.sent, input.weekEnd);
  lines.push("Follow-ups due this week");
  if (input.sent.length === 0) lines.push("- None: no first email is marked sent.");
  else if (due.length === 0) lines.push(`- None due before ${day(input.weekEnd)} (${plural(input.sent.length, "first email")} marked sent).`);
  for (const item of due) {
    const when = Date.parse(item.dueAt) <= input.now.getTime() ? `due since ${day(new Date(item.dueAt))}` : `due ${day(new Date(item.dueAt))}`;
    lines.push(`- ${item.institutionName}: ${item.stage === 1 ? "follow-up" : "final follow-up"} ${when} (first email marked sent ${day(new Date(item.sentAt))}).`);
  }
  lines.push("");

  const content = input.queue.filter((group) => group.kind !== "outreach_email");
  lines.push("Content and briefs queued");
  if (content.length === 0) lines.push("- None in the queue.");
  for (const group of [...content].sort((a, b) => a.agent.localeCompare(b.agent) || a.workflow.localeCompare(b.workflow) || a.status.localeCompare(b.status))) {
    const state = group.status === "approved" ? "approved, not yet marked posted" : "to review";
    lines.push(`- ${group.agent.toUpperCase()} ${group.workflow} (${group.kind}): ${group.count} ${state}; oldest ${day(new Date(group.oldest))}.`);
  }
  lines.push("");

  lines.push("What the last report and proposals said");
  if (!input.learning) lines.push("- No what-we-learned report is in the queue yet.");
  else {
    const metrics = input.learning.metrics;
    lines.push(
      metrics && metrics.contacted
        ? `- ${input.learning.title} (item ${input.learning.id}): ${metrics.qualified} qualified of ${metrics.contacted} contacted, ${metrics.reachedProposal} at a proposal or later, ${metrics.paid} paid.`
        : `- ${input.learning.title} (item ${input.learning.id}): no email marked sent, so nothing to measure.`,
    );
  }
  if (!input.proposals) lines.push("- No DRAPER proposals are in the queue yet.");
  else {
    lines.push(`- ${input.proposals.title} (item ${input.proposals.id}, ${input.proposals.status}):`);
    for (const line of input.proposals.lines) lines.push(`  ${line}`);
  }
  lines.push("");

  lines.push("Conversation log (outreach_outcomes)");
  lines.push(...conversationLines(conversationLog(input.outcomes, input.weekStart)));
  lines.push("");

  const metrics = learningMetrics(input.outcomes.map((item) => ({ ...item, institutionName: null })));
  const daysLeft = Math.ceil((Date.parse(`${MONTH_ONE_FLOOR.by}T00:00:00Z`) - input.now.getTime()) / DAY_MS);
  lines.push("Targets (GTM plan)");
  lines.push(
    `- Month-one floor: ${MONTH_ONE_FLOOR.qualified} qualified conversations and ${MONTH_ONE_FLOOR.proposals} purchase discussions by ${MONTH_ONE_FLOOR.byLabel}. So far ${metrics.qualified + (metrics.qualifiedInbound ?? 0)} and ${metrics.reachedProposal}; ${daysLeft > 0 ? `${plural(daysLeft, "day")} left` : "the date has passed"}.`,
  );
  lines.push("- No other weekly target is in the code.");

  return {
    title,
    body: lines.join("\n"),
    counts: {
      outreachAwaiting: sum(firstDrafts),
      followUpsAwaiting: sum(followDrafts),
      outreachApproved: sum(approved),
      followUpsDue: due.length,
      contentQueued: content.reduce((total, group) => total + group.count, 0),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------------------------

export interface CampaignStats {
  campaign: string | null;
  /** Institutions whose first email in this campaign is marked sent. */
  sent: number;
  /** Of those, institutions with any other outcome recorded. */
  heardBack: number;
}

export interface SkipLesson {
  agent: string;
  workflow: string | null;
  reason: string;
}

export interface ProposalInput {
  weekStart: Date;
  campaigns: CampaignStats[];
  /** James's skips with a reason in the last SKIP_WINDOW_DAYS (pipeline_feedback). */
  skips: SkipLesson[];
  outcomes: LoggedOutcome[];
}

export interface Proposal {
  rule: "retire_campaign" | "change_workflow" | "answer_decline";
  text: string;
  evidence: Record<string, number | string>;
}

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, "");

/** The changes the evidence supports, strongest evidence first, at most MAX_PROPOSALS. */
export function proposalsFrom(input: ProposalInput): Proposal[] {
  const found: Array<Proposal & { weight: number }> = [];

  for (const stats of input.campaigns) {
    if (!stats.campaign || !(stats.campaign in CAMPAIGN_LETTER)) continue;
    if (stats.sent < RETIRE_AFTER_SENDS || stats.heardBack > 0) continue;
    const letter = CAMPAIGN_LETTER[stats.campaign as OutreachCampaign];
    found.push({
      rule: "retire_campaign",
      text: `Retire campaign ${letter}: ${stats.sent} first emails marked sent and nothing recorded back (no reply, call, request or decline). Take ${letter} out of OUTREACH_CAMPAIGNS.`,
      evidence: { campaign: letter, sent: stats.sent, heard_back: 0 },
      weight: stats.sent,
    });
  }

  const byWorkflow = new Map<string, SkipLesson[]>();
  for (const skip of input.skips) {
    const key = `${skip.agent}\u0000${skip.workflow ?? ""}`;
    byWorkflow.set(key, [...(byWorkflow.get(key) ?? []), skip]);
  }
  for (const skips of byWorkflow.values()) {
    if (skips.length < SKIP_PATTERN_MIN) continue;
    const reasons = new Map<string, { text: string; n: number }>();
    for (const skip of skips) {
      const key = normalize(skip.reason);
      reasons.set(key, { text: reasons.get(key)?.text ?? skip.reason.trim(), n: (reasons.get(key)?.n ?? 0) + 1 });
    }
    const top = [...reasons.values()].sort((a, b) => b.n - a.n)[0];
    const name = `${skips[0].agent.toUpperCase()} ${skips[0].workflow ?? "(no workflow)"}`;
    found.push({
      rule: "change_workflow",
      text: `Change or pause ${name}: you skipped ${skips.length} of its items in ${SKIP_WINDOW_DAYS} days; the reason given most: "${top.text}" (${top.n}).`,
      evidence: { agent: skips[0].agent, workflow: skips[0].workflow ?? "", skipped: skips.length, top_reason_count: top.n },
      weight: skips.length,
    });
  }

  const declines = input.outcomes.filter((item) => item.outcome === "declined");
  const declineReasons = new Map<string, { text: string; n: number }>();
  for (const item of declines) {
    if (!item.note?.trim()) continue;
    const key = normalize(item.note);
    declineReasons.set(key, { text: declineReasons.get(key)?.text ?? item.note.trim(), n: (declineReasons.get(key)?.n ?? 0) + 1 });
  }
  for (const reason of declineReasons.values()) {
    if (reason.n < DECLINE_PATTERN_MIN) continue;
    found.push({
      rule: "answer_decline",
      text: `Answer a repeated decline in the first email: "${reason.text}" (${reason.n} of ${plural(declines.length, "decline")} recorded).`,
      evidence: { declines_with_reason: reason.n, declines: declines.length },
      weight: reason.n,
    });
  }

  return found
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_PROPOSALS)
    .map(({ weight: _weight, ...proposal }) => proposal);
}

export function buildProposals(input: ProposalInput): { title: string; body: string; proposals: Proposal[]; thin: boolean } {
  const title = `DRAPER's proposals, week of ${day(input.weekStart)}`;
  const proposals = proposalsFrom(input);
  const sent = input.campaigns.reduce((total, stats) => total + stats.sent, 0);
  const heard = input.campaigns.reduce((total, stats) => total + stats.heardBack, 0);
  const lines: string[] = [title, ""];
  if (proposals.length === 0) {
    lines.push(
      sent === 0
        ? `- Too little evidence for a proposal: 0 first emails marked sent, ${plural(input.outcomes.length, "outcome")} recorded, ${plural(input.skips.length, "skip")} with a reason in ${SKIP_WINDOW_DAYS} days.`
        : `- No change the evidence supports yet: ${sent} first emails marked sent, ${heard} heard back, ${plural(input.skips.length, "skip")} with a reason in ${SKIP_WINDOW_DAYS} days. (A campaign is proposed for retirement after ${RETIRE_AFTER_SENDS} sends with nothing heard back; a workflow after ${SKIP_PATTERN_MIN} skips in ${SKIP_WINDOW_DAYS} days.)`,
    );
  } else {
    proposals.forEach((proposal, index) => lines.push(`${index + 1}. ${proposal.text}`));
  }
  lines.push("");
  lines.push("Conversation log (outreach_outcomes)");
  lines.push(...conversationLines(conversationLog(input.outcomes, input.weekStart)));
  return { title, body: lines.join("\n"), proposals, thin: proposals.length === 0 };
}

// ---------------------------------------------------------------------------------------------
// Loading and filing
// ---------------------------------------------------------------------------------------------

async function loadOutcomes(db: SqlTag): Promise<LoggedOutcome[]> {
  const rows = await db`
    SELECT institution_id, outcome, note, created_at FROM outreach_outcomes ORDER BY created_at, id
  `;
  return rows.map((row) => ({
    institutionId: Number(row.institution_id),
    outcome: row.outcome as OutreachOutcome,
    note: row.note === null || row.note === undefined ? null : String(row.note),
    at: iso(row.created_at),
  }));
}

async function latestItem(db: SqlTag, workflow: string) {
  const [row] = await db`
    SELECT id, title, status, facts, caption, created_at FROM content_drafts
     WHERE workflow = ${workflow}
     ORDER BY created_at DESC, id DESC LIMIT 1
  `;
  return row ?? null;
}

const factsOf = (row: Record<string, unknown>) =>
  (typeof row.facts === "string" ? JSON.parse(row.facts) : row.facts ?? {}) as Record<string, unknown>;

export async function loadPlanInput(db: SqlTag, now: Date): Promise<PlanInput> {
  const { weekStart, weekEnd } = thisWeek(now);
  const [queue, sent, outcomes, learning, proposals] = await Promise.all([
    db`
      SELECT workflow, agent, kind, status, facts->>'campaign' AS campaign, COUNT(*)::int AS n, MIN(created_at) AS oldest
        FROM content_drafts
       WHERE status IN ('draft', 'approved') AND workflow NOT IN (${PLAN_WORKFLOW}, ${PROPOSALS_WORKFLOW})
       GROUP BY 1, 2, 3, 4, 5
    `,
    db`
      SELECT sent.institution_id, d.facts->>'institution_name' AS institution_name, MIN(sent.created_at) AS sent_at,
             EXISTS (SELECT 1 FROM outreach_outcomes later
                      WHERE later.institution_id = sent.institution_id AND later.outcome <> 'sent') AS heard_back,
             EXISTS (SELECT 1 FROM content_drafts f
                      WHERE f.workflow = ${FOLLOW_UP_WORKFLOW} AND f.subject_key = 'institution:' || sent.institution_id::text) AS follow_up_drafted,
             EXISTS (SELECT 1 FROM content_drafts f JOIN outreach_outcomes fs ON fs.draft_id = f.id AND fs.outcome = 'sent'
                      WHERE f.workflow = ${FOLLOW_UP_WORKFLOW} AND f.subject_key = 'institution:' || sent.institution_id::text) AS follow_up_sent,
             EXISTS (SELECT 1 FROM content_drafts f
                      WHERE f.workflow = ${FINAL_FOLLOW_UP_WORKFLOW} AND f.subject_key = 'institution:' || sent.institution_id::text) AS final_drafted
        FROM content_drafts d
        JOIN outreach_outcomes sent ON sent.draft_id = d.id AND sent.outcome = 'sent'
       WHERE d.workflow = ${OUTREACH_WORKFLOW} AND d.kind = 'outreach_email'
       GROUP BY sent.institution_id, d.facts->>'institution_name'
    `,
    loadOutcomes(db),
    latestItem(db, LEARNING_WORKFLOW),
    latestItem(db, PROPOSALS_WORKFLOW),
  ]);
  const learningFacts = learning ? factsOf(learning) : {};
  const proposalFacts = proposals ? factsOf(proposals) : {};
  const proposalTexts = Array.isArray(proposalFacts.proposals)
    ? (proposalFacts.proposals as Array<{ text?: unknown }>).map((item, index) => `${index + 1}. ${String(item.text ?? "")}`)
    : [];
  return {
    weekStart,
    weekEnd,
    now,
    queue: queue.map((row) => ({
      workflow: String(row.workflow),
      agent: String(row.agent),
      kind: String(row.kind),
      status: row.status === "approved" ? "approved" : "draft",
      campaign: row.campaign === null || row.campaign === undefined ? null : String(row.campaign),
      count: Number(row.n),
      oldest: iso(row.oldest),
    })),
    sent: sent.map((row) => ({
      institutionId: Number(row.institution_id),
      institutionName: row.institution_name ? String(row.institution_name) : `Institution ${row.institution_id}`,
      sentAt: iso(row.sent_at),
      heardBack: row.heard_back === true,
      followUpDrafted: row.follow_up_drafted === true,
      followUpSent: row.follow_up_sent === true,
      finalDrafted: row.final_drafted === true,
    })),
    outcomes,
    learning: learning
      ? {
          id: Number(learning.id),
          title: String(learning.title),
          status: String(learning.status),
          createdAt: iso(learning.created_at),
          metrics: learningFacts.metrics && typeof learningFacts.metrics === "object" ? (learningFacts.metrics as LearningMetrics) : null,
        }
      : null,
    proposals: proposals
      ? {
          id: Number(proposals.id),
          title: String(proposals.title),
          status: String(proposals.status),
          createdAt: iso(proposals.created_at),
          lines: proposalTexts.length ? proposalTexts : [String(proposalFacts.note ?? "No proposal was made.")],
        }
      : null,
  };
}

export async function loadProposalInput(db: SqlTag, now: Date): Promise<ProposalInput> {
  const { weekStart } = thisWeek(now);
  const [campaigns, outcomes] = await Promise.all([
    db`
      WITH sent AS (
        SELECT DISTINCT d.facts->>'campaign' AS campaign, o.institution_id
          FROM content_drafts d
          JOIN outreach_outcomes o ON o.draft_id = d.id AND o.outcome = 'sent'
         WHERE d.workflow = ${OUTREACH_WORKFLOW} AND d.kind = 'outreach_email'
      ),
      heard AS (
        SELECT DISTINCT institution_id FROM outreach_outcomes WHERE outcome <> 'sent'
      )
      SELECT s.campaign, COUNT(*)::int AS sent, COUNT(h.institution_id)::int AS heard_back
        FROM sent s LEFT JOIN heard h USING (institution_id)
       GROUP BY s.campaign
    `,
    loadOutcomes(db),
  ]);
  let skips: SkipLesson[] = [];
  if (await feedbackSchemaReady(db)) {
    const rows = await db`
      SELECT evidence FROM pipeline_feedback
       WHERE reported_by = 'growth' AND about_stage = 'marketing' AND kind = ${SKIP_LESSON_KIND} AND signal = 'wrong'
         AND updated_at >= ${new Date(now.getTime() - SKIP_WINDOW_DAYS * DAY_MS).toISOString()}
    `;
    skips = rows.map((row) => {
      const evidence = (typeof row.evidence === "string" ? JSON.parse(row.evidence) : row.evidence ?? {}) as Record<string, unknown>;
      return { agent: String(evidence.agent ?? "unknown"), workflow: evidence.workflow ? String(evidence.workflow) : null, reason: String(evidence.reason ?? "") };
    });
  }
  return {
    weekStart,
    campaigns: campaigns.map((row) => ({
      campaign: row.campaign === null || row.campaign === undefined ? null : String(row.campaign),
      sent: Number(row.sent),
      heardBack: Number(row.heard_back),
    })),
    skips,
    outcomes,
  };
}

interface DraperRunBase {
  schemaReady: boolean;
  dryRun: boolean;
  week: string;
  draftId: number | null;
  alreadyFiled: boolean;
}

export interface PlanRunResult extends DraperRunBase {
  counts: PlanCounts | null;
}

export interface ProposalsRunResult extends DraperRunBase {
  proposals: number;
  thin: boolean;
  sent: number;
}

async function ready(db: SqlTag): Promise<boolean> {
  return (await contentSchemaReady(db)) && (await journeySchemaReady(db));
}

export async function runMondayPlan(input: { db?: SqlTag; runId: number | null; dryRun?: boolean; now?: Date }): Promise<PlanRunResult> {
  const db = input.db ?? sql;
  const now = input.now ?? new Date();
  const dryRun = input.dryRun ?? false;
  const week = day(thisWeek(now).weekStart);
  const result: PlanRunResult = { schemaReady: false, dryRun, week, draftId: null, alreadyFiled: false, counts: null };
  if (!(await ready(db))) return result;
  result.schemaReady = true;
  const subjectKey = `week:${week}`;
  if ((await recentSubjects(PLAN_WORKFLOW, 30, db)).has(subjectKey)) {
    result.alreadyFiled = true;
    return result;
  }
  const plan = buildMondayPlan(await loadPlanInput(db, now));
  result.counts = plan.counts;
  if (dryRun) return result;
  result.draftId = await insertContentDraft(
    {
      agent: "draper",
      kind: "plan",
      workflow: PLAN_WORKFLOW,
      channel: "internal",
      subjectKey,
      title: plan.title,
      caption: plan.body,
      facts: { week_start: week, counts: plan.counts, source: "content_drafts, outreach_outcomes, the latest learning report and proposals" },
      asOf: now,
      agentRunId: input.runId,
    },
    db,
  );
  return result;
}

export async function runProposals(input: { db?: SqlTag; runId: number | null; dryRun?: boolean; now?: Date }): Promise<ProposalsRunResult> {
  const db = input.db ?? sql;
  const now = input.now ?? new Date();
  const dryRun = input.dryRun ?? false;
  const week = day(thisWeek(now).weekStart);
  const result: ProposalsRunResult = { schemaReady: false, dryRun, week, draftId: null, alreadyFiled: false, proposals: 0, thin: true, sent: 0 };
  if (!(await ready(db))) return result;
  result.schemaReady = true;
  const subjectKey = `week:${week}`;
  if ((await recentSubjects(PROPOSALS_WORKFLOW, 30, db)).has(subjectKey)) {
    result.alreadyFiled = true;
    return result;
  }
  const evidence = await loadProposalInput(db, now);
  const built = buildProposals(evidence);
  result.proposals = built.proposals.length;
  result.thin = built.thin;
  result.sent = evidence.campaigns.reduce((total, stats) => total + stats.sent, 0);
  if (dryRun) return result;
  result.draftId = await insertContentDraft(
    {
      agent: "draper",
      kind: "brief",
      workflow: PROPOSALS_WORKFLOW,
      channel: "internal",
      subjectKey,
      title: built.title,
      caption: built.body,
      facts: {
        week_start: week,
        proposals: built.proposals,
        note: built.thin ? built.body.split("\n")[2]?.replace(/^- /, "") ?? null : null,
        rules: { retire_after_sends: RETIRE_AFTER_SENDS, skip_pattern_min: SKIP_PATTERN_MIN, skip_window_days: SKIP_WINDOW_DAYS, decline_pattern_min: DECLINE_PATTERN_MIN },
        source: "content_drafts, outreach_outcomes, pipeline_feedback (skips with a reason)",
      },
      asOf: now,
      agentRunId: input.runId,
    },
    db,
  );
  return result;
}

export function summarizeMondayPlan(result: PlanRunResult): string {
  if (!result.schemaReady) return "No plan: the queue or outreach journey tables are not there yet.";
  if (result.alreadyFiled) return `The Monday plan for the week of ${result.week} is already in the queue.`;
  const counts = result.counts;
  const head = `${result.dryRun ? "Would file" : "Filed"} the Monday plan for the week of ${result.week}`;
  return counts
    ? `${head}: ${counts.outreachAwaiting} first emails and ${counts.followUpsAwaiting} follow-ups to review, ${counts.followUpsDue} follow-ups due, ${counts.contentQueued} other items queued.`
    : `${head}.`;
}

export function summarizeProposals(result: ProposalsRunResult): string {
  if (!result.schemaReady) return "No proposals: the queue or outreach journey tables are not there yet.";
  if (result.alreadyFiled) return `DRAPER's proposals for the week of ${result.week} are already in the queue.`;
  const head = `${result.dryRun ? "Would file" : "Filed"} DRAPER's proposals for the week of ${result.week}`;
  return result.thin
    ? `${head}: none, too little evidence (${result.sent} first emails marked sent).`
    : `${head}: ${result.proposals} ${result.proposals === 1 ? "change" : "changes"}, each with its counts.`;
}
