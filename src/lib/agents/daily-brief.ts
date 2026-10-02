import { sql } from "@/lib/data-store/connection";
import { CONTACT_EMAIL, SITE_URL } from "@/lib/constants";
import { getPipelineFunnel, type PipelineFunnel } from "@/lib/data-store/pipeline-funnel";
import { escapeHtml, getTransactionalFromAddress, sendResendEmail, type EmailDeliveryStatus } from "@/lib/email/resend";
import { pipelineHealthProblems, type PipelineHealth } from "@/lib/job-health";
import { getPipelineHealth } from "@/lib/pipeline-health";
import { CREW, getCrewFeed, type CrewFeedItem } from "./crew";

/**
 * Atlas's morning brief: what ran, how the database moved since the last brief,
 * what's stuck and what needs the owner. Built from the run ledger, no model.
 */

export interface DailyBrief {
  subject: string;
  lines: string[];
}

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

/** Pure: the brief from today's numbers and (optionally) the previous brief's funnel. */
export function buildDailyBrief({
  health,
  funnel,
  previousFunnel,
  feed24h,
}: {
  health: PipelineHealth;
  funnel: PipelineFunnel;
  previousFunnel: PipelineFunnel | null;
  feed24h: CrewFeedItem[];
}): DailyBrief {
  const problems = pipelineHealthProblems(health);
  const completed = health.runs_completed_24h ?? 0;
  const failed = health.runs_failed_24h ?? 0;
  const lines: string[] = [];

  const busiest = CREW
    .map((member) => ({ name: member.name, steps: feed24h.filter((item) => item.agent === member.agent && item.tone === "ok").length }))
    .filter((member) => member.steps > 0)
    .sort((a, b) => b.steps - a.steps)
    .slice(0, 3)
    .map((member) => `${member.name} (${member.steps})`);
  lines.push(
    `What ran: ${completed} run${completed === 1 ? "" : "s"} finished, ${failed} failed${busiest.length ? `. Busiest: ${busiest.join(", ")}` : ""}.`,
  );

  if (previousFunnel) {
    const moved = FUNNEL_LABELS
      .map(([key, label]) => ({ label, delta: funnel[key] - previousFunnel[key] }))
      .filter((item) => item.delta !== 0)
      .map((item) => `${signed(item.delta)} ${item.label}`);
    lines.push(moved.length > 0 ? `Since yesterday: ${moved.join(", ")}.` : "Since yesterday: no change in the database.");
  }
  lines.push(
    `Database: ${funnel.sourcedInstitutions.toLocaleString("en-US")} of ${funnel.institutions.toLocaleString("en-US")} institutions have sourced fees; ${funnel.withFeeUrl.toLocaleString("en-US")} have a fee URL.`,
  );

  const errors = feed24h.filter((item) => item.tone === "error").slice(0, 2);
  if (problems.length === 0 && errors.length === 0) {
    lines.push("Nothing is stuck. Nothing needs you.");
  } else {
    lines.push(`Needs you: ${[...problems, ...errors.map((item) => item.text)].slice(0, 3).join(" ")}`);
  }

  const status = !health.pipeline_enabled ? "paused" : problems.length > 0 ? "needs attention" : "running";
  return {
    subject: `Atlas daily brief: pipeline ${status}, ${funnel.sourcedInstitutions.toLocaleString("en-US")} institutions published`,
    lines,
  };
}

async function previousBriefFunnel(): Promise<PipelineFunnel | null> {
  const [row] = await sql`
    SELECT e.detail
      FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id
     WHERE s.step_key = 'daily-brief'
       AND e.event_type = 'step.finished'
     ORDER BY e.created_at DESC
     LIMIT 1
  `;
  const detail = row?.detail
    ? (typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail) as Record<string, unknown>
    : null;
  return (detail?.funnel as PipelineFunnel | undefined) ?? null;
}

export interface DailyBriefResult {
  brief: DailyBrief;
  funnel: PipelineFunnel;
  deliveryStatus: EmailDeliveryStatus;
  deliveryReason: string | null;
  recipient: string;
}

/** Gathers the numbers, writes the brief and emails it. Never throws on delivery. */
export async function runDailyBrief({ dryRun = false }: { dryRun?: boolean } = {}): Promise<DailyBriefResult> {
  const [health, funnel, previousFunnel, feed] = await Promise.all([
    getPipelineHealth(),
    getPipelineFunnel(),
    previousBriefFunnel(),
    getCrewFeed({ limit: 200 }),
  ]);
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const feed24h = feed.filter((item) => new Date(item.at).getTime() >= since);
  const brief = buildDailyBrief({ health, funnel, previousFunnel, feed24h });
  const recipient = (process.env.ATLAS_BRIEF_TO || CONTACT_EMAIL).trim();
  const from = getTransactionalFromAddress();

  if (dryRun) {
    return { brief, funnel, deliveryStatus: "not_configured", deliveryReason: "dry run", recipient };
  }
  if (!from) {
    return { brief, funnel, deliveryStatus: "not_configured", deliveryReason: "TRANSACTIONAL_EMAIL_FROM is not configured.", recipient };
  }

  const crewUrl = `${SITE_URL}/admin`;
  const text = `${brief.lines.join("\n\n")}\n\nOpen the crew: ${crewUrl}\n\n— Atlas`;
  const html = `${brief.lines.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`).join("")}`
    + `<p style="margin:16px 0 0"><a href="${escapeHtml(crewUrl)}">Open the crew</a></p><p style="color:#6B6255">— Atlas</p>`;
  const result = await sendResendEmail(
    {
      from,
      to: recipient,
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
  };
}
