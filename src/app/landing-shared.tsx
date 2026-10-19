import { Button, SearchInput } from "@/brand/components";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import type { PublicStatsSummary } from "@/lib/public-stats";
import type { LinePosition } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { lineName } from "@/app/for-institutions/board-math";
import { REPORT_SHOWCASE } from "@/lib/report-showcase";

export const SAMPLE_REPORT_HREF = REPORT_SHOWCASE.sampleHref;

export const SANS = { fontFamily: "var(--fi-font-sans)" } as const;
/** The h1 and section h2s: the homepage serif (landing-serif.ts); a size-matched Times New Roman shows until it loads. */
export const SERIF = { fontFamily: "var(--fi-home-serif, Georgia), Georgia, serif" } as const;
/** The homepage's content width (James's example: 1280px, with a 16px gutter on a phone). */
export const HOME_WRAP = "mx-auto w-full max-w-[1312px] px-4 sm:px-6 lg:px-8";

/** The homepage's reads share one deadline (createReadBudget); past it each part drops out (#1988). */
export const HOME_READ_BUDGET_MS = 15_000;

export const money = (v: number) => `$${v.toFixed(2)}`;

/** True when a count label holds a real figure (a failed read shows "—"). */
export const hasFigure = (label: string) => /\d/.test(label);

/**
 * The institution search: a plain GET to /institutions?q=, the same target as the
 * homepage's WEBSITE_JSON_LD SearchAction, so it works before any script loads.
 */
export function InstitutionSearchForm({
  className,
  id,
  secondary = false,
}: {
  className?: string;
  id?: string;
  /** Under a page's main action, the search's button steps back to the secondary style. */
  secondary?: boolean;
}) {
  return (
    <form
      action="/institutions"
      method="get"
      role="search"
      aria-label="Search for a bank or credit union"
      className={["flex flex-col gap-3 sm:flex-row sm:items-end", className].filter(Boolean).join(" ")}
    >
      <SearchInput
        id={id}
        name="q"
        label="Your bank or credit union"
        required
        autoComplete="off"
        className="w-full min-w-0 text-left sm:flex-1"
      />
      <Button type="submit" variant={secondary ? "secondary" : "primary"} className="min-h-11 justify-center whitespace-nowrap">
        See where your fees stand
      </Button>
    </form>
  );
}

/** One comparable line of the live sample report: the bank's fee against its local market. */
export interface SampleRow {
  key: string;
  label: string;
  amount: number;
  median: number;
  /** The middle half of the local competitors that publish this fee, and how many do. */
  p25: number;
  p75: number;
  competitors: number;
  position: LinePosition;
}

/** The live sample Competitive Fee Position Report, as the Hamilton examples draw it. */
export interface SampleView {
  institutionName: string;
  competitors: number;
  /** Comparable lines, in report order. */
  rows: SampleRow[];
}

/**
 * Whether a homepage render may be kept in the page cache. The page is regenerated in the
 * background (ISR), and a render made while a read was failing would otherwise be served
 * for the whole revalidate window, or baked into the build. A read that failed (as opposed
 * to one that answered "nothing today", such as no sample bank passing the bar) makes the
 * render uncacheable: the page then caches it for a minute instead of fifteen
 * (`shortenPageLife`, #1572), so the next render reads the database again.
 */
export function homeReadsCacheable({
  summary,
  categories,
  sampleFailed,
  indexFailed,
}: {
  summary: Pick<PublicStatsSummary, "complete">;
  categories: FeeCategorySummary[];
  sampleFailed: boolean;
  /** A Bank Fee Index card fee's rows failed to read. */
  indexFailed: boolean;
}): boolean {
  return summary.complete && categories.length > 0 && !sampleFailed && !indexFailed;
}

/** The sample report's comparable lines, in report order, each with its fee's report name. */
export function buildSampleView(report: MarketReport | null): SampleView | null {
  if (!report) return null;
  const rows: SampleRow[] = [];
  for (const line of report.analysis.lines) {
    if (!line.comparable || !line.own || !line.peers || !line.position) continue;
    rows.push({
      key: line.key,
      label: lineName(line.label),
      amount: line.own.amount,
      median: line.peers.median,
      p25: line.peers.p25,
      p75: line.peers.p75,
      competitors: line.peers.n,
      position: line.position,
    });
  }
  return {
    institutionName: report.data.subject.institution_name,
    competitors: report.analysis.readiness.competitorsWithData,
    rows,
  };
}

