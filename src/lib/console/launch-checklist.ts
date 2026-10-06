import type { SpendSummary } from "@/lib/data-store/console-spend";

/**
 * Launch checklist: each line is a live check against settings or tables. A line
 * the app cannot check says so ("unknown") with where to look; it is never marked
 * done on a guess.
 */

export type CheckState = "done" | "not_done" | "partial" | "unknown";

export interface LaunchCheck {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
  href?: string;
}

/** Agents that make paid model calls, each meant to have its own key (ANTHROPIC_API_KEY_<AGENT>). */
export const PAID_AGENTS = ["magellan", "rosetta", "knox", "darwin", "hamilton"] as const;

export interface LaunchInputs {
  env: Record<string, string | undefined>;
  spend: SpendSummary | null;
  /** Markets passing the report gate, or null when unreadable. */
  readyMarkets: number | null;
  /** Reports in the public library, or null when unreadable. */
  libraryReports: number | null;
}

const set = (value: string | undefined) => Boolean(value && value.trim());

export function buildLaunchChecklist({ env, spend, readyMarkets, libraryReports }: LaunchInputs): LaunchCheck[] {
  const checks: LaunchCheck[] = [];

  const emailReady = set(env.RESEND_API_KEY) && set(env.TRANSACTIONAL_EMAIL_FROM || env.EMAIL_FROM);
  checks.push({
    key: "email",
    label: "Email can send (reports, lead alerts, morning brief)",
    state: emailReady ? "done" : "not_done",
    detail: emailReady
      ? "Resend key and From address are set."
      : `Missing in Vercel: ${[!set(env.RESEND_API_KEY) && "RESEND_API_KEY", !set(env.TRANSACTIONAL_EMAIL_FROM || env.EMAIL_FROM) && "TRANSACTIONAL_EMAIL_FROM"].filter(Boolean).join(", ")}.`,
  });

  checks.push({
    key: "cron",
    label: "Scheduled jobs are protected",
    state: set(env.CRON_SECRET) ? "done" : "not_done",
    detail: set(env.CRON_SECRET) ? "CRON_SECRET is set." : "CRON_SECRET is missing in Vercel, so scheduled jobs can't prove who called them.",
  });

  if (!spend) {
    checks.push({ key: "caps", label: "Spending caps are on", state: "unknown", detail: "Budget policies could not be read.", href: "/admin/api-trust" });
  } else {
    const capsOn = spend.total.enabled && spend.total.dailyCapUsd !== null && spend.total.monthlyCapUsd !== null;
    checks.push({
      key: "caps",
      label: "Spending caps are on",
      state: capsOn ? "done" : "not_done",
      detail: capsOn
        ? `All agents: $${spend.total.dailyCapUsd} a day, $${spend.total.monthlyCapUsd} a month.`
        : "The all-agents cap is off or missing a daily or monthly limit.",
      href: "/admin/api-trust",
    });
  }

  const shared = PAID_AGENTS.filter((agent) => !set(env[`ANTHROPIC_API_KEY_${agent.toUpperCase()}`]));
  const anyKey = set(env.ANTHROPIC_API_KEY) || shared.length < PAID_AGENTS.length;
  checks.push({
    key: "agent-keys",
    label: "Each agent has its own API key",
    state: !anyKey ? "not_done" : shared.length === 0 ? "done" : shared.length === PAID_AGENTS.length ? "not_done" : "partial",
    detail: !anyKey
      ? "No Anthropic key is set, so paid steps can't run."
      : shared.length === 0
        ? "All five paid agents use their own key."
        : `Using the shared key: ${shared.map((agent) => agent[0].toUpperCase() + agent.slice(1)).join(", ")}.`,
  });

  checks.push({
    key: "markets",
    label: "At least one market is ready for a report",
    state: readyMarkets === null ? "unknown" : readyMarkets > 0 ? "done" : "not_done",
    detail: readyMarkets === null ? "Market readiness could not be read." : `${readyMarkets} market${readyMarkets === 1 ? "" : "s"} pass the report gate.`,
    href: "/admin/customers",
  });

  checks.push({
    key: "library",
    label: "A current report is in the public library",
    state: libraryReports === null ? "unknown" : libraryReports > 0 ? "done" : "not_done",
    detail: libraryReports === null ? "The library could not be read." : `${libraryReports} report${libraryReports === 1 ? "" : "s"} published.`,
    href: "/admin/publishing",
  });

  checks.push({
    key: "accuracy",
    label: "Accuracy at 95% of live fees",
    state: "unknown",
    detail: "Not stored as a live number yet; the last hand-checked sample is on the Scoreboard.",
    href: "/admin/scoreboard",
  });

  checks.push({
    key: "analytics",
    label: "Vercel Web Analytics is on",
    state: "unknown",
    detail: "The app can't see this setting. Check Vercel, then Analytics.",
  });

  return checks;
}
