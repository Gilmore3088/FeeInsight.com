/**
 * State consumer deposit fee laws (50 states, DC and Puerto Rico), drafted for
 * Hamilton's regulatory module. This is legal content: it stays out of anything
 * customers see until James has reviewed it, so `stateFeeLawsFor` returns nothing
 * while STATE_FEE_LAWS_REVIEWED is false unless the caller asks for the draft.
 *
 * Each rule carries the official citation and URL. The research session could not
 * open legislature sites directly (the cloud network blocks them), so text was read
 * from search excerpts of the official pages: `verification` says whether the
 * rule's text was seen on the state's own site ("official_excerpt") or only in
 * secondary sources ("secondary_only"). Leads that could not be confirmed are kept
 * in STATE_FEE_LAW_COVERAGE, never as rules. A state with no rules listed is not
 * proof that the state has no such law.
 */
import type { RegulatoryRule } from "@/lib/hamilton/regulatory-context";
import { STATE_FEE_LAW_COVERAGE_DATA, STATE_FEE_LAWS_DATA } from "./state-fee-laws.data";

export type StateFeeLawTopic =
  | "overdraft_nsf"
  | "dormancy"
  | "check_cashing"
  | "returned_item"
  | "fee_change_notice"
  | "basic_account"
  | "garnishment_legal_process"
  | "fee_authority"
  | "atm"
  | "other"
  | "payee_returned_check";

export type StateFeeLawStatus = "in_force" | "enacted_not_yet_effective" | "proposed" | "repealed" | "expired";

export type StateFeeLawInstitutions =
  | "state_banks"
  | "state_credit_unions"
  | "state_banks_and_credit_unions"
  | "all_depository_institutions"
  | "other";

export interface StateFeeLaw extends RegulatoryRule {
  state_code: string;
  topic: StateFeeLawTopic;
  status: StateFeeLawStatus;
  /** Who the statute itself says it covers. */
  institutions: StateFeeLawInstitutions;
  /** ISO date, a year, or "unknown". */
  effective_date: string;
  verification: "official_excerpt" | "secondary_only";
  source_kind: "statute" | "regulation" | "regulator_guidance" | "court_rule";
  /** The longer research summary, for the reviewer. `summary` is the one line Ask shows. */
  detail: string;
  /** What the official text (or its search excerpt) said. */
  evidence: string;
}

export interface StateFeeLawLead {
  topic: string;
  claim: string;
  where_seen: string;
  why_unconfirmed: string;
}

export interface StateFeeLawCoverage {
  state_code: string;
  state_name: string;
  /** Searched, nothing found. Not proof that no rule exists. */
  topics_no_rule_found: string[];
  leads_unconfirmed: StateFeeLawLead[];
  notes: string;
}

/** Flips to true only after James's legal review. */
export const STATE_FEE_LAWS_REVIEWED = false;
export const STATE_FEE_LAWS_RESEARCHED = "2026-10-07";

export const STATE_FEE_LAWS: readonly StateFeeLaw[] = STATE_FEE_LAWS_DATA;
export const STATE_FEE_LAW_COVERAGE: readonly StateFeeLawCoverage[] = STATE_FEE_LAW_COVERAGE_DATA;

/**
 * The in-force state laws that can bear on an institution's consumer deposit fees.
 * `charterAgency` is institution_sources.charter_agency: "State" gets the state-charter
 * rules for its charter type; "OCC", "NCUA" or an unknown agency get only rules the
 * statute extends to every depository institution. General fee-authority and parity
 * rules name no fee, so they are left out unless asked for: they would otherwise
 * appear on every fee's answer.
 */
export function stateFeeLawsFor(
  params: { stateCode: string | null | undefined; charterType: string | null | undefined; charterAgency: string | null | undefined },
  opts: { includeUnreviewed?: boolean; includeFeeAuthority?: boolean } = {},
): StateFeeLaw[] {
  if (!STATE_FEE_LAWS_REVIEWED && !opts.includeUnreviewed) return [];
  if (!params.stateCode) return [];
  const isCreditUnion = params.charterType === "credit_union";
  const stateChartered = params.charterAgency === "State";
  return STATE_FEE_LAWS.filter((law) => {
    if (law.state_code !== params.stateCode || law.status !== "in_force") return false;
    if (law.topic === "fee_authority" && !opts.includeFeeAuthority) return false;
    switch (law.institutions) {
      case "all_depository_institutions":
        return true;
      case "state_banks":
        return stateChartered && !isCreditUnion;
      case "state_credit_unions":
        return stateChartered && isCreditUnion;
      case "state_banks_and_credit_unions":
        return stateChartered;
      default:
        return false;
    }
  });
}
