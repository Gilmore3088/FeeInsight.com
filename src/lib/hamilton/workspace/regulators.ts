/**
 * The bank's own regulatory picture for one fee, as sourced Facts for Ask: the rules that bear on
 * the fee (federal, plus any reviewed state rules), who regulates the bank, and its CFPB complaint
 * record. Pure: every sentence comes from the shared reviewed rule list or a filed record.
 */

import type { InstitutionComplaintYear } from "@/lib/data-store/complaints";
import type { InstitutionRegulators } from "@/lib/data-store/regulators";
import { rulesForInstitution, stateAgency, type StateRule } from "../regulatory-context";
import type { Fact } from "./types";

/** Rules feeRules() already states for Ask, so they are not repeated. */
const STATED_ELSEWHERE = new Set(["reg_e_opt_in"]);
const MAX_WORDS = 25;

function shortSummary(summary: string): string {
  const words = summary.split(/\s+/).length;
  if (words <= MAX_WORDS) return summary;
  const first = summary.split(";")[0].trim();
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** One sentence naming who charters and supervises the institution; null when not on file. */
export function regulatorSentence(
  regulators: InstitutionRegulators | null,
  stateCode: string | null | undefined,
  charterType: string | null | undefined,
): string | null {
  if (!regulators?.primaryRegulator) return null;
  const { primaryRegulator, charterAgency } = regulators;
  const named = stateAgency(stateCode, charterType);
  const agency = named ? `the ${named}` : "a state agency";
  if (primaryRegulator === "NCUA") {
    return charterAgency === "State"
      ? `Your charter is from ${agency}, and NCUA insures your shares.`
      : "NCUA charters and supervises you as a federal credit union.";
  }
  if (primaryRegulator === "OCC") return "The OCC charters and supervises you as a national bank.";
  if (primaryRegulator === "FDIC" || primaryRegulator === "Federal Reserve") {
    const federal = primaryRegulator === "FDIC" ? "the FDIC" : "the Federal Reserve";
    return `Your charter is from ${agency}, and ${federal} is your primary federal regulator.`;
  }
  if (primaryRegulator === "State") return `Your charter and supervision are with ${agency}.`;
  return null;
}

export function regulatoryFacts(input: {
  institutionName: string;
  feeCategory: string;
  stateCode: string | null | undefined;
  charterType: string | null | undefined;
  regulators: InstitutionRegulators | null;
  complaints: InstitutionComplaintYear[];
  /** Reviewed state rules for this institution (stateFeeLawsFor); none until reviewed. */
  stateRules?: readonly StateRule[];
  /** The day the regulator record was read, for its source date. */
  readOn?: string;
}): Fact[] {
  const out: Fact[] = [];
  const rules = rulesForInstitution(input.stateRules);
  for (const rule of rules) {
    if (STATED_ELSEWHERE.has(rule.id)) continue;
    const isState = "state_code" in rule;
    // A federal rule for every fee (Reg DD) is already in the notice rules; a state rule for every fee is new.
    const applies = rule.applies_to.includes(input.feeCategory) || (isState && rule.applies_to.length === 0);
    if (!applies) continue;
    out.push({
      text: shortSummary(rule.summary),
      source: { label: `${rule.name}, ${rule.citation}`, ...(rule.url ? { url: rule.url } : {}), asOf: null },
    });
  }
  const sentence = regulatorSentence(input.regulators, input.stateCode, input.charterType);
  if (sentence) {
    out.push({
      text: sentence,
      source: {
        label: input.regulators?.source === "ncua" ? "NCUA credit union records" : "FDIC BankFind institution records",
        table: "institution_sources",
        ...(input.readOn ? { asOf: input.readOn } : {}),
      },
    });
  }
  const latest = input.complaints[0];
  if (latest && latest.total_complaints > 0) {
    out.push({
      text: `The CFPB recorded ${latest.total_complaints.toLocaleString("en-US")} complaints about ${input.institutionName} in ${latest.year}, ${latest.fee_related_complaints.toLocaleString("en-US")} about fees or low funds.`,
      source: { label: "CFPB Consumer Complaint Database", table: "institution_complaint_records", asOf: latest.year },
    });
  }
  return out;
}
