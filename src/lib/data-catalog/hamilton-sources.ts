import { catalogEntry } from "./catalog";
import { REUSE_CONFIRMED_REGULATOR_STATES } from "@/lib/data-store/struck-sources";

/**
 * The one source rule for what Hamilton, its Regulatory Wire and paid reports may show (James,
 * 2026-11-08, #2226): a source the catalog does not mark servable (struck, held or
 * terms-unconfirmed, `isServable`) is never shown to a paying reader. Public pages keep the
 * struck-and-held rule only (DECISIONS.md "No non-commercial data", Round 2), so readers shared
 * with public pages take an `audience` and apply this only for "hamilton".
 *
 * State regulator posts and orders are one source each but are confirmed state by state: a
 * state in REUSE_CONFIRMED_REGULATOR_STATES is shown while its source is still unconfirmed.
 */
export type SourceAudience = "public" | "hamilton";

/** May Hamilton show rows from this registry source? Unknown ids are not shown. */
export function hamiltonShowsSource(id: string): boolean {
  return catalogEntry(id)?.servable ?? false;
}

/** reg_articles "state:XX" sources Hamilton may show; null when every non-struck state may be shown. */
export function hamiltonStatePostSources(): string[] | null {
  if (hamiltonShowsSource("state-reg-news")) return null;
  return REUSE_CONFIRMED_REGULATOR_STATES.map((s) => `state:${s}`);
}

/** May Hamilton show this state's regulator posts? (Struck states are hidden by every reader.) */
export function hamiltonShowsStatePosts(stateCode: string): boolean {
  const allowed = hamiltonStatePostSources();
  return allowed === null || allowed.includes(`state:${stateCode.toUpperCase()}`);
}

/** institution_enforcement_actions "STATE_XX" agencies Hamilton may show; null when every non-struck state may be shown. Federal agencies are always shown. */
export function hamiltonStateAgencies(): string[] | null {
  if (hamiltonShowsSource("state-enforcement")) return null;
  return REUSE_CONFIRMED_REGULATOR_STATES.map((s) => `STATE_${s}`);
}

/** May Hamilton show an order from this agency code? */
export function hamiltonShowsAgency(agency: string): boolean {
  if (!agency.startsWith("STATE_")) return true;
  const allowed = hamiltonStateAgencies();
  return allowed === null || allowed.includes(agency);
}
