/**
 * Pure logic for /methodology: the pipeline stages with their live counts, the one live
 * benchmark the "how we compute" exhibit draws, the computation rules and the next action.
 * No database or React imports, so it is tested on its own (methodology-view.test.ts).
 */

import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { formatCount } from "@/lib/public-stats";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { MIN_INSTITUTIONS_FOR_MEDIAN, STRONG_INSTITUTION_COUNT } from "@/lib/data-store/maturity";

/** Live counts the page has. Null means the read failed or no public read exists. */
export interface PipelineCounts {
  /** Institutions monitored: every row of institution_sources (getPublicStatsSummary). */
  monitored: number | null;
  /** Institutions with a fee schedule link on file (getStatsCached().with_fee_url). */
  scheduleLinks: number | null;
  /** Institutions with at least one published fee (getPublicStatsSummary). */
  institutions: number | null;
  /** Published fee entries (getPublicStatsSummary). */
  observations: number | null;
}

export interface StageFigure {
  value: string;
  label: string;
  /** Share of monitored institutions, 0-100, for the bar; null when the figure is not a count of institutions. */
  share: number | null;
}

export interface PipelineStage {
  key: string;
  agent: string;
  title: string;
  body: string;
  /** What the stage hands to the next one. */
  output: string;
  figures: StageFigure[];
}

/** A count is shown only when its read worked and returned something; a failed read is never a 0. */
function usable(n: number | null): n is number {
  return n !== null && Number.isFinite(n) && n > 0;
}

function share(part: number, whole: number | null): number | null {
  if (!usable(whole)) return null;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 1000) / 10));
}

function institutionFigure(n: number | null, label: string, monitored: number | null): StageFigure[] {
  return usable(n) ? [{ value: formatCount(n), label, share: share(n, monitored) }] : [];
}

/**
 * The six pipeline agents in order. A stage with no public live read (Rosetta, Knox, Darwin)
 * shows no number: the page never invents one.
 */
export function pipelineStages(counts: PipelineCounts): PipelineStage[] {
  const { monitored } = counts;
  return [
    {
      key: "atlas",
      agent: "Atlas",
      title: "Start from the regulators",
      body: "Every bank and credit union in FDIC and NCUA records. Atlas schedules and logs each step.",
      output: "Institution list",
      figures: usable(monitored) ? [{ value: formatCount(monitored), label: "institutions monitored", share: null }] : [],
    },
    {
      key: "magellan",
      agent: "Magellan",
      title: "Find the fee schedule",
      body: "Finds the schedule on the institution's own site and keeps a dated copy.",
      output: "Stored copy of the schedule",
      figures: institutionFigure(counts.scheduleLinks, "with a schedule link on file", monitored),
    },
    {
      key: "rosetta",
      agent: "Rosetta",
      title: "Read it",
      body: "Turns the web page, PDF or Word file into clean text, line by line.",
      output: "Clean text",
      figures: [],
    },
    {
      key: "knox",
      agent: "Knox",
      title: "Pull out each fee",
      body: "Records each fee's name, amount and conditions. No amount in the text, no fee.",
      output: "Fee lines, each tied to its source line",
      figures: [],
    },
    {
      key: "darwin",
      agent: "Darwin",
      title: "Verify",
      body: "Checks each fee against the stored text, its category and its usual range. Anything unsure waits for a person.",
      output: "Verified fees",
      figures: [],
    },
    {
      key: "hamilton",
      agent: "Hamilton",
      title: "Publish",
      body: "Publishes verified fees, each linked to the institution's own schedule.",
      output: "The Bank Fee Index",
      figures: [
        ...(usable(counts.observations)
          ? [{ value: formatCount(counts.observations), label: "published fee entries", share: null }]
          : []),
        ...institutionFigure(counts.institutions, "institutions with published fees", monitored),
      ],
    },
  ];
}

/** Whole dollars without cents ("$35"), otherwise two decimals ("$2.50"). */
export function money(value: number): string {
  const n = Math.round(value * 100) / 100;
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** Display name for prose, without its abbreviation: "Overdraft", not "Overdraft (OD)". */
export function plainCategory(category: string): string {
  return getDisplayName(category).replace(/\s*\([^)]*\)/g, "");
}

export interface ExampleBenchmark {
  category: string;
  label: string;
  median: string;
  low: string;
  high: string;
  institutions: string;
  /** Positions on the bar, as percentages of its width. */
  lowPct: number;
  highPct: number;
  medianPct: number;
  /** The axis ends at this amount (the bar starts at $0). */
  axisMax: string;
  unstatedAudience: boolean;
}

/** The categories tried first, in order; any other strong category with a full range follows. */
const PREFERRED = ["overdraft", "nsf", "monthly_maintenance"];

