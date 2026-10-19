/**
 * Pure logic for /about: the copy, the live coverage figures and the next action.
 * No database or React imports, so it is tested on its own (about-view.test.ts).
 */

import { COVERAGE_LABELS, UNAVAILABLE_LABEL, type PublicStatsSummary } from "@/lib/public-stats";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";

export interface ProofFigure {
  key: "monitored" | "institutions" | "observations";
  value: string;
  label: string;
}

export interface AboutProof {
  figures: ProofFigure[];
  /** Share of monitored institutions that have published fees, 0-100, or null when either count is missing. */
  publishedShare: number | null;
  /** "Data refreshed Oct 15, 2026", or null when the date is unknown. */
  freshness: string | null;
}

type ProofSummary = Pick<
  PublicStatsSummary,
  | "monitored"
  | "monitoredLabel"
  | "institutions"
  | "institutionsLabel"
  | "observations"
  | "observationsLabel"
  | "refreshedOn"
>;

/** A live count, or null when its read failed or came back zero: the page then hides it. */
function liveCount(value: number, label: string): number | null {
  if (label === UNAVAILABLE_LABEL || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * The proof exhibit, from the shared public snapshot (getPublicStatsSummary). A failed or zero
 * read drops that figure; nothing is ever filled in.
 */
export function aboutProof(summary: ProofSummary): AboutProof {
  const monitored = liveCount(summary.monitored, summary.monitoredLabel);
  const institutions = liveCount(summary.institutions, summary.institutionsLabel);
  const observations = liveCount(summary.observations, summary.observationsLabel);

  const figures: ProofFigure[] = [];
  if (monitored !== null) figures.push({ key: "monitored", value: summary.monitoredLabel, label: COVERAGE_LABELS.monitored });
  if (institutions !== null)
    figures.push({ key: "institutions", value: summary.institutionsLabel, label: COVERAGE_LABELS.institutions });
  if (observations !== null)
    figures.push({ key: "observations", value: summary.observationsLabel, label: COVERAGE_LABELS.observations });

  const publishedShare =
    monitored !== null && institutions !== null && institutions <= monitored
      ? Math.round((institutions / monitored) * 100)
      : null;

  return {
    figures,
    publishedShare,
    freshness: summary.refreshedOn ? `Data refreshed ${summary.refreshedOn}` : null,
  };
}

/** The hero: the purpose first (James, Oct 19, change 1). */
export const ABOUT_HERO = {
  eyebrow: `About ${SITE_NAME}`,
  title: "Better banking decisions start with a clearer picture.",
  lede: `${SITE_NAME} connects published bank fees, financial performance and market context to help banks and credit unions understand where they stand and what deserves a closer look.`,
} as const;

export interface AboutProduct {
  id: "index" | "hamilton";
  name: string;
  /** What it is, under the name. */
  kind: string;
  role: string;
  link: { href: string; label: string };
}

/** The two products side by side, with James's role lines (Oct 19, change 2). */
export const ABOUT_PRODUCTS: readonly AboutProduct[] = [
  {
    id: "index",
    name: `The ${PRODUCT_NAME}`,
    kind: "The public index",
    role: "Explore published fees from U.S. banks and credit unions, with links to their source schedules.",
    link: { href: "/fees", label: "Explore the index" },
  },
  {
    id: "hamilton",
    name: "Hamilton",
    kind: `The ${SITE_NAME} workspace`,
    role: "Bring fee comparisons, financial performance, market conditions and regulatory context into one analysis.",
    link: { href: "/subscribe", label: "See Hamilton plans" },
  },
];

/** Where the neutral line sits: the public index, not Hamilton (James, Oct 19, change 3). */
export const NEUTRALITY = [
  `The ${PRODUCT_NAME} reports published fees without recommending a price.`,
  "Hamilton helps banking teams evaluate their options, with sources and limitations made clear.",
] as const;

export interface EvidenceStep {
  title: string;
  line: string;
}

/** How the evidence works: the page's existing claims, one step each. */
export const EVIDENCE_STEPS: readonly EvidenceStep[] = [
  { title: "Read from the source", line: "Every fee is read from the institution's own fee schedule." },
  { title: "Traced to a saved copy", line: "Medians use only fees traced to a saved copy of that schedule." },
  { title: "Independent", line: `${SITE_NAME} is independent of the institutions it covers.` },
];

export const METHODOLOGY_LINK = { href: "/methodology", label: "Read the methodology" } as const;

/**
 * What each coverage figure means, from the code that computes it (src/lib/public-stats.ts):
 * "monitored" is every row of institution_sources (the FDIC and NCUA roster, closed
 * institutions included); "with published fees" is an institution with at least one approved
 * fee in published_fee_catalog; "data refreshed" is the newest approved fee's created_at, so it
 * dates the index, not each schedule.
 */
export const COVERAGE_NOTES = [
  {
    term: "Monitored",
    line: "Every bank and credit union on our list, loaded from FDIC and NCUA records. The list still includes some that have since closed.",
  },
  {
    term: "With published fees",
    line: "At least one fee from the institution's own schedule is live in the index. A fee missing from the index does not mean the institution charges nothing.",
  },
  {
    term: "Data refreshed",
    line: "The last day a fee was added to the index. It is not the date every schedule was last checked.",
  },
] as const;

/** Who runs Fee Insight: the existing founder line, kept as the owner wrote it. */
export const FOUNDER = {
  title: "Who's behind this",
  line: `${SITE_NAME} is built and run by James Gilmore, a banking data analyst.`,
  linkLabel: "Write to James",
} as const;

export interface AboutAction {
  href: string;
  label: string;
  event: "see_sample_report" | "request_report_click";
}

export const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
export const REPORT_REQUEST_HREF = "/reports?report=institution&src=about#request";

/** The sample report when it is live today, otherwise the institution report request. */
export function aboutNextAction(sampleLive: boolean): AboutAction {
  return sampleLive
    ? { href: SAMPLE_REPORT_HREF, label: "See the sample report", event: "see_sample_report" }
    : { href: REPORT_REQUEST_HREF, label: "Request your institution report", event: "request_report_click" };
}
