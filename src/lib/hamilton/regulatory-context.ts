/**
 * The regulatory side of a Hamilton report: the federal rules that bear on the
 * institution's own fees, its state chartering agency, and its CFPB complaint record.
 * Rules come from a short reviewed list (no live regulation feed exists yet), so
 * Hamilton cites only these and never invents a rule or a state law.
 */
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { STATE_REGULATORS } from "@/lib/regulatory/state-regulators";
import type { InstitutionComplaintYear } from "@/lib/data-store/complaints";
import type { ReportExhibit, ReportSource } from "./types";

export interface RegulatoryRule {
  id: string;
  name: string;
  citation: string;
  date: string;
  /** Fee categories the rule bears on; empty means every consumer deposit fee. */
  applies_to: string[];
  summary: string;
  url: string | null;
  /** Numbers the summary states, so the figure check can trace them. */
  figures?: Record<string, number>;
}

/** Reviewed 2026-10-05. Add a rule here only with its citation and date. */
export const REGULATORY_RULES: readonly RegulatoryRule[] = [
  {
    id: "reg_e_opt_in",
    name: "Regulation E overdraft opt-in",
    citation: "12 CFR 1005.17",
    date: "in force since 2010",
    applies_to: ["overdraft"],
    summary:
      "An overdraft fee may be charged on ATM and one-time debit card transactions only after the consumer affirmatively opts in.",
    url: "https://www.ecfr.gov/current/title-12/part-1005/section-1005.17",
  },
  {
    id: "reg_dd_disclosure",
    name: "Regulation DD (Truth in Savings) fee disclosure",
    citation: "12 CFR 1030; NCUA 12 CFR 707 for credit unions",
    date: "in force",
    applies_to: [],
    summary:
      "Account fees must be disclosed before an account is opened, and periodic statements must show total overdraft and returned-item fees for the period and the year to date.",
    url: "https://www.ecfr.gov/current/title-12/part-1030/section-1030.11",
  },
  {
    id: "fdic_nsf_representment",
    name: "FDIC guidance on re-presented items",
    citation: "FDIC FIL-40-2022",
    date: "August 2022",
    applies_to: ["nsf"],
    summary:
      "Charging an NSF fee each time the same item is re-presented, without clear disclosure, raises unfairness and deception risk in FDIC examinations.",
    url: null,
  },
  {
    id: "cfpb_apsn",
    name: "CFPB circular on surprise overdraft fees",
    citation: "CFPB Circular 2022-06",
    date: "October 2022",
    applies_to: ["overdraft"],
    summary:
      "Overdraft fees on transactions authorized against a sufficient balance that later settle negative can be an unfair practice.",
    url: null,
  },
  {
    id: "cfpb_overdraft_rule_disapproved",
    name: "CFPB large-bank overdraft rule (disapproved)",
    citation: "CFPB final rule, December 2024; disapproved under the Congressional Review Act",
    date: "May 2025",
    applies_to: ["overdraft"],
    summary:
      "The rule capping overdraft fees at institutions over $10 billion in assets was disapproved by Congress and never took effect; overdraft pricing remains a public and supervisory focus.",
    url: null,
    figures: { asset_threshold_amount: 10_000_000_000 },
  },
];

export interface RegulatoryReportData {
  state_chartering_agency: string | null;
  rules: Array<Pick<RegulatoryRule, "name" | "citation" | "date" | "summary" | "figures"> & { applies_to_fees: string[] }>;
  cfpb_complaints: {
    year: string;
    total_complaints: number;
    fee_related_complaints: number;
    prior_year: string | null;
    prior_year_total_complaints: number | null;
  } | null;
  limits: string;
}

const REGULATORY_LIMITS =
  "There is no source of state fee laws or enforcement actions in the data yet. Do not state what a state law requires. CFPB complaints are counted only where the CFPB company name matched this institution; no match is not proof of no complaints.";

function stateAgency(stateCode: string | null | undefined, charterType: string | null | undefined): string | null {
  const regulator = STATE_REGULATORS.find((entry) => entry.stateCode === stateCode);
  if (!regulator) return null;
  return charterType === "credit_union" && regulator.creditUnionAgency ? regulator.creditUnionAgency : regulator.agency;
}

