import type { HandoffContext, HandoffFee } from "@/lib/hamilton-handoff";
import { formatCompactDollars } from "@/lib/format";
import { feeIncomeTerms, formatReportQuarter } from "./financial-units";
import { plausibleShare, quarterlyServiceCharges, type HamiltonInsight } from "./hamilton-band";
import { aboutSame, isRange, lowerLabel, money, reference, type CompareRow } from "./profile-view";

/**
 * The connected financial and pricing panel (James's visualization brief §6, Oct 18): what the
 * call reports say, what the published schedule says beside its medians, and the questions
 * neither answers. Each kind is kept apart on the page so a comparison never reads as a cause.
 * Nothing here estimates revenue from prices: fee volumes and account mix aren't public.
 */

/** The fees the panel sets beside fee income: the three a pricing committee asks about first. */
export const PANEL_FEES = ["overdraft", "atm_non_network", "monthly_maintenance"] as const;

export type Direction = "above" | "below" | "same";

export interface PanelQuarter {
  label: string;
  value: number;
}

export interface PanelReported {
  /** "Service-charge income" or "Fee income". */
  incomeLabel: string;
  /** Standalone quarters, oldest first (NCUA year-to-date figures already converted). */
  quarters: PanelQuarter[];
  latest: PanelQuarter;
  /** Change from the first to the latest quarter shown, in percent; null with one quarter. */
  changePct: number | null;
  /** Fee income as a share of revenue in the latest quarter, as a percent value. */
  sharePct: number | null;
  /** "FDIC call report" or "NCUA 5300 call report". */
  source: string;
  /** "Bank" or "Credit union": the filing entity, never the holding company. */
  entity: string;
}

export interface PanelShare {
  own: number;
  median: number;
  peers: number;
  /** "banks with $1B to $10B in assets". */
  cohort: string;
  direction: Direction;
}

export interface PanelFee {
  key: string;
  /** "Overdraft". */
  label: string;
  /** "$35": the compared value. */
  amount: string;
  value: number;
  medianValue: number;
  /** "Middle of $7.95 to $8.95", set when it lists several prices. */
  basis: string | null;
  median: string;
  /** "FL" or "U.S.". */
  place: string;
  institutions: number;
  /** "+$5" or "−$1.50"; null when about the same. */
  difference: string | null;
  direction: Direction;
}

export interface ConnectedPanel {
  /** The one observation the panel opens with: two facts side by side, no cause. */
  observation: string;
  /** The caution that goes with it, e.g. on how few quarters it rests. */
  caution: string | null;
  reported: PanelReported;
  share: PanelShare | null;
  fees: PanelFee[];
  questions: string[];
  handoff: HandoffContext;
}

const COUNT_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];

