/**
 * The Command center dashboard (Hamilton redesign, Nov 2026): pure builders that turn the reads the
 * page already makes into the plain, serialisable props of the dashboard kit
 * (src/components/hamilton/dashboard). No read and no model call here; the server read is
 * command-center-read.ts.
 *
 * Rules it keeps:
 *   - every figure is a filed or published one; a quarter or fee with nothing on file stays empty
 *     ("—"), never estimated;
 *   - a fee gets a median and middle half only when MIN_PEERS_FOR_POSITION institutions in the group
 *     publish it (marketLayer); below that the row shows the spread and says too few;
 *   - fees are dollar amounts from published_fee_catalog; a fee stated as a rate is never pooled here;
 *   - service charges as a share of deposits is compared only between institutions that file the
 *     same report (an NCUA fee income line is not a bank's deposit service charges);
 *   - names the site never shows (neverNamed) are left out of every named list.
 */

import type { FinancialPoint } from "@/app/(public)/institution/[id]/financial-history";
import type { FeePositionDatum, SortableColumn, SortableRow, TrendSeries } from "@/components/hamilton/dashboard/kit-math";
import type { KpiTone } from "@/components/hamilton/dashboard/KpiCard";
import { formatFigure, quarterLabel, shortQuarterLabel } from "@/components/hamilton/dashboard/format";
import { countedAmounts } from "@/lib/data-store/counted-amounts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { neverNamed } from "@/lib/never-named";
import { hrefWithInstitutionContext } from "../context-link";
import { marketLayer } from "../workspace/context";
import { proseFeeName } from "../workspace/names";
import type { BriefingLocalMarket, FeePositionRow, PeerValue } from "../workspace/types";

/** Quarters the trend chart and sparklines show. */
export const DASHBOARD_QUARTERS = 12;

export type KpiKey = "fees" | "roa" | "nim" | "efficiency";

export interface DashboardKpi {
  key: KpiKey;
  label: string;
  value: string;
  sub: string | null;
  subTone: KpiTone;
  spark: (number | null)[];
}

export interface DashboardFinancials {
  source: "fdic" | "ncua";
  /** "Q2 2026": the newest quarter on file. */
  latestQuarter: string;
  kpis: DashboardKpi[];
  trend: { quarters: string[]; axis: string[]; series: TrendSeries[] };
  /** Whole dollars, from the newest filed quarter. */
  assets: number | null;
  /** One short source line under the trend chart. */
  footnote: string;
  /** The caveats behind it, folded in a collapsed details element. */
  footnoteDetails: string;
}

function filingName(source: "fdic" | "ncua"): string {
  return source === "ncua" ? "NCUA 5300 call reports" : "FDIC call reports";
}

