/**
 * Pure logic for /about: the live proof figures, the three short blocks and the next action.
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

export interface AboutBlock {
  id: "publish" | "audience" | "honest";
  eyebrow: string;
  title: string;
  lines: string[];
  link?: { href: string; label: string };
}

/** The three short blocks under the proof: what we publish, who it is for, how we stay honest. */
export const ABOUT_BLOCKS: readonly AboutBlock[] = [
  {
    id: "publish",
    eyebrow: "What we publish",
    title: `The ${PRODUCT_NAME}`,
    lines: [
      "Every fee links to the schedule it came from and the date we collected it.",
      "Medians and ranges are built from those fees, one value per institution.",
    ],
  },
  {
    id: "audience",
    eyebrow: "Who it is for",
    title: "Two kinds of reader",
    lines: [
      "People comparing what their bank charges with what others charge.",
      "Bank and credit union pricing, product and marketing teams who need to see their fees against their market.",
    ],
  },
  {
    id: "honest",
    eyebrow: "How we stay honest",
    title: "A public method, no advice",
    lines: [
      `${SITE_NAME} is independent of the institutions it covers.`,
      "We show where a fee sits against the market. We never advise what to charge.",
    ],
    link: { href: "/methodology", label: "Read the methodology" },
  },
];

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