const pct = (n: number) => `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;

function direction(own: number, median: number): Direction {
  if (aboutSame(own, median)) return "same";
  return own > median ? "above" : "below";
}

/** "Out-of-network ATM": a label as a line starts, its acronyms kept. */
function sentenceCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function signedMoney(n: number): string {
  return `${n > 0 ? "+" : "−"}${money(Math.round(Math.abs(n) * 100) / 100)}`;
}

function panelFee(row: CompareRow, stateCode: string | null): PanelFee | null {
  const ref = reference(row);
  if (row.amount == null || !ref) return null;
  const dir = direction(row.amount, ref.median.median);
  return {
    key: row.key,
    label: sentenceCase(lowerLabel(row.label)),
    amount: money(row.amount),
    value: row.amount,
    medianValue: ref.median.median,
    basis: isRange(row)
      ? `Listed at ${money(row.low as number)} to ${money(row.high as number)}; we compare the ${row.highestTier ? "highest" : "midpoint"}.`
      : null,
    median: money(ref.median.median),
    place: ref.level === "state" && stateCode ? stateCode : "U.S.",
    institutions: ref.median.institutions,
    difference: dir === "same" ? null : signedMoney(row.amount - ref.median.median),
    direction: dir,
  };
}

export function buildConnectedPanel(input: {
  institutionId: number;
  institutionName: string;
  insight: HamiltonInsight;
  /**
   * Standalone quarters, oldest first, from the page's quarterly ledger. Without it the bars are
   * worked out from `insight.quarters` (quarterlyServiceCharges).
   */
  series?: { reportDate: string; value: number; source?: string }[];
  rows: CompareRow[];
  stateCode: string | null;
  stateName: string | null;
  city: string | null;
}): ConnectedPanel | null {
  const { insight, institutionName } = input;
  const latestFiling = insight.quarters[0];
  const series = input.series ?? quarterlyServiceCharges(insight.quarters);
  if (!latestFiling || series.length === 0) return null;
  const terms = feeIncomeTerms(latestFiling.source);
  const ncua = latestFiling.source === "ncua";
  const quarters = series.map((q) => ({ label: formatReportQuarter(q.reportDate) ?? q.reportDate, value: q.value }));
  const first = quarters[0];
  const latest = quarters[quarters.length - 1];
  const changePct = quarters.length > 1 && first.value > 0 ? ((latest.value - first.value) / first.value) * 100 : null;
  const ownShare = plausibleShare(insight.ownSharePct) ? insight.ownSharePct : null;

  const plural = insight.kind === "bank" ? "banks" : "credit unions";
  const cohort = `${plural}${insight.sizeRange ? ` with ${insight.sizeRange} in assets` : " of the same asset size"}`;
  const share: PanelShare | null =
    ownShare !== null && plausibleShare(insight.peerSharePct) && (insight.peerCount ?? 0) >= 3
      ? {
          own: ownShare,
          median: insight.peerSharePct,
          peers: insight.peerCount as number,
          cohort,
          direction: direction(ownShare, insight.peerSharePct),
        }
      : null;

  const byKey = new Map(input.rows.map((row) => [row.key, row]));
  const fees = PANEL_FEES.map((key) => byKey.get(key))
    .map((row) => (row ? panelFee(row, input.stateCode) : null))
    .filter((fee): fee is PanelFee => fee !== null);

  // The observation: the trend, then the share beside its cohort. Two facts, no "because".
  const trend =
    changePct === null
      ? `${terms.amount} was ${formatCompactDollars(latest.value)} in ${latest.label}.`
      : Math.abs(changePct) < 1
        ? `${terms.amount} was about level from ${first.label} to ${latest.label}, at ${formatCompactDollars(latest.value)}.`
        : `${terms.amount} ${changePct > 0 ? "rose" : "fell"} ${pct(Math.abs(changePct))} from ${first.label} to ${latest.label}, to ${formatCompactDollars(latest.value)}.`;
  // A credit union's bars can end before its latest filing; then the share names its own quarter.
  const filedQuarter = formatReportQuarter(latestFiling.reportDate);
  const shareQuarter = filedQuarter && filedQuarter !== latest.label ? ` in ${filedQuarter}` : "";
  const shareLine = share
    ? share.direction === "same"
      ? ` Its share of revenue${shareQuarter}, ${pct(share.own)}, is about the same as the ${pct(share.median)} median for ${cohort}.`
      : ` Its share of revenue${shareQuarter}, ${pct(share.own)}, is ${share.direction} the ${pct(share.median)} median for ${cohort}.`
    : "";
  const caution =
    quarters.length > 1 && quarters.length < 8 ? `${COUNT_WORDS[quarters.length]} quarters are too few to call a trend.` : null;

  // Questions the figures raise and can't answer. Asked, never answered.
  const questions: string[] = [];
  if (share && share.direction !== "same") {
    questions.push(
      share.direction === "above"
        ? `How much of the higher share comes from how often fees are charged, rather than what they cost?`
        : `Is the lower share a matter of price, waivers, or a different mix of accounts?`,
    );
  }
  if (fees.some((fee) => fee.direction === "above")) {
    questions.push("Do waivers and balance requirements change what most customers actually pay?");
  }
  questions.push(
    ncua
      ? "Which fees make up most of fee income, and has that mix changed?"
      : "Do business accounts and account analysis fees make up more of service charges than at peers?",
  );

  const handoffFees: HandoffFee[] = fees.map((fee) => ({
    key: fee.key,
    label: lowerLabel(fee.label),
    amount: fee.amount,
    against: `the ${fee.place === "U.S." ? "U.S." : (input.stateName ?? fee.place)} median of ${fee.median}`,
  }));

  return {
    observation: `${trend}${shareLine}`,
    caution,
    reported: {
      incomeLabel: terms.amount,
      quarters,
      latest,
      changePct,
      sharePct: ownShare,
      source: ncua
        ? "NCUA 5300 call report"
        : input.series?.some((q) => q.source === "ffiec")
          ? "FFIEC call report"
          : "FDIC call report",
      entity: ncua ? "Credit union" : "Bank",
    },
    share,
    fees,
    questions: questions.slice(0, 3),
    handoff: {
      institutionId: input.institutionId,
      institutionName,
      kind: insight.kind,
      place: [input.city, input.stateName].filter(Boolean).join(", ") || null,
      quarter: formatReportQuarter(latestFiling.reportDate),
      ownSharePct: share?.own ?? null,
      peerSharePct: share?.median ?? null,
      peerCount: share?.peers ?? null,
      sizeRange: insight.sizeRange,
      incomeLabel: terms.amount,
      fees: handoffFees,
    },
  };
}
