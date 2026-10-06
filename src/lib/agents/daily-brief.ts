import { sql } from "@/lib/data-store/connection";
import { CONTACT_EMAIL, SITE_URL } from "@/lib/constants";
import { getPipelineFunnel, type PipelineFunnel } from "@/lib/data-store/pipeline-funnel";
import { escapeHtml, getTransactionalFromAddress, sendResendEmail, type EmailDeliveryStatus } from "@/lib/email/resend";
import { pipelineHealthProblems, type PipelineHealth } from "@/lib/job-health";
import { getPipelineHealth } from "@/lib/pipeline-health";
import { CREW, getCrewFeed, type CrewFeedItem } from "./crew";
import { getAtlasCommandCenter } from "@/lib/admin-command-center";
import { getLeads } from "@/lib/admin-queries";
import { buildNeedsYou, needsYouHeadline, type NeedsYouItem } from "@/lib/console/needs-you";
import { getSpendSummary, type SpendSummary } from "@/lib/data-store/console-spend";
import { getFailureAlerts } from "./failure-alerts";

/**
 * Atlas's morning brief: what ran, how the database moved since the last brief,
 * what's stuck and what needs the owner. Built from the run ledger, no model.
 */

export interface DailyBrief {
  subject: string;
  lines: string[];
  /** The console's Needs-you list, when it was gathered. */
  needsYou?: NeedsYouItem[];
}

/** People who get the morning brief. ATLAS_BRIEF_TO and ATLAS_BRIEF_CC (comma-separated) override. */
export const BRIEF_CC_DEFAULT = ["jlgilmore2@gmail.com"];

export function briefRecipients(env: Record<string, string | undefined> = process.env): { to: string; cc: string[] } {
  const to = (env.ATLAS_BRIEF_TO || CONTACT_EMAIL).trim();
  const cc = (env.ATLAS_BRIEF_CC !== undefined ? env.ATLAS_BRIEF_CC.split(",") : BRIEF_CC_DEFAULT)
    .map((address) => address.trim())
    .filter((address) => address && address.toLowerCase() !== to.toLowerCase());
  return { to, cc };
}

const NEEDS_YOU_IN_EMAIL = 6;

