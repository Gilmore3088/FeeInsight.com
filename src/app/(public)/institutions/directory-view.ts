import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";

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
  /** Only institutions with fees in the index (`?fees=1`). */
  fees?: boolean;
  page?: number;
}

/** `?fees=1` turns on the "Fees available" filter; any other value leaves it off. */
export function normalizeFeesFilter(raw: string | undefined): boolean {
  return raw === "1";
}

/** One builder for every directory link, so no link drops a filter it should keep. */
export function directoryHref({ q, state, charter, fee, fees, page }: DirectoryParams): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (state) params.set("state", state);
  if (charter) params.set("charter", charter);
  if (fee) params.set("fee", fee);
  if (fees) params.set("fees", "1");
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
 * The one coverage line: "3,911 of the 8,775 banks and credit unions monitored have fees
 * available in the index (45%)." A state reads "in Georgia"; zero published says so plainly.
 */
export function coverageFinding(c: Coverage, charter: Charter, stateName?: string): string {
  const where = stateName ? ` in ${stateName}` : "";
  const noun = charterNoun(charter);
  if (c.published === 0) {
    return `None of the ${COUNT.format(c.monitored)} ${noun} monitored${where} have fees available in the index yet.`;
  }
  return `${COUNT.format(c.published)} of the ${COUNT.format(c.monitored)} ${noun} monitored${where} have fees available in the index (${percentLabel(publishedShare(c))}).`;
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
 * The state section folded to one line once a search or state is picked: "Median state: 40%
 * with fees in the index". Null when no state has published fees.
 */
export function stateSummaryLine(rows: StateRow[]): string | null {
  const withAny = rows.filter((r) => r.published > 0).length;
  const mid = median(rows.map((r) => r.share));
  if (withAny === 0 || mid === null) return null;
  return `Median state: ${percentLabel(mid)} with fees in the index`;
}

/**
 * The headline fees by the names a reader uses, one distinct name each, keyed by the real
 * category keys (the taxonomy's display names are written for tables: "Wire Transfer (Domestic
 * In)", "NSF / Returned Item").
 */
export const HEADLINE_FEE_NAMES: Record<(typeof HEADLINE_FEE_KEYS)[number], string> = {
  monthly_maintenance: "monthly maintenance",
  overdraft: "overdraft",
  nsf: "insufficient funds",
  atm_non_network: "out-of-network ATM",
  card_foreign_txn: "card or ATM use abroad",
  wire_domestic_outgoing: "domestic outgoing wire",
  stop_payment: "stop payment",
  wire_intl_outgoing: "international outgoing wire",
  wire_domestic_incoming: "domestic incoming wire",
  cashiers_check: "cashier's check",
  od_protection_transfer: "overdraft protection transfer",
  paper_statement: "paper statement",
  minimum_balance: "below minimum balance",
  card_replacement: "debit card replacement",
  deposited_item_return: "returned deposited item",
};

/** The headline fee names in the order the coverage count lists them, as one sentence list. */
export function headlineFeeList(): string {
  const names = HEADLINE_FEE_KEYS.map((key) => HEADLINE_FEE_NAMES[key]);
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The supporting line under the search: "Published fees available for 3,960 banks and credit
 * unions." Null when the count is unknown or zero, so the page never shows a made-up figure.
 */
export function availabilityLine(c: Coverage | null, charter: Charter, stateName?: string): string | null {
  if (!c || c.published <= 0) return null;
  return `Published fees available for ${COUNT.format(c.published)} ${charterNoun(charter)}${stateName ? ` in ${stateName}` : ""}.`;
}

/** Acronyms the registry spells as words ("Campus Usa"), keyed by that spelling. */
const NAME_ACRONYMS: Record<string, string> = {
  Usa: "USA",
  Fcu: "FCU",
  Cu: "CU",
  Ecu: "ECU",
  Fsb: "FSB",
  Ssb: "SSB",
};

/**
 * An institution name as the directory prints it, display only: a word the registry spells as a
 * title-cased acronym ("Campus Usa Credit Union") is set back in capitals. Everything else,
 * including a truncated name, is shown as stored.
 */
export function directoryName(name: string): string {
  return name
    .replace(/(?<![\w.'])[A-Z][a-z]+(?![\w'])/g, (word) => NAME_ACRONYMS[word] ?? word)
    .replace(/(?<![\w.])N\.a\.(?!\w)/g, "N.A.");
}

const CITY_SMALL_WORDS = new Set(["of", "and", "the", "on", "at", "in", "by", "de", "la", "del"]);

/**
 * A city as the directory prints it, display only: all capitals or a lowercase word
 * ("FORT LAUDERDALE", "Fort lauderdale") becomes "Fort Lauderdale". A word that already has a
 * capital ("McAllen") is kept.
 */
export function directoryCity(city: string | null | undefined): string | null {
  const trimmed = city?.trim();
  if (!trimmed) return null;
  const base = trimmed === trimmed.toUpperCase() ? trimmed.toLowerCase() : trimmed;
  return base
    .split(/(\s+|-|\/)/)
    .map((part, index) => {
      if (!/^[a-z]/.test(part) || part !== part.toLowerCase()) return part;
      if (index > 0 && CITY_SMALL_WORDS.has(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}