function sum(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

/** Quarter ends three months apart, so four points are four consecutive quarters. */
function consecutive(points: FinancialPoint[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const [y0, m0] = points[i - 1].reportDate.split("-").map(Number);
    const [y1, m1] = points[i].reportDate.split("-").map(Number);
    if ((y1 * 12 + m1) - (y0 * 12 + m0) !== 3) return false;
  }
  return true;
}

/** The last four quarters' total, and the four before; null where any quarter is missing. */
export function trailingFour(points: FinancialPoint[], pick: (p: FinancialPoint) => number | null): { latest: number | null; prior: number | null } {
  const last4 = points.slice(-4);
  const prior4 = points.slice(-8, -4);
  const latest = last4.length === 4 && consecutive(last4) ? sum(last4.map(pick)) : null;
  const prior = latest !== null && prior4.length === 4 && consecutive(points.slice(-8)) ? sum(prior4.map(pick)) : null;
  return { latest, prior };
}

function pointsChange(now: number | null, before: number | null, better: "up" | "down"): { sub: string | null; tone: KpiTone } {
  if (now === null || before === null) return { sub: null, tone: "neutral" };
  const diff = now - before;
  if (Math.abs(diff) < 0.005) return { sub: "● Unchanged on the year", tone: "neutral" };
  const good = (diff > 0) === (better === "up");
  const words = better === "down" ? (good ? " (better)" : " (worse)") : "";
  return { sub: `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(2)} pts on the year${words}`, tone: good ? "good" : "bad" };
}

/**
 * The four headline figures and the trend chart from the institution's filed quarters (oldest
 * first, one per quarter, as buildFinancialSeries gives them). Null with no filed quarter.
 */
export function buildDashboardFinancials(series: FinancialPoint[]): DashboardFinancials | null {
  const points = series.slice(-DASHBOARD_QUARTERS);
  const latest = points[points.length - 1];
  if (!latest) return null;
  const source: "fdic" | "ncua" = latest.source === "ncua" ? "ncua" : "fdic";
  const feeWord = source === "ncua" ? "Fee income" : "Service charges";
  const yearAgo = points.length >= 5 ? points[points.length - 5] : null;
  const yearAgoOk = yearAgo !== null && consecutive(points.slice(-5));

  const fees = trailingFour(points, (p) => p.serviceCharges);
  const feeChange = fees.latest !== null && fees.prior !== null && fees.prior > 0 ? ((fees.latest - fees.prior) / fees.prior) * 100 : null;
  const roa = pointsChange(latest.roaPct, yearAgoOk ? yearAgo!.roaPct : null, "up");
  const nim = pointsChange(latest.nimPct, yearAgoOk ? yearAgo!.nimPct : null, "up");
  const eff = pointsChange(latest.efficiencyPct, yearAgoOk ? yearAgo!.efficiencyPct : null, "down");

  const kpis: DashboardKpi[] = [
    {
      key: "fees",
      label: `${feeWord}, last 4 quarters`,
      value: formatFigure(fees.latest, "dollars"),
      sub: feeChange === null
        ? (fees.latest === null ? "Four filed quarters are not on file" : null)
        : `${feeChange >= 0 ? "▲" : "▼"} ${Math.abs(feeChange).toFixed(1)}% on the four quarters before`,
      subTone: "neutral",
      spark: points.map((p) => p.serviceCharges),
    },
    { key: "roa", label: "Return on assets", value: formatFigure(latest.roaPct, "percent"), sub: roa.sub, subTone: roa.tone, spark: points.map((p) => p.roaPct) },
    { key: "nim", label: "Net interest margin", value: formatFigure(latest.nimPct, "percent"), sub: nim.sub, subTone: nim.tone, spark: points.map((p) => p.nimPct) },
    { key: "efficiency", label: "Efficiency ratio", value: formatFigure(latest.efficiencyPct, "percent1"), sub: eff.sub, subTone: eff.tone, spark: points.map((p) => p.efficiencyPct) },
  ];

  const trendSeries: TrendSeries[] = [
    { key: "fees", tab: feeWord, title: source === "ncua" ? "Fee income by quarter" : "Service charges on deposits by quarter", format: "dollars", values: points.map((p) => p.serviceCharges), better: "up", change: "percent" },
    { key: "roa", tab: "ROA", title: "Return on assets", format: "percent", values: points.map((p) => p.roaPct), better: "up", change: "points" },
    { key: "nim", tab: "Margin", title: "Net interest margin", format: "percent", values: points.map((p) => p.nimPct), better: "up", change: "points" },
    { key: "efficiency", tab: "Efficiency", title: "Efficiency ratio (lower is better)", format: "percent1", values: points.map((p) => p.efficiencyPct), better: "down", change: "points" },
  ];
  const first = points[0];
  return {
    source,
    latestQuarter: quarterLabel(latest.reportDate),
    kpis,
    trend: { quarters: points.map((p) => quarterLabel(p.reportDate)), axis: points.map((p) => shortQuarterLabel(p.reportDate)), series: trendSeries },
    assets: latest.assets,
    footnote: `Source: ${filingName(source)}, ${quarterLabel(first.reportDate)} to ${quarterLabel(latest.reportDate)}.`,
    footnoteDetails: `${feeWord} for four quarters are summed only when all four are filed. Hover, tap or tab to a quarter for its value.`,
  };
}

/** One group's peers for each fee, as getEnginePeerGroup gives them. */
export interface GroupPeers {
  label: string;
  fees: { feeCategory: string; peers: PeerValue[] }[];
}

export interface DashboardFeeGroup {
  key: "state" | "peers";
  /** The toggle's name. */
  tab: string;
  /** Read after "Your fees against": "institutions in Florida". */
  label: string;
  rows: FeePositionDatum[];
  /** One short source line under the fee chart. */
  note: string;
  /** How the group and its medians are read, folded in a collapsed details element. */
  details: string;
}

/**
 * The subject's fees against one group: for each fee it publishes as one price, the group's
 * spread, and its middle half and median when enough publish it (marketLayer's rule). Sister
 * charters of one shared schedule count once (countedAmounts).
 */
export function buildFeeGroupRows(
  positions: Pick<FeePositionRow, "feeCategory" | "displayName" | "current">[],
  group: GroupPeers,
  links: (feeCategory: string) => { label: string; href: string }[],
): FeePositionDatum[] {
  const byFee = new Map(group.fees.map((f) => [f.feeCategory, f.peers]));
  return positions.map((position) => {
    const amounts = countedAmounts((byFee.get(position.feeCategory) ?? []).map((p) => ({ institutionId: p.institutionId, amount: p.amount, countedAs: p.countedAs })));
    const layer = marketLayer("state", group.label, amounts, position.current);
    return {
      key: position.feeCategory,
      name: position.displayName || getDisplayName(position.feeCategory),
      yours: position.current,
      n: layer.n,
      min: amounts.length ? amounts[0] : null,
      max: amounts.length ? amounts[amounts.length - 1] : null,
      p25: layer.p25,
      median: layer.median,
      p75: layer.p75,
      links: links(position.feeCategory),
    };
  });
}

/** The links an expanded fee row offers, each carrying the institution. */
export function feeRowLinks(feeCategory: string, institutionId: number): { label: string; href: string }[] {
  const id = String(institutionId);
  const fee = encodeURIComponent(feeCategory);
  return [
    { label: "See every institution", href: hrefWithInstitutionContext(`/pro/research?fee=${fee}`, id) },
    { label: "Try a price for this fee", href: hrefWithInstitutionContext(`/pro/simulate?fee=${fee}`, id) },
    { label: "Ask Hamilton about it", href: hrefWithInstitutionContext(`/pro/analyze?q=${encodeURIComponent(`How does our ${proseFeeName(feeCategory)} fee compare with our peers?`)}`, id) },
  ];
}

/** Fee columns the scorecard shows, in order, when the subject publishes them. */
export const SCORECARD_FEES = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing", "stop_payment"] as const;
const SCORECARD_FEE_LABELS: Record<(typeof SCORECARD_FEES)[number], string> = {
  overdraft: "Overdraft",
  nsf: "NSF",
  monthly_maintenance: "Monthly",
  atm_non_network: "ATM",
  wire_domestic_outgoing: "Wire out",
  stop_payment: "Stop pay",
};
const SCORECARD_MAX_FEES = 5;

/** Service charges over the last four filed quarters as a percent of the newest deposits. */
export function feeShareOfDeposits(series: FinancialPoint[]): { pct: number | null; source: string | null; assets: number | null } {
  const latest = series[series.length - 1];
  if (!latest) return { pct: null, source: null, assets: null };
  const { latest: fees } = trailingFour(series, (p) => p.serviceCharges);
  const pct = fees !== null && latest.deposits !== null && latest.deposits > 0 ? (fees / latest.deposits) * 100 : null;
  return { pct, source: latest.source, assets: latest.assets };
}

export interface DashboardScorecard {
  columns: SortableColumn[];
  rows: SortableRow[];
  /** Each listed competitor's fee values, by row id, for the compare marker on the fee chart. */
  compareValues: Record<string, Record<string, number>>;
  /** One short source line under the scorecard. */
  note: string;
  /** Who is listed and how fee share is read, folded in a collapsed details element. */
  details: string;
}

/**
 * The subject beside its largest local competitors (the briefing's local market): assets, its key
 * fees and service charges as a share of deposits. Null without a local market on file.
 */
export function buildScorecard(
  localMarket: BriefingLocalMarket | null | undefined,
  filings: Map<number, FinancialPoint[]>,
): DashboardScorecard | null {
  if (!localMarket || localMarket.rows.length < 2) return null;
  const listed = localMarket.rows.filter((r) => r.own || !neverNamed(r.name));
  const own = listed.find((r) => r.own);
  if (!own || listed.length < 2) return null;
  const feeKeys = SCORECARD_FEES.filter((k) => own.values[k] !== undefined).slice(0, SCORECARD_MAX_FEES);
  const subjectSource = feeShareOfDeposits(filings.get(own.institutionId) ?? []).source;
  const columns: SortableColumn[] = [
    { key: "assets", label: "Assets", format: "dollars" },
    ...feeKeys.map((k) => ({ key: k, label: SCORECARD_FEE_LABELS[k], format: "money" as const, mark: true })),
    { key: "share", label: "Fee share", format: "percent", mark: true },
  ];
  const compareValues: Record<string, Record<string, number>> = {};
  const rows: SortableRow[] = listed.map((r) => {
    const filed = feeShareOfDeposits(filings.get(r.institutionId) ?? []);
    const values: Record<string, number | null> = { assets: filed.assets, share: filed.source === subjectSource ? filed.pct : null };
    const plain: Record<string, number> = {};
    for (const [category, amount] of Object.entries(r.values)) {
      // A fee stated as several different prices has no one price to show (#1931).
      if (r.several?.[category]) continue;
      plain[category] = amount;
    }
    for (const k of feeKeys) values[k] = plain[k] ?? null;
    if (!r.own) compareValues[String(r.institutionId)] = plain;
    return { id: String(r.institutionId), label: r.name, values, highlight: r.own };
  });
  const places = localMarket.info.places.slice(0, 3).join(", ");
  const sourceWord = subjectSource === "ncua" ? "fee income" : "service charges";
  return {
    columns,
    rows,
    compareValues,
    note: `Sources: published fee schedules; call reports; FDIC Summary of Deposits, ${localMarket.info.sodYear}.`,
    details: `The largest competitors by deposits in ${places || "its market"} (FDIC Summary of Deposits, ${localMarket.info.sodYear}) that publish a fee it charges. Fee share: ${sourceWord} over the last four filed quarters as a share of deposits, shown only for institutions that file the same report. ▲ highest and ▼ lowest in each column. A dash means nothing is on file as one price.`,
  };
}

export interface DashboardChange {
  id: string;
  date: string;
  institution: string;
  fee: string;
  from: number;
  to: number;
  direction: "up" | "down";
  /** The subject publishes this fee. */
  matches: boolean;
}

export interface DashboardChanges {
  headline: string;
  items: DashboardChange[];
}

/** The tape's own copy of a confirmed change (PulseChange's fields it needs). */
export interface ConfirmedChangeInput {
  institution_id?: number;
  institution_name: string;
  fee_category: string;
  display_name: string;
  old_amount: number;
  new_amount: number;
  direction: "up" | "down";
  changed_at: string;
}

const TAPE_LIMIT = 12;

function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Like-for-like fee changes confirmed in the subject's state in the window, newest first, the ones
 * to fees it publishes first among equals. The headline says plainly when none touches its fees.
 */
export function buildChanges(input: {
  institutionName: string;
  stateLabel: string | null;
  windowDays: number;
  ownCategories: ReadonlySet<string>;
  changes: ConfirmedChangeInput[] | null;
}): DashboardChanges {
  const { institutionName, stateLabel, windowDays, ownCategories } = input;
  const place = stateLabel ?? "its state";
  if (input.changes === null) return { headline: `Fee changes in ${place} could not be read just now.`, items: [] };
  const listed = input.changes.filter((c) => !neverNamed(c.institution_name));
  const items = [...listed]
    .sort((a, b) => b.changed_at.localeCompare(a.changed_at))
    .slice(0, TAPE_LIMIT)
    .map((c, i) => ({
      id: `${c.institution_id ?? c.institution_name}-${c.fee_category}-${c.changed_at}-${i}`,
      date: shortDate(c.changed_at),
      institution: c.institution_name,
      fee: c.display_name || getDisplayName(c.fee_category),
      from: c.old_amount,
      to: c.new_amount,
      direction: c.direction,
      matches: ownCategories.has(c.fee_category),
    }));
  // Counted on every change, named or not, so the count never undercounts.
  const matching = input.changes.filter((c) => ownCategories.has(c.fee_category)).length;
  let headline: string;
  if (input.changes.length === 0) {
    headline = `No institution in ${place} has a confirmed fee change in the last ${windowDays} days.`;
  } else if (matching === 0) {
    headline = `No institution in ${place} changed a fee ${institutionName} publishes in the last ${windowDays} days. Other confirmed changes in ${place}:`;
  } else {
    headline = `${matching.toLocaleString("en-US")} confirmed ${matching === 1 ? "change" : "changes"} in ${place} in the last ${windowDays} days to a fee ${institutionName} publishes.`;
  }
  return { headline, items };
}

/** Suggested questions for the Ask card, each opening the Ask page with the question filled in. */
export function askPrompts(input: { institutionId: number; topAboveCategory: string | null; groupLabel: string | null; stateLabel: string | null }): { label: string; href: string }[] {
  const questions = [
    input.topAboveCategory && input.groupLabel
      ? `How does our ${proseFeeName(input.topAboveCategory)} fee compare with ${input.groupLabel}?`
      : "Which of our fees sit above the middle half of our peers?",
    "How have our service charges moved over the last four quarters?",
    input.stateLabel ? `What fee changes have institutions in ${input.stateLabel} made recently?` : "What fee changes have our peers made recently?",
  ];
  return questions.map((q) => ({ label: q, href: hrefWithInstitutionContext(`/pro/analyze?q=${encodeURIComponent(q)}`, String(input.institutionId)) }));
}
