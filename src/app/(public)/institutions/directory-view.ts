import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { REPORT_OFFER } from "@/lib/constants";

/**
 * Pure logic for /institutions: its links, the type switch, the state shading and the coverage
 * lines. Every count comes from the shared reads the page passes in; nothing here makes one up.
 */

export type Charter = "" | "bank" | "credit_union";

export const CHARTER_OPTIONS: { value: Charter; label: string }[] = [
  { value: "", label: "All" },
  { value: "bank", label: "Banks" },
  { value: "credit_union", label: "Credit unions" },
];

/** An unknown `?charter=` degrades to every institution. */
export function normalizeCharter(raw: string | undefined): Charter {
  return raw === "bank" || raw === "credit_union" ? raw : "";
}

/** A `?state=` that names no U.S. state, DC or territory degrades to the national directory. */
export function normalizeStateCode(raw: string | undefined): string {
  const code = (raw ?? "").trim().toUpperCase();
  return STATE_NAMES[code] ? code : "";
}

/** What the counts are of: "banks and credit unions", "banks" or "credit unions". */
export function charterNoun(charter: Charter): string {
  if (charter === "bank") return "banks";
  if (charter === "credit_union") return "credit unions";
  return "banks and credit unions";
}

export interface DirectoryParams {
  q?: string;
  state?: string;
  charter?: string;
  fee?: string;
  page?: number;
}

/** One builder for every directory link, so no link drops a filter it should keep. */
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

export interface Coverage {
  /** Institutions with at least one published fee. */
  published: number;
  /** Institutions monitored. */
  monitored: number;
}

/**
 * The national coverage the page leads with. With no type picked it is the site-wide headline
 * count (the homepage's figure); with a type picked it is the state summaries added up, which
 * count published fees the same way. Null when neither read has a number to show.
 */
export function nationalCoverage(
  stats: Pick<PublicStatsSummary, "institutions" | "monitored" | "complete">,
  summaries: InstitutionStateDirectorySummary[],
  charter: Charter,
): Coverage | null {
  if (!charter && stats.complete && stats.monitored > 0) {
    return { published: stats.institutions, monitored: stats.monitored };
  }
  const total = summaries.reduce(
    (sum, s) => ({ published: sum.published + s.verified_institution_count, monitored: sum.monitored + s.institution_count }),
    { published: 0, monitored: 0 },
  );
  return total.monitored > 0 ? total : null;
}

export function stateCoverage(summary: InstitutionStateDirectorySummary | undefined): Coverage | null {
  if (!summary || summary.institution_count <= 0) return null;
  return { published: summary.verified_institution_count, monitored: summary.institution_count };
}

export function publishedShare(c: Coverage): number {
  return c.monitored > 0 ? c.published / c.monitored : 0;
}

/** "45%", rounded; a share above zero never reads as "0%". */
export function percentLabel(share: number): string {
  if (share > 0 && share < 0.005) return "under 1%";
  return `${Math.round(share * 100)}%`;
}

const COUNT = new Intl.NumberFormat("en-US");

/**
 * The one finding line: "3,911 of the 8,775 banks and credit unions monitored have published
 * fees (45%)." A state reads "in Georgia"; zero published says so plainly.
 */
export function coverageFinding(c: Coverage, charter: Charter, stateName?: string): string {
  const where = stateName ? ` in ${stateName}` : "";
  const noun = charterNoun(charter);
  if (c.published === 0) {
    return `None of the ${COUNT.format(c.monitored)} ${noun} monitored${where} have published fees yet.`;
  }
  return `${COUNT.format(c.published)} of the ${COUNT.format(c.monitored)} ${noun} monitored${where} have published fees (${percentLabel(publishedShare(c))}).`;
}

/** The map's shading bands, lightest first; all from the brick ramp. */
export const SHARE_BANDS = [
  { min: 0, label: "None", fill: "var(--fi-surface-200)" },
  { min: Number.MIN_VALUE, label: "Under 25%", fill: "color-mix(in srgb, var(--fi-brick) 25%, var(--fi-surface-0))" },
  { min: 0.25, label: "25 to 50%", fill: "color-mix(in srgb, var(--fi-brick) 50%, var(--fi-surface-0))" },
  { min: 0.5, label: "50 to 75%", fill: "color-mix(in srgb, var(--fi-brick) 75%, var(--fi-surface-0))" },
  { min: 0.75, label: "75% or more", fill: "var(--fi-brick)" },
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
  const used = new Set(summaries.map((s) => shareBand(publishedShare(stateCoverage(s) ?? { published: 0, monitored: 0 }))));
  return SHARE_BANDS.map((_, i) => i).filter((i) => used.has(i));
}

export interface StateRow {
  code: string;
  name: string;
  published: number;
  monitored: number;
  share: number;
}

/**
 * Named states (50, DC and territories) with at least one institution, most published first,
 * ties broken by share and then name.
 */
export function stateRows(summaries: InstitutionStateDirectorySummary[]): StateRow[] {
  return summaries
    .filter((s) => STATE_NAMES[s.state_code] && s.institution_count > 0)
    .map((s) => ({
      code: s.state_code,
      name: STATE_NAMES[s.state_code],
      published: s.verified_institution_count,
      monitored: s.institution_count,
      share: s.verified_institution_count / s.institution_count,
    }))
    .sort((a, b) => b.published - a.published || b.share - a.share || a.name.localeCompare(b.name));
}

/** The middle value of a list of numbers; null when empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The state section's finding, which the ranked list doesn't show: how many states have any
 * institution with published fees, and the median state's share. Null when no state has one.
 */
export function stateFinding(rows: StateRow[]): string | null {
  const withAny = rows.filter((r) => r.published > 0).length;
  const mid = median(rows.map((r) => r.share));
  if (withAny === 0 || mid === null) return null;
  const count = withAny === rows.length ? `All ${rows.length}` : `${withAny} of the ${rows.length}`;
  return `${count} states, DC and territories have at least one institution with published fees; the median state share is ${percentLabel(mid)}.`;
}

/** The one next step for bank staff: the live sample report when it exists, else the request form. */
export function reportCta(sampleLive: boolean): {
  href: string;
  label: string;
  event: "see_sample_report" | "request_report_click";
} {
  return sampleLive
    ? { href: "/reports/sample-competitive-fee-position", label: "See a sample fee report", event: "see_sample_report" }
    : { href: "/reports?report=institution&src=institutions#request", label: REPORT_OFFER.institutionCtaLabel, event: "request_report_click" };
}