export function buildRegulatoryContext(params: {
  institutionName: string;
  stateCode: string | null | undefined;
  charterType: string | null | undefined;
  /** The institution's own fees by category. */
  fees: Array<{ fee_category: string; institution_amount: number }>;
  complaintYears: InstitutionComplaintYear[];
}): { data: RegulatoryReportData; exhibit: ReportExhibit | null; sources: ReportSource[] } {
  const feeByCategory = new Map(params.fees.map((fee) => [fee.fee_category, fee.institution_amount]));
  const rules = REGULATORY_RULES.flatMap((rule) => {
    const applies = rule.applies_to.length === 0 ? [] : rule.applies_to.filter((category) => feeByCategory.has(category));
    if (rule.applies_to.length > 0 && applies.length === 0) return [];
    return [{ rule, applies }];
  });
  const [latest, prior] = params.complaintYears;
  const complaints = latest
    ? {
        year: latest.year,
        total_complaints: latest.total_complaints,
        fee_related_complaints: latest.fee_related_complaints,
        prior_year: prior?.year ?? null,
        prior_year_total_complaints: prior?.total_complaints ?? null,
      }
    : null;
  const agency = stateAgency(params.stateCode, params.charterType);

  const data: RegulatoryReportData = {
    state_chartering_agency: agency,
    rules: rules.map(({ rule, applies }) => ({
      name: rule.name,
      citation: rule.citation,
      date: rule.date,
      summary: rule.summary,
      ...(rule.figures ? { figures: rule.figures } : {}),
      applies_to_fees: applies.length > 0 ? applies.map(getDisplayName) : ["every published consumer deposit fee"],
    })),
    cfpb_complaints: complaints,
    limits: REGULATORY_LIMITS,
  };

  const specific = rules.filter(({ applies }) => applies.length > 0);
  const complaintText = complaints
    ? `the CFPB recorded ${complaints.total_complaints} complaints against ${params.institutionName} in ${complaints.year}, ${complaints.fee_related_complaints} about fees or low funds`
    : `no CFPB complaints are matched to ${params.institutionName}`;
  const exhibit: ReportExhibit | null =
    rules.length > 0
      ? {
          id: "regulatory",
          title:
            specific.length > 0
              ? `${specific.length} federal ${specific.length === 1 ? "rule bears" : "rules bear"} directly on ${params.institutionName}'s fees, and ${complaintText}`
              : `Disclosure rules apply to every fee shown, and ${complaintText}`,
          subtitle: agency
            ? `State chartering agency: ${agency}. Federal rules from a reviewed list; state fee laws are not yet in the data.`
            : "Federal rules from a reviewed list; state fee laws are not yet in the data.",
          columns: ["Rule", "Citation", "Your fees it touches", "What it requires"],
          rows: rules.map(({ rule, applies }) => [
            rule.name,
            `${rule.citation} (${rule.date})`,
            applies.length > 0
              ? applies.map((category) => `${getDisplayName(category)} ${formatAmount(feeByCategory.get(category))}`).join("; ")
              : "All published fees",
            rule.summary,
          ]),
          note: complaints && complaints.prior_year_total_complaints !== null
            ? `CFPB complaints: ${complaints.total_complaints} in ${complaints.year} against ${complaints.prior_year_total_complaints} in ${complaints.prior_year}.`
            : null,
        }
      : null;

  const sources: ReportSource[] = rules.map(({ rule }) => ({
    label: rule.name,
    detail: `${rule.citation}, ${rule.date}.`,
    url: rule.url,
  }));
  if (complaints) {
    sources.push({ label: "CFPB Consumer Complaint Database", detail: `Complaints matched to ${params.institutionName}, ${complaints.year}.`, url: null });
  }
  return { data, exhibit, sources };
}

export const REGULATORY_REPORT_RULES = `
REGULATORY RULES:
1. exhibits.regulatory lists the federal rules that bear on this institution's fees, its state chartering agency, and its CFPB complaint record. Name a rule by its name and citation exactly as given when a decision touches a fee it covers.
2. Every decision on an overdraft or NSF fee must state its regulatory exposure (the rule, and the complaint count when present).
3. Never cite a rule, a state law, an enforcement action or a regulator's view that is not in exhibits.regulatory. Follow exhibits.regulatory.limits.
`.trim();
