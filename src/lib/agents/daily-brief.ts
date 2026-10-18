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
import { goalBriefLines, readGoalScorecard, type GoalScorecard } from "./goal-scorecard";
import { qualityLedgerLines, readQualityLedger, type QualityLedger } from "./quality-ledger";
import { STORAGE_STEP_KEY } from "./atlas/storage-retention";
import { readSourceHealth, sourceHealthLines, urgentSourceCount, type SourceHealthReport } from "./hoovie/source-health";

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

// "Documents downloaded" was an all-time count of distinct stored files, wrong pages
// included (#1040); the goal lines below say what moved instead.
const FUNNEL_LABELS: Array<[keyof PipelineFunnel, string]> = [
  ["withFeeUrl", "fee URLs"],
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

/** Atlas's newest storage warnings (`atlas-storage-retention`), and when that step ran. */
export interface StorageWarning {
  alerts: string[];
  at: string;
}

/**
 * A storage measurement older than this is not repeated in the brief. The brief runs at 12:00 UTC
 * and the storage step at 12:17 UTC, so the brief normally reads the previous day's measurement;
 * 36 hours allows one late run without repeating a warning from two days back.
 */
export const STORAGE_WARNING_MAX_AGE_HOURS = 36;

/** Pure: the brief's storage lines, one per warning; none when there is no warning. */
export function storageWarningLines(storage: StorageWarning | null | undefined): string[] {
  if (!storage || storage.alerts.length === 0) return [];
  return storage.alerts.map((alert) => `Storage: ${alert}.`);
}

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
  goal,
  ledger,
  storage,
  sources,
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
  /** The goal scorecard (#1040): the same numbers as /admin/scoreboard. */
  goal?: GoalScorecard | null;
  /** The quality ledger James reads on #1026 (Oct 15), copied into the email. */
  ledger?: QualityLedger | null;
  /** Atlas's storage warnings; the brief mentions storage only on a day with a warning. */
  storage?: StorageWarning | null;
  /**
   * Hoovie's source health report (#1866), read when the brief runs; the brief lists only the
   * sources that are not fresh, and says nothing about public data when every source is fresh.
   */
  sources?: SourceHealthReport | null;
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

  if (goal) {
    lines.push(["The goal (last 7 days):", ...goalBriefLines(goal).map((line) => `- ${line}`)].join("\n"));
  }
  if (ledger) {
    lines.push(["Quality ledger (live fees now):", ...qualityLedgerLines(ledger).map((line) => `- ${line}`)].join("\n"));
  }

  if (spend) {
    const caps = spend.total.dailyCapUsd !== null ? ` of the $${spend.total.dailyCapUsd} daily cap` : "";
    lines.push(
      `Spend: $${spend.total.todayUsd.toFixed(2)} so far today${caps}; $${spend.total.monthUsd.toFixed(2)} this month${spend.total.monthlyCapUsd !== null ? ` of $${spend.total.monthlyCapUsd}` : ""}.`,
    );
  }

  const sourceLines = sourceHealthLines(sources);
  if (sourceLines.length > 0) lines.push(sourceLines.join("\n"));
  const urgentSources = urgentSourceCount(sources);
  const sourceSubject = urgentSources > 0 ? `, ${urgentSources} public source${urgentSources === 1 ? "" : "s"} failed or empty` : "";

  const status = !health.pipeline_enabled ? "paused" : problems.length > 0 ? "needs attention" : "running";
  const storageLines = storageWarningLines(storage);

  if (needsYou) {
    const shown = needsYou.slice(0, NEEDS_YOU_IN_EMAIL).map((item) => `- ${item.title}`);
    const more = needsYou.length > shown.length ? [`- and ${needsYou.length - shown.length} more in the console`] : [];
    const problemLines = [...problems, ...storageLines].map((problem) => `- ${problem}`);
    const headline = needsYou.length === 0 && problems.length === 0
      ? storageLines.length > 0 ? "Storage warning." : urgentSources > 0 ? "Public data warning." : "Nothing needs you."
      : needsYouHeadline(needsYou);
    lines.unshift([headline, ...problemLines, ...shown, ...more].join("\n"));
    const storageSubject = storageLines.length > 0 && headline !== "Storage warning." ? ", storage warning" : "";
    return {
      subject: `Morning brief: ${headline.replace(/\.$/, "").toLowerCase()}${storageSubject}${headline === "Public data warning." ? "" : sourceSubject}, pipeline ${status}`,
      lines,
      needsYou,
    };
  }

  const errors = feed24h.filter((item) => item.tone === "error").slice(0, 2);
  if (problems.length === 0 && errors.length === 0 && storageLines.length === 0 && urgentSources === 0) {
    lines.push("Nothing is stuck. Nothing needs you.");
  } else if (problems.length > 0 || errors.length > 0) {
    lines.push(`Needs you: ${[...problems, ...errors.map((item) => item.text)].slice(0, 3).join(" ")}`);
  }
  lines.push(...storageLines);

  return {
    subject: `Atlas daily brief: pipeline ${status}${storageLines.length > 0 ? ", storage warning" : ""}${sourceSubject}, ${funnel.sourcedInstitutions.toLocaleString("en-US")} institutions published`,
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

/** Atlas's newest storage step result, when it ran within STORAGE_WARNING_MAX_AGE_HOURS. */
async function latestStorageWarning(): Promise<StorageWarning | null> {
  const [row] = await sql`
    SELECT e.detail->'alerts' AS alerts, e.created_at
      FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id
     WHERE s.step_key = ${STORAGE_STEP_KEY}
       AND e.event_type = 'step.finished'
       AND e.status = 'completed'
       AND e.created_at >= NOW() - make_interval(hours => ${STORAGE_WARNING_MAX_AGE_HOURS}::int)
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 1
  `;
  if (!row) return null;
  const raw = typeof row.alerts === "string" ? JSON.parse(row.alerts) : row.alerts;
  const alerts = Array.isArray(raw) ? raw.filter((alert): alert is string => typeof alert === "string") : [];
  return { alerts, at: new Date(row.created_at as string | Date).toISOString() };
}

/** Steps each agent finished in the last 24 hours, straight from the ledger (no feed cap). Registry steps under Magellan's name before #1865 are Hoovie's. */
async function stepsFinishedByAgent(): Promise<Record<string, number>> {
  const rows = await sql`
    SELECT CASE WHEN COALESCE(s.agent_name, r.agent_name) = 'magellan' AND s.step_key LIKE 'registry-%' THEN 'hoovie'
                ELSE COALESCE(s.agent_name, r.agent_name) END AS agent, COUNT(*)::int AS steps
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
  const [health, funnel, previous, stepsByAgent, feed, center, failureAlerts, leads, spend, goal, ledger, storage, sources] = await Promise.all([
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
    readGoalScorecard().catch((error) => {
      console.error("Morning brief goal read failed", error);
      return null;
    }),
    readQualityLedger().catch((error) => {
      console.error("Morning brief quality ledger read failed", error);
      return null;
    }),
    latestStorageWarning().catch((error) => {
      console.error("Morning brief storage read failed", error);
      return null;
    }),
    // Read now, not from Deming's step: the scoreboard run (12:17 UTC) comes after the brief (12:00
    // UTC), so its report would be a day late for a load that failed overnight.
    readSourceHealth({ now }).catch((error) => {
      console.error("Morning brief source health read failed", error);
      return null;
    }),
  ]);
  const since = now.getTime() - DAY_MS;
  const feed24h = feed.filter((item) => new Date(item.at).getTime() >= since);
  // Without Atlas's attention list the Needs-you count would be short, so the brief falls back to its older summary.
  const needsYou = center ? buildNeedsYou({ attention: center.attention, failureAlerts, leads, now }) : undefined;
  const brief = buildDailyBrief({ health, funnel, previous, stepsByAgent, feed24h, needsYou, spend, goal, ledger, storage, sources, now });
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
