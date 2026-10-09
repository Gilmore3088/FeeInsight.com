/**
 * The regulatory side of a Hamilton report: the federal rules that bear on the
 * institution's own fees, its state chartering agency, and its CFPB complaint record.
 * Rules come from a short reviewed list (no live regulation feed exists yet), so
 * Hamilton cites only these and never invents a rule or a state law.
 */
import { enforcementAgencyLabel } from "@/lib/regulatory/state-enforcement";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { STATE_REGULATORS } from "@/lib/regulatory/state-regulators";
import type { InstitutionComplaintYear } from "@/lib/data-store/complaints";
import type { EnforcementActionRow, EnforcementRecord } from "@/lib/data-store/registry-profile";
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

/**
 * A reviewed state rule in the same shape, tagged with its state. The "State fee laws for Hamilton"
 * thread supplies these from src/lib/regulatory/state-fee-laws.ts (stateFeeLawsFor), already
 * filtered to the institution's state and charter, and empty until James's legal review.
 */
export type StateRule = RegulatoryRule & { state_code: string };

/** Federal rules, then the reviewed state rules passed in for the institution. */
export function rulesForInstitution(stateRules: readonly StateRule[] = []): RegulatoryRule[] {
  return [...REGULATORY_RULES, ...stateRules];
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
      "Charging an NSF fee on each re-presentment of the same item, without clear disclosure, risks unfairness and deception findings.",
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
  /** Public OCC and Federal Reserve enforcement actions; null when no list covers this institution. */
  enforcement_actions: {
    lists_checked: string[];
    as_of: string | null;
    /** Orders with no end date on file from the last ten years; they may have ended. */
    no_end_date_on_file: EnforcementActionSummary[];
    past_count: number;
    latest_past: EnforcementActionSummary[];
  } | null;
  limits: string;
}

export interface EnforcementActionSummary {
  agency: string;
  against: string;
  type: string | null;
  start_date: string | null;
  termination_date: string | null;
  penalty_amount: number | null;
}

const agencyListName = (agency: string) => `${enforcementAgencyLabel(agency)} enforcement actions`;

function summarizeAction(action: EnforcementActionRow): EnforcementActionSummary {
  return {
    agency: action.agency === "OCC" ? "OCC" : "Federal Reserve",
    against: action.against_holding_company ? `holding company (${action.party_name})` : action.party_name,
    type: action.action_type,
    start_date: action.start_date,
    termination_date: action.termination_date,
    penalty_amount: action.penalty_amount,
  };
}

const NO_STATE_RULES =
  "There is no source of state fee laws for this state in the data yet. Do not state what a state law requires.";

const COMPLAINT_LIMITS =
  "CFPB complaints are counted only where the CFPB company name matched this institution; no match is not proof of no complaints.";

const NO_ENFORCEMENT_LIST =
  "No enforcement-action list in the data covers this institution (FDIC and NCUA orders are not loaded). Do not state whether it has enforcement actions.";

const ENFORCEMENT_LIMITS =
  "Enforcement actions come only from the lists named in enforcement_actions.lists_checked; FDIC and NCUA orders are not loaded. Report an action as fact, with its agency and dates, and never characterize the institution beyond it. Never call an action in no_end_date_on_file active or ongoing: the agencies don't always record an end date, so say it has no end date on file. An empty list means none on those lists, not none anywhere.";

export function stateAgency(stateCode: string | null | undefined, charterType: string | null | undefined): string | null {
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
  /** Reviewed state rules for this institution (stateFeeLawsFor); none until reviewed. */
  stateRules?: readonly StateRule[];
  /** getEnforcementRecord; null or absent when no loaded list covers the institution. */
  enforcement?: EnforcementRecord | null;
}): { data: RegulatoryReportData; exhibit: ReportExhibit | null; sources: ReportSource[] } {
  const feeByCategory = new Map(params.fees.map((fee) => [fee.fee_category, fee.institution_amount]));
  const all = rulesForInstitution(params.stateRules);
  const hasStateRules = all.length > REGULATORY_RULES.length;
  const rules = all.flatMap((rule) => {
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
  const enforcement = params.enforcement && params.enforcement.agenciesChecked.length > 0 ? params.enforcement : null;

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
    enforcement_actions: enforcement
      ? {
          lists_checked: enforcement.agenciesChecked.map(agencyListName),
          as_of: enforcement.asOf,
          no_end_date_on_file: enforcement.open.map(summarizeAction),
          past_count: enforcement.pastCount,
          latest_past: enforcement.past.map(summarizeAction),
        }
      : null,
    limits: [hasStateRules ? null : NO_STATE_RULES, enforcement ? ENFORCEMENT_LIMITS : NO_ENFORCEMENT_LIST, COMPLAINT_LIMITS]
      .filter(Boolean)
      .join(" "),
  };

  const ruleListNote = hasStateRules
    ? "Federal and state rules from a reviewed list."
    : "Federal rules from a reviewed list; state fee laws are not yet in the data.";
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
              ? `${specific.length} ${hasStateRules ? "" : "federal "}${specific.length === 1 ? "rule bears" : "rules bear"} directly on ${params.institutionName}'s fees, and ${complaintText}`
              : `Disclosure rules apply to every fee shown, and ${complaintText}`,
          subtitle: agency
            ? `State chartering agency: ${agency}. ${ruleListNote}`
            : ruleListNote,
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
  if (enforcement) {
    sources.push({
      label: "Federal enforcement actions",
      detail: `${enforcement.agenciesChecked.map(agencyListName).join(" and ")}${enforcement.asOf ? `, read ${enforcement.asOf}` : ""}.`,
      url: null,
    });
  }
  if (complaints) {
    sources.push({ label: "CFPB Consumer Complaint Database", detail: `Complaints matched to ${params.institutionName}, ${complaints.year}.`, url: null });
  }
  return { data, exhibit, sources };
}

export const REGULATORY_REPORT_RULES = `
REGULATORY RULES:
1. exhibits.regulatory lists the federal rules that bear on this institution's fees, its state chartering agency, its CFPB complaint record, and any public OCC or Federal Reserve enforcement actions. Name a rule by its name and citation exactly as given when a decision touches a fee it covers.
2. Every decision on an overdraft or NSF fee must state its regulatory exposure (the rule, and the complaint count when present).
3. Never cite a rule, a state law, an enforcement action or a regulator's view that is not in exhibits.regulatory. Follow exhibits.regulatory.limits.
`.trim();
