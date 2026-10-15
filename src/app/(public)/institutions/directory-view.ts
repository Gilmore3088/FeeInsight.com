import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import { STATE_NAMES } from "@/lib/us-states";
import { REPORT_OFFER } from "@/lib/constants";
import { DEMO_REQUEST_NAV } from "@/components/nav-items";

/**
 * Pure logic for /institutions: the directory's links, the charter switch, the state map's
 * shading and each state's coverage split. Every count comes from the state summaries the page
 * reads; nothing here makes one up.
 */

export type Charter = "" | "bank" | "credit_union";

export const CHARTER_OPTIONS: { value: Charter; label: string }[] = [
  { value: "", label: "All" },
  { value: "bank", label: "Banks" },
  { value: "credit_union", label: "Credit unions" },
];

/** An unknown `?charter=` degrades to all institutions. */
export function normalizeCharter(raw: string | undefined): Charter {
  return raw === "bank" || raw === "credit_union" ? raw : "";
}

/** A `?state=` that names no U.S. state or territory degrades to the plain directory. */
export function normalizeStateCode(raw: string | undefined): string {
  const code = (raw ?? "").trim().toUpperCase();
  return STATE_NAMES[code] ? code : "";
}

export interface DirectoryParams {
  q?: string;
  state?: string;
  charter?: string;
  fee?: string;
  page?: number;
}

/** One builder for every directory link, so a link never drops a filter it should keep. */
export function directoryHref({ q, state, charter, fee, page }: DirectoryParams): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (state) params.set("state", state);
  if (charter) params.set("charter", charter);
  if (fee) params.set("fee", fee);
  if (page && page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/institutions?${search}` : "/institutions";
}

/** Summaries for the 50 states, DC and the territories the map and the list can name. */
export function namedStates(summaries: InstitutionStateDirectorySummary[]): InstitutionStateDirectorySummary[] {
  return summaries.filter((s) => STATE_NAMES[s.state_code]);
}

/** Every state added up: what the panel shows before a state is picked. */
export function totalSummary(summaries: InstitutionStateDirectorySummary[]): InstitutionStateDirectorySummary {
  const total: InstitutionStateDirectorySummary = {
    state_code: "",
    institution_count: 0,
    verified_institution_count: 0,
    provisional_institution_count: 0,
    under_review_institution_count: 0,
    source_needed_institution_count: 0,
    verified_fee_count: 0,
    provisional_fee_count: 0,
  };
  for (const s of summaries) {
    total.institution_count += s.institution_count;
    total.verified_institution_count += s.verified_institution_count;
    total.provisional_institution_count += s.provisional_institution_count;
    total.under_review_institution_count += s.under_review_institution_count;
    total.source_needed_institution_count += s.source_needed_institution_count;
    total.verified_fee_count += s.verified_fee_count;
    total.provisional_fee_count += s.provisional_fee_count;
  }
  return total;
}

export type SegmentKey = "published" | "review" | "missing";

export interface CoverageSegment {
  key: SegmentKey;
  label: string;
  count: number;
}

/**
 * A state's institutions split three ways. The summary query partitions them, so the three
 * counts add up to the institutions monitored.
 */
export function coverageSegments(summary: InstitutionStateDirectorySummary): CoverageSegment[] {
  return [
    { key: "published", label: "Published fees", count: summary.verified_institution_count },
    {
      key: "review",
      label: "Under review",
      count: summary.provisional_institution_count + summary.under_review_institution_count,
    },
    { key: "missing", label: "No schedule found", count: summary.source_needed_institution_count },
  ];
}

/** Share of a state's institutions with published fees, 0 to 1; 0 when none are monitored. */
export function publishedShare(summary: Pick<InstitutionStateDirectorySummary, "verified_institution_count" | "institution_count">): number {
  if (summary.institution_count <= 0) return 0;
  return summary.verified_institution_count / summary.institution_count;
}

/** "42%", rounded; a share above zero never rounds down to "0%". */
export function percentLabel(share: number): string {
  if (share > 0 && share < 0.005) return "under 1%";
  return `${Math.round(share * 100)}%`;
}

/** The map's shading bands, lightest first. */
export const SHARE_BANDS = [
  { min: 0, label: "None", fill: "#ebe5d9" },
  { min: Number.MIN_VALUE, label: "Under 10%", fill: "#f1d5d0" },
  { min: 0.1, label: "10 to 25%", fill: "#E8A08E" },
  { min: 0.25, label: "25 to 50%", fill: "#D46F54" },
  { min: 0.5, label: "50% or more", fill: "#b23a32" },
] as const;

export function shareBand(share: number): number {
  let band = 0;
  SHARE_BANDS.forEach((b, i) => {
    if (share >= b.min) band = i;
  });
  return band;
}

/** Only the bands some state falls in, so the key never names a shade the map doesn't use. */
export function bandsInUse(summaries: InstitutionStateDirectorySummary[]): number[] {
  const used = new Set(summaries.map((s) => shareBand(publishedShare(s))));
  return SHARE_BANDS.map((_, i) => i).filter((i) => used.has(i));
}

/** The one next step for bank staff: the live sample report when it exists, else the request form. */
export function reportCta(sampleLive: boolean): {
  href: string;
  label: string;
  event: "see_sample_report" | "request_report_click";
} {
  return sampleLive
    ? { href: "/reports/sample-competitive-fee-position", label: "See a sample report", event: "see_sample_report" }
    : {
        href: "/reports?report=institution&src=institutions#request",
        label: REPORT_OFFER.institutionCtaLabel,
        event: "request_report_click",
      };
}

export const DEMO_CTA = { href: DEMO_REQUEST_NAV.href, label: DEMO_REQUEST_NAV.label } as const;
