/**
 * Hamilton's monthly marketing plan: which email formats to send, chosen from a rotating
 * catalog so readers never get the same kind of email three times running (James,
 * 2026-10-06: "after 3 of the same, unsubscribes will pop"). Past results steer the pick.
 * Pure functions; the run step reads results from `pipeline_feedback`.
 */

export const MARKETING_FORMATS = [
  {
    key: "market_move",
    label: "This month's numbers",
    brief: "The national fee numbers this month, led by the most-covered fee, and how many more institutions stand behind them than last month. Medians are compared with the middle half, never with last month.",
  },
  {
    key: "state_spotlight",
    label: "State spotlight",
    brief: "One state's headline fees against the national median: where it is cheaper, where it is pricier, and how many institutions stand behind each number.",
  },
  {
    key: "fee_deep_dive",
    label: "One fee, in depth",
    brief: "One headline fee explained: what it is, the national median and middle half, banks against credit unions, and the questions a pricing committee should ask about it.",
  },
  {
    key: "bank_vs_cu",
    label: "Banks against credit unions",
    brief: "Where banks and credit unions price the same fee differently, using only fees with enough institutions on both sides.",
  },
  {
    key: "pricing_playbook",
    label: "Pricing committee playbook",
    brief: "A practical how-to for a bank or credit union pricing committee (agenda, peer group, outlier rule), with two or three national numbers as reference points.",
  },
  {
    key: "myth_check",
    label: "Myth check",
    brief: "One common belief about bank fees checked against the data, with the verdict stated plainly.",
  },
  {
    key: "guess_the_median",
    label: "Guess the median",
    brief: "A short quiz: the reader guesses the national median for three fees, and the answers sit below with one line of context each.",
  },
] as const;

export type MarketingFormatKey = (typeof MARKETING_FORMATS)[number]["key"];

/** Campaigns per month. Two keeps the list warm without wearing it out. */
export const CAMPAIGNS_PER_MONTH = 2;
/** A format sits out this many months after it is used. */
export const FORMAT_COOLDOWN_MONTHS = 3;
/** Below this many recipients a result is too small to learn from. */
export const MIN_RECIPIENTS_TO_LEARN = 100;

export interface CampaignResult {
  format: string;
  month: string;
  recipients: number;
  openRate: number;
  clickRate: number;
  unsubscribeRate: number;
}

/**
 * One score per campaign, 0 to 100. Clicks matter most because they bring readers to the
 * site; unsubscribes cost five times what a click earns, since a lost reader is gone.
 */
export function scoreCampaign(result: Pick<CampaignResult, "openRate" | "clickRate" | "unsubscribeRate">): number {
  const raw = 100 * (0.3 * result.openRate + 2 * result.clickRate - 10 * result.unsubscribeRate);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function isLearnable(result: Pick<CampaignResult, "recipients">): boolean {
  return result.recipients >= MIN_RECIPIENTS_TO_LEARN;
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/**
 * Picks this month's formats. Formats used in the last FORMAT_COOLDOWN_MONTHS months sit
 * out. The rest rank by their average learnable score (unscored formats get the middle
 * score so new ones get tried), then by how long since they last ran.
 */
export function planMonth(month: string, history: CampaignResult[], count = CAMPAIGNS_PER_MONTH): MarketingFormatKey[] {
  const lastUsed = new Map<string, string>();
  const scores = new Map<string, number[]>();
  for (const result of history) {
    const previous = lastUsed.get(result.format);
    if (!previous || previous < result.month) lastUsed.set(result.format, result.month);
    if (isLearnable(result)) {
      scores.set(result.format, [...(scores.get(result.format) ?? []), scoreCampaign(result)]);
    }
  }
  const learned = [...scores.values()].flat();
  const middle = learned.length ? learned.reduce((sum, value) => sum + value, 0) / learned.length : 50;

  const ranked = MARKETING_FORMATS.map((format) => {
    const used = lastUsed.get(format.key);
    const gap = used ? monthsBetween(used, month) : Number.POSITIVE_INFINITY;
    const own = scores.get(format.key);
    const average = own?.length ? own.reduce((sum, value) => sum + value, 0) / own.length : middle;
    return { key: format.key, gap, average };
  });
  const rested = ranked.filter((format) => format.gap > FORMAT_COOLDOWN_MONTHS);
  const pool = rested.length >= count ? rested : ranked;
  return pool
    .sort((a, b) => b.average - a.average || b.gap - a.gap || a.key.localeCompare(b.key))
    .slice(0, count)
    .map((format) => format.key);
}

export function formatBrief(key: string) {
  return MARKETING_FORMATS.find((format) => format.key === key);
}

/** Every agent campaign in MailerLite is named with this prefix, so the agent can find its own. */
export const CAMPAIGN_NAME_PREFIX = "FI Agent";

export function campaignName(month: string, format: string, label: string): string {
  return `${CAMPAIGN_NAME_PREFIX} ${month} · ${format} · ${label}`;
}

/** `FI Agent 2026-11 · state_spotlight · ...` → { month, format }, or null for other campaigns. */
export function parseCampaignName(name: string): { month: string; format: string } | null {
  const match = new RegExp(`^${CAMPAIGN_NAME_PREFIX} (\\d{4}-\\d{2}) · ([a-z_]+) · `).exec(name);
  return match ? { month: match[1], format: match[2] } : null;
}
