/**
 * The bank's own regulatory picture for one fee, as sourced Facts for Ask: the rules that bear on
 * the fee (federal, plus any reviewed state rules), who regulates the bank, and its CFPB complaint
 * record. Pure: every sentence comes from the shared reviewed rule list or a filed record.
 */

import type { ComplaintBenchmark, InstitutionComplaintYear } from "@/lib/data-store/complaints";
import type { InstitutionRegulators } from "@/lib/data-store/regulators";
import { STATE_NAMES } from "@/lib/us-states";
import { rulesForInstitution, stateAgency, type StateRule } from "../regulatory-context";
import type { Fact } from "./types";
import { subjectPossessive } from "./subject";

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
  institutionName?: string,
): string | null {
  if (!regulators?.primaryRegulator) return null;
  const { primaryRegulator, charterAgency } = regulators;
  const named = stateAgency(stateCode, charterType);
  const agency = named ? `the ${named}` : "a state agency";
  if (primaryRegulator === "NCUA") {
    return charterAgency === "State"
      ? `${subjectPossessive({ subjectName: institutionName })} charter is from ${agency}, and NCUA insures ${subjectPossessive({ subjectName: institutionName }, false)} shares.`
      : `NCUA charters and supervises ${institutionName ?? "you"} as a federal credit union.`;
  }
  if (primaryRegulator === "OCC") return `The OCC charters and supervises ${institutionName ?? "you"} as a national bank.`;
  if (primaryRegulator === "FDIC" || primaryRegulator === "Federal Reserve") {
    const federal = primaryRegulator === "FDIC" ? "the FDIC" : "the Federal Reserve";
    return `${subjectPossessive({ subjectName: institutionName })} charter is from ${agency}, and ${federal} is ${subjectPossessive({ subjectName: institutionName }, false)} primary federal regulator.`;
  }
  if (primaryRegulator === "State") return `${subjectPossessive({ subjectName: institutionName })} charter and supervision are with ${agency}.`;
  return null;
}

export function regulatoryFacts(input: {
  institutionName: string;
  feeCategory: string;
  stateCode: string | null | undefined;
  charterType: string | null | undefined;
  regulators: InstitutionRegulators | null;
  complaints: InstitutionComplaintYear[];
  /** Fee complaints per $1B of deposits beside similar-size peers' (getComplaintBenchmark). */
  complaintBenchmark?: ComplaintBenchmark | null;
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
  const sentence = regulatorSentence(input.regulators, input.stateCode, input.charterType, input.institutionName);
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
  const benchmark = complaintBenchmarkFact(input.complaintBenchmark, input.institutionName);
  if (benchmark) out.push(benchmark);
  return out;
}

/** A per-$1B rate restated per $10B, so a small rate reads as a whole number rather than "0.8". */
function per10B(perBillion: number): string {
  const v = perBillion * 10;
  if (v === 0) return "0";
  if (v < 1) return "under 1";
  return String(Math.round(v * 10) / 10);
}

/**
 * The bank's CFPB fee complaints beside similar-size peers', as a rate per $10B of deposits so a
 * large bank is not judged on its size. Only for a confirmed CFPB match: no match is not proof of
 * no complaints, and a match under review has no count yet.
 */
export function complaintBenchmarkFact(b: ComplaintBenchmark | null | undefined, institutionName?: string): Fact | null {
  if (!b || b.match_status !== "matched" || b.fee_complaints === null || b.peer_count === 0) return null;
  // Peers share the bank's charter and asset tier; the line stays within a storyline line's 20 words.
  const where = b.peer_level === "state" ? `${STATE_NAMES[b.peer_label] ?? b.peer_label} peers` : b.peer_level === "fed_district" ? `${b.peer_label.replace(/^Fed /, "")} peers` : "peers nationwide";
  const group = `${b.peer_count.toLocaleString("en-US")} ${where}`;
  let text: string;
  if (b.fee_complaints === 0) {
    text = `${institutionName ?? "You"} had no CFPB fee complaints in ${b.year}; ${b.peers_with_fee_complaints} of ${group} had any.`;
  } else if (b.fee_complaints_per_billion !== null && b.peer_median_per_billion !== null) {
    const [noun, verb] = b.fee_complaints === 1 ? ["complaint", "equals"] : ["complaints", "equal"];
    const median = b.peer_level === "national" ? `${b.peer_count.toLocaleString("en-US")} peers' median nationwide` : `${group}' median`;
    text = `${subjectPossessive({ subjectName: institutionName })} ${b.fee_complaints} CFPB fee ${noun} in ${b.year} ${verb} ${per10B(b.fee_complaints_per_billion)} per $10B of deposits; ${median} is ${per10B(b.peer_median_per_billion)}.`;
  } else {
    return null;
  }
  return {
    text,
    source: { label: "CFPB Consumer Complaint Database, against FDIC and NCUA deposits", table: "institution_complaint_records", asOf: `${b.year}-12-31` },
    sampleSize: b.peer_count,
  };
}