function complete(c: FeeCategorySummary): boolean {
  return (
    c.median_amount !== null &&
    c.p25_amount !== null &&
    c.p75_amount !== null &&
    c.p75_amount > 0 &&
    c.institution_count >= STRONG_INSTITUTION_COUNT
  );
}

/**
 * One live national benchmark to draw the median and middle half on: overdraft when it has
 * a strong, complete benchmark, else the next preferred one, else the strong category with
 * the most institutions. Null when none qualifies, so the exhibit is left out.
 */
export function pickExampleBenchmark(categories: FeeCategorySummary[]): ExampleBenchmark | null {
  const usableRows = categories.filter(complete);
  if (usableRows.length === 0) return null;
  const preferred = PREFERRED.map((key) => usableRows.find((c) => c.fee_category === key)).find(Boolean);
  const chosen = preferred ?? [...usableRows].sort((a, b) => b.institution_count - a.institution_count)[0];
  const median = chosen.median_amount!;
  const p25 = chosen.p25_amount!;
  const p75 = chosen.p75_amount!;
  // Room past the upper quartile so the band never touches the edge; a round axis end.
  const axis = Math.max(1, Math.ceil((p75 * 1.4) / 5) * 5);
  const pct = (v: number) => Math.max(0, Math.min(100, Math.round((v / axis) * 1000) / 10));
  return {
    category: chosen.fee_category,
    label: plainCategory(chosen.fee_category),
    median: money(median),
    low: money(p25),
    high: money(p75),
    institutions: formatCount(chosen.institution_count),
    lowPct: pct(p25),
    highPct: pct(p75),
    medianPct: pct(median),
    axisMax: money(axis),
    unstatedAudience: (chosen.unstated_audience_institution_count ?? 0) > 0,
  };
}

export interface ComputeRule {
  /** Anchor id; "audience" is linked from every asterisk footnote on the site. */
  id: string;
  title: string;
  line: string;
  /** Extra detail behind a disclosure; empty when the line says it all. */
  detail: string[];
  /** Shown as a tag when the rule is not live yet. */
  status: string | null;
}

/**
 * The statistics contract (src/lib/data-store/fee-stats.ts), one short line per rule.
 * `sharedScheduleOnce` is COUNT_SHARED_SCHEDULE_ONCE: while it is off the page says the
 * sibling rule is not live yet instead of claiming it.
 */
export function computeRules(sharedScheduleOnce: boolean): ComputeRule[] {
  return [
    {
      id: "median",
      title: "The median, not the average",
      line: "Half of institutions charge more, half charge less. One extreme fee cannot drag it.",
      detail: [
        `A median needs at least ${MIN_INSTITUTIONS_FOR_MEDIAN} institutions. With ${STRONG_INSTITUTION_COUNT} or more it is marked Strong; below that, Provisional.`,
        "A $0 fee is a real price and counts.",
      ],
      status: null,
    },
    {
      id: "range",
      title: "The range is the middle half",
      line: "From the 25th to the 75th percentile: where the middle half of institutions sit.",
      detail: [],
      status: null,
    },
    {
      id: "count-once",
      title: "Each institution counts once",
      line: "An institution with several prices for one fee adds a single value, the middle of its own prices.",
      detail: ["Overdraft is the exception: it counts the standard fee, the highest tier, so tiered pricing is compared like for like."],
      status: null,
    },
    {
      id: "siblings",
      title: "Sibling charters count once",
      line: sharedScheduleOnce
        ? "Charters under one holding company that publish one shared schedule count as one institution."
        : "Charters under one holding company that publish one shared schedule will count as one institution. Until this is on, each charter counts.",
      detail: ["Each charter's own page still shows its fees."],
      status: sharedScheduleOnce ? null : "Being switched on",
    },
    {
      id: "audience",
      title: "Personal fees, and an asterisk",
      line: "Figures describe personal accounts. A fee whose schedule never says who it is for counts as personal and carries an asterisk (*).",
      detail: [
        "Business fees stay on the institution's own page, labeled Business, and never enter a personal median.",
        "A fee is Business when its line names business or commercial accounts, or the whole schedule is a business one.",
      ],
      status: null,
    },
    {
      id: "rates",
      title: "Dollar fees and rate fees stay apart",
      line: "A fee stated as a percentage is never pooled with dollar amounts. It gets its own figures.",
      detail: [],
      status: null,
    },
  ];
}

export interface ActionLink {
  href: string;
  label: string;
  event: "see_sample_report" | "request_report_click";
}

export const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
export const REPORT_REQUEST_HREF = "/reports?report=institution&src=methodology#request";

/** The sample report when it is live today, otherwise the institution report request. */
export function nextAction(sampleLive: boolean): ActionLink {
  return sampleLive
    ? { href: SAMPLE_REPORT_HREF, label: "See the sample report", event: "see_sample_report" }
    : { href: REPORT_REQUEST_HREF, label: "Request your institution report", event: "request_report_click" };
}