const FUNNEL_LABELS: Array<[keyof PipelineFunnel, string]> = [
  ["withFeeUrl", "fee URLs"],
  ["documentsFetched", "documents downloaded"],
  ["textsRead", "documents read"],
  ["rawExtracted", "fees extracted"],
  ["verified", "fees verified"],
  ["sourcedInstitutions", "institutions published"],
];

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("en-US")}`;
}

/** The funnel recorded by an earlier brief, and when that brief ran. */
export interface PreviousBrief {
  funnel: PipelineFunnel;
  at: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(value: Date): number {
  return Math.floor(value.getTime() / DAY_MS);
}

/** "Since yesterday" only when the last brief really was yesterday (UTC); otherwise name its date. */
function sinceLabel(previousAt: string, now: Date): string {
  const then = new Date(previousAt);
  if (utcDay(now) - utcDay(then) === 1) return "Since yesterday";
  const date = then.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `Since the last brief (${date})`;
}

/** Pure: the brief from today's numbers and (optionally) the previous brief's funnel. */
export function buildDailyBrief({
  health,
  funnel,
  previous,
  stepsByAgent,
  feed24h,
  needsYou,
  spend,
  now = new Date(),
}: {
  health: PipelineHealth;
  funnel: PipelineFunnel;
  previous: PreviousBrief | null;
  /** Steps each agent finished in the last 24 hours, counted in the ledger. */
  stepsByAgent: Partial<Record<string, number>>;
  feed24h: CrewFeedItem[];
  /** When given, the brief leads with the console's Needs-you list. */
  needsYou?: NeedsYouItem[];
  spend?: SpendSummary | null;
  now?: Date;
}): DailyBrief {
  const problems = pipelineHealthProblems(health);
  const completed = health.runs_completed_24h ?? 0;
  const failed = health.runs_failed_24h ?? 0;
  const lines: string[] = [];

  const busiest = CREW
    .map((member) => ({ name: member.name, steps: stepsByAgent[member.agent] ?? 0 }))
    .filter((member) => member.steps > 0)
    .sort((a, b) => b.steps - a.steps)
    .slice(0, 3)
    .map((member) => `${member.name} (${member.steps})`);
  lines.push(
    `What ran: ${completed} run${completed === 1 ? "" : "s"} finished, ${failed} failed${busiest.length ? `. Busiest: ${busiest.join(", ")}` : ""}.`,
  );

  if (previous) {
    const label = sinceLabel(previous.at, now);
    const moved = FUNNEL_LABELS
      .map(([key, name]) => ({ name, delta: funnel[key] - previous.funnel[key] }))
      .filter((item) => item.delta !== 0)
      .map((item) => `${signed(item.delta)} ${item.name}`);
    lines.push(moved.length > 0 ? `${label}: ${moved.join(", ")}.` : `${label}: no change in the database.`);
  }
  lines.push(
    `Database: ${funnel.sourcedInstitutions.toLocaleString("en-US")} of ${funnel.institutions.toLocaleString("en-US")} institutions have sourced fees; ${funnel.withFeeUrl.toLocaleString("en-US")} have a fee URL.`,
  );

  if (spend) {
    const caps = spend.total.dailyCapUsd !== null ? ` of the $${spend.total.dailyCapUsd} daily cap` : "";
    lines.push(
      `Spend: $${spend.total.todayUsd.toFixed(2)} so far today${caps}; $${spend.total.monthUsd.toFixed(2)} this month${spend.total.monthlyCapUsd !== null ? ` of $${spend.total.monthlyCapUsd}` : ""}.`,
    );
  }

  const status = !health.pipeline_enabled ? "paused" : problems.length > 0 ? "needs attention" : "running";

  if (needsYou) {
    const shown = needsYou.slice(0, NEEDS_YOU_IN_EMAIL).map((item) => `- ${item.title}`);
    const more = needsYou.length > shown.length ? [`- and ${needsYou.length - shown.length} more in the console`] : [];
    const problemLines = problems.map((problem) => `- ${problem}`);
    const headline = needsYou.length === 0 && problems.length === 0 ? "Nothing needs you." : needsYouHeadline(needsYou);
    lines.unshift([headline, ...problemLines, ...shown, ...more].join("\n"));
    return {
      subject: `Morning brief: ${headline.replace(/\.$/, "").toLowerCase()}, pipeline ${status}`,
      lines,
      needsYou,
    };
  }

  const errors = feed24h.filter((item) => item.tone === "error").slice(0, 2);
  if (problems.length === 0 && errors.length === 0) {
    lines.push("Nothing is stuck. Nothing needs you.");
  } else {
    lines.push(`Needs you: ${[...problems, ...errors.map((item) => item.text)].slice(0, 3).join(" ")}`);
  }

  return {
    subject: `Atlas daily brief: pipeline ${status}, ${funnel.sourcedInstitutions.toLocaleString("en-US")} institutions published`,
    lines,
  };
}

/**
 * The newest real brief from an earlier UTC day. Dry runs and same-day re-runs are
 * skipped so a manual run never resets the day-over-day comparison.
 */
async function previousBrief(now: Date): Promise<PreviousBrief | null> {
  const startOfToday = new Date(utcDay(now) * DAY_MS).toISOString();
  const [row] = await sql`
    SELECT e.detail, e.created_at
      FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id
      JOIN agent_runs r ON r.id = e.agent_run_id
     WHERE s.step_key = 'daily-brief'
       AND e.event_type = 'step.finished'
       AND e.status = 'completed'
       AND r.run_kind <> 'dry_run'
       AND e.created_at < ${startOfToday}
     ORDER BY e.created_at DESC
     LIMIT 1
  `;
  const detail = row?.detail
    ? (typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail) as Record<string, unknown>
    : null;
  const funnel = detail?.funnel as PipelineFunnel | undefined;
  return funnel ? { funnel, at: new Date(row.created_at as string | Date).toISOString() } : null;
}

/** Steps each agent finished in the last 24 hours, straight from the ledger (no feed cap). */
async function stepsFinishedByAgent(): Promise<Record<string, number>> {
  const rows = await sql`
    SELECT COALESCE(s.agent_name, r.agent_name) AS agent, COUNT(*)::int AS steps
      FROM agent_run_events e
      JOIN agent_runs r ON r.id = e.agent_run_id
      LEFT JOIN agent_run_steps s ON s.id = e.step_id
     WHERE e.event_type = 'step.finished'
       AND e.status = 'completed'
       AND e.created_at >= NOW() - INTERVAL '24 hours'
     GROUP BY 1
  `;
  return Object.fromEntries(rows.map((row) => [String(row.agent), Number(row.steps)]));
}

export interface DailyBriefResult {
  brief: DailyBrief;
  funnel: PipelineFunnel;
  deliveryStatus: EmailDeliveryStatus;
  deliveryReason: string | null;
  recipient: string;
  cc: string[];
}

/** Gathers the numbers, writes the brief and emails it. Never throws on delivery. */
export async function runDailyBrief({ dryRun = false }: { dryRun?: boolean } = {}): Promise<DailyBriefResult> {
  const now = new Date();
  const [health, funnel, previous, stepsByAgent, feed, center, failureAlerts, leads, spend] = await Promise.all([
    getPipelineHealth(),
    getPipelineFunnel(),
    previousBrief(now),
    stepsFinishedByAgent(),
    getCrewFeed({ limit: 200 }),
    getAtlasCommandCenter().catch((error) => {
      console.error("Morning brief attention read failed", error);
      return null;
    }),
    getFailureAlerts(),
    getLeads(),
    getSpendSummary().catch((error) => {
      console.error("Morning brief spend read failed", error);
      return null;
    }),
  ]);
  const since = now.getTime() - DAY_MS;
  const feed24h = feed.filter((item) => new Date(item.at).getTime() >= since);
  // Without Atlas's attention list the Needs-you count would be short, so the brief falls back to its older summary.
  const needsYou = center ? buildNeedsYou({ attention: center.attention, failureAlerts, leads, now }) : undefined;
  const brief = buildDailyBrief({ health, funnel, previous, stepsByAgent, feed24h, needsYou, spend, now });
  const { to: recipient, cc } = briefRecipients();
  const from = getTransactionalFromAddress();

  if (dryRun) {
    return { brief, funnel, deliveryStatus: "not_configured", deliveryReason: "dry run", recipient, cc };
  }
  if (!from) {
    return { brief, funnel, deliveryStatus: "not_configured", deliveryReason: "TRANSACTIONAL_EMAIL_FROM is not configured.", recipient, cc };
  }

  const crewUrl = `${SITE_URL}/admin`;
  const text = `${brief.lines.join("\n\n")}\n\nOpen the console: ${crewUrl}\n\n— Atlas`;
  const html = `${brief.lines.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line).replace(/\n/g, "<br>")}</p>`).join("")}`
    + `<p style="margin:16px 0 0"><a href="${escapeHtml(crewUrl)}">Open the console</a></p><p style="color:#6B6255">— Atlas</p>`;
  const result = await sendResendEmail(
    {
      from,
      to: recipient,
      cc,
      subject: brief.subject,
      text,
      html,
      idempotencyKey: `atlas-daily-brief-${new Date().toISOString().slice(0, 10)}`,
    },
    "the Atlas daily brief",
  );
  return {
    brief,
    funnel,
    deliveryStatus: result.status,
    deliveryReason: result.status === "sent" ? null : result.status === "failed" ? result.error : result.reason,
    recipient,
    cc,
  };
}
