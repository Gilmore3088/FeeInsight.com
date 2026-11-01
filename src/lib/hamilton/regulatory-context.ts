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
import { complaintCount, complaintYearLabel, complaintYearPhrase, isPartialComplaintYear } from "@/lib/complaints/complaint-year";
import type { EnforcementActionRow, EnforcementRecord } from "@/lib/data-store/registry-profile";
import type { ReportExhibit, ReportSource } from "./types";

/**
 * Where a rule stands today (#2525). Only binding law and current guidance are cited as what a
 * bank must do; withdrawn, rescinded or disapproved items are history, labeled with when that
 * happened; a best practice is prudent, never a mandate.
 */
export type RegulatoryRuleStatus = "binding_law" | "current_guidance" | "withdrawn" | "best_practice";

export interface RegulatoryRule {
  id: string;
  name: string;
  citation: string;
  date: string;
  status: RegulatoryRuleStatus;
  /** For a withdrawn item: how it ended ("withdrawn", "rescinded", "disapproved by Congress"). */
  statusVerb?: string;
  /** When the status changed, as the agency's record gives it ("May 12, 2025", or "May 2025"). */
  statusChangedOn?: string;
  /** What replaced a withdrawn item, with that replacement's own status. */
  replacedBy?: string;
  /** Fee categories the rule bears on; empty means every consumer deposit fee. */
  applies_to: string[];
  /** What the rule says (binding or current) or said (withdrawn), in plain words. */
  summary: string;
  url: string | null;
  /** Numbers the summary states, so the figure check can trace them. */
  figures?: Record<string, number>;
}

/** Binding law and current guidance are what a bank must follow today; nothing else is. */
export function isInForce(rule: Pick<RegulatoryRule, "status">): boolean {
  return rule.status === "binding_law" || rule.status === "current_guidance";
}

function changedWhen(date: string): string {
  return /\d{1,2}, \d{4}$/.test(date) ? `on ${date}` : `in ${date}`;
}

type StatusFields = Pick<RegulatoryRule, "status" | "statusVerb" | "statusChangedOn" | "replacedBy">;

/** The status a reader sees beside a rule, in plain words. */
export function ruleStatusLabel(rule: StatusFields): string {
  switch (rule.status) {
    case "binding_law":
      return "Binding law";
    case "current_guidance":
      return "Current guidance";
    case "best_practice":
      return "Prudent practice, not a legal requirement";
    case "withdrawn": {
      const verb = rule.statusVerb ?? "withdrawn";
      const when = rule.statusChangedOn ? ` ${changedWhen(rule.statusChangedOn)}` : "";
      const replaced = rule.replacedBy ? ` and replaced by ${rule.replacedBy}` : "";
      return `${verb[0].toUpperCase()}${verb.slice(1)}${when}${replaced}; history only, not a current rule`;
    }
  }
}

/**
 * The short line Ask shows for a withdrawn item: that it ended and when, never what it required,
 * so a one-line answer cannot read it as in force. Null for every other status.
 */
export function withdrawnLine(rule: Pick<RegulatoryRule, "name" | "status" | "statusVerb" | "statusChangedOn">): string | null {
  if (rule.status !== "withdrawn") return null;
  const when = rule.statusChangedOn ? ` ${changedWhen(rule.statusChangedOn)}` : "";
  return `${rule.name} was ${rule.statusVerb ?? "withdrawn"}${when}; it is history, not a current rule.`;
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

/**
 * Reviewed 2026-10-05; statuses set 2026-11-01 from the agency records cited in issue #2525.
 * Add a rule here only with its citation, date and status. In force first, then best practice,
 * then history, so a withdrawn item never crowds out a current one.
 */
export const REGULATORY_RULES: readonly RegulatoryRule[] = [
  {
    id: "reg_e_opt_in",
    name: "Regulation E overdraft opt-in",
    citation: "12 CFR 1005.17",
    date: "in force since 2010",
    status: "binding_law",
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
    status: "binding_law",
    applies_to: [],
    summary:
      "Account fees must be disclosed before an account is opened, and periodic statements must show total overdraft and returned-item fees for the period and the year to date.",
    url: "https://www.ecfr.gov/current/title-12/part-1030/section-1030.11",
  },
  {
    // Risk context (#2525): what stays prudent now the guidance below is withdrawn. It is not a
    // requirement drawn from that guidance, and it says nothing on whether any one fee is lawful.
    id: "overdraft_nsf_disclosure_practice",
    name: "Accurate overdraft and NSF fee disclosure",
    citation: "FDIC FIL-15-2026; federal UDAP and UDAAP prohibitions",
    date: "FDIC rescission effective April 10, 2026",
    status: "best_practice",
    applies_to: ["overdraft", "nsf"],
    summary:
      "Withdrawn guidance does not repeal federal bans on unfair or deceptive practices; accurate fee disclosures remain prudent.",
    url: "https://www.fdic.gov/news/financial-institution-letters/2026/fdic-rescinds-supervisory-guidance-multiple-re-presentment",
  },
  {
    id: "fdic_nsf_representment",
    name: "FDIC guidance on re-presented NSF items",
    citation: "FDIC FIL-40-2022",
    date: "August 2022",
    status: "withdrawn",
    statusVerb: "rescinded",
    statusChangedOn: "June 16, 2023",
    replacedBy: "FDIC FIL-32-2023, itself rescinded effective April 10, 2026 (FDIC FIL-15-2026)",
    applies_to: ["nsf"],
    summary:
      "It said that charging an NSF fee on each re-presentment of the same item, without clear disclosure, risked unfairness and deception findings.",
    url: "https://www.fdic.gov/news/inactive-financial-institution-letters/2022/fil22040.html",
  },
  {
    id: "cfpb_apsn",
    name: "CFPB circular on surprise overdraft fees",
    citation: "CFPB Circular 2022-06",
    date: "October 2022",
    status: "withdrawn",
    statusVerb: "withdrawn",
    statusChangedOn: "May 12, 2025",
    applies_to: ["overdraft"],
    summary:
      "It said overdraft fees on transactions authorized against a sufficient balance that later settle negative could be an unfair practice.",
    url: "https://www.consumerfinance.gov/compliance/guidance/withdrawn-guidance/",
  },
  {
    id: "cfpb_overdraft_rule_disapproved",
    name: "CFPB large-bank overdraft rule",
    citation: "CFPB final rule, December 2024; disapproved under the Congressional Review Act",
    date: "December 2024",
    status: "withdrawn",
    statusVerb: "disapproved by Congress",
    statusChangedOn: "May 2025",
    applies_to: ["overdraft"],
    summary:
      "The rule would have capped overdraft fees at institutions over $10 billion in assets; it never took effect.",
    url: null,
    figures: { asset_threshold_amount: 10_000_000_000 },
  },
];

export interface RegulatoryReportData {
  state_chartering_agency: string | null;
  rules: Array<
    Pick<RegulatoryRule, "name" | "citation" | "date" | "summary" | "figures"> & {
      applies_to_fees: string[];
      status: RegulatoryRuleStatus;
      /** The status in plain words, with when it changed and any replacement (#2525). */
      status_label: string;
    }
  >;
  cfpb_complaints: {
    year: string;
    total_complaints: number;
    fee_related_complaints: number;
    prior_year: string | null;
    prior_year_total_complaints: number | null;
    /** True when `year` is the calendar year still being counted: its total is a part year (A5). */
    year_to_date: boolean;
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
  /** Today, for whether the latest complaint year is still being counted; defaults to now. */
  now?: Date;
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
        year_to_date: isPartialComplaintYear(latest.year, params.now),
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
      status: rule.status,
      status_label: ruleStatusLabel(rule),
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
  // Only rules in force count as bearing on the fees; history and best practice are listed, not counted.
  const specific = rules.filter(({ rule, applies }) => applies.length > 0 && isInForce(rule));
  const complaintText = complaints
    ? `the CFPB recorded ${complaintCount(complaints.total_complaints)} against ${params.institutionName} ${complaintYearPhrase(complaints.year, params.now)}, ${complaints.fee_related_complaints} about fees or low funds`
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
          columns: ["Rule", "Citation", "Status", "Your fees it touches", "What it says"],
          rows: rules.map(({ rule, applies }) => [
            rule.name,
            `${rule.citation} (${rule.date})`,
            ruleStatusLabel(rule),
            applies.length > 0
              ? applies.map((category) => `${getDisplayName(category)} ${formatAmount(feeByCategory.get(category))}`).join("; ")
              : "All published fees",
            rule.summary,
          ]),
          note: complaints && complaints.prior_year_total_complaints !== null
            ? `CFPB: ${complaintCount(complaints.total_complaints)} in ${complaintYearLabel(complaints.year, params.now)} against ${complaintCount(complaints.prior_year_total_complaints)} in ${complaints.prior_year}.`
            : null,
        }
      : null;

  const sources: ReportSource[] = rules.map(({ rule }) => ({
    label: rule.name,
    detail: `${rule.citation}, ${rule.date}. ${ruleStatusLabel(rule)}.`,
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
2. Every rule carries a status. Only "binding_law" and "current_guidance" are what the institution must follow today. A "withdrawn" item is history: give its status_label (when it was withdrawn, rescinded or disapproved, and any replacement) every time you name it, write about it in the past tense, and never present it as a current requirement, a supervisory expectation or enforcement authority. A "best_practice" item is prudent practice, never a legal requirement.
3. Withdrawn guidance does not make any fee lawful and does not repeal federal laws against unfair, deceptive or abusive practices. Never say a fee is legal or illegal, and never predict enforcement, because guidance was withdrawn. Name the agency behind each item: FDIC guidance covered FDIC-supervised institutions, and a CFPB circular is not FDIC or NCUA guidance.
4. Every decision on an overdraft or NSF fee must state its regulatory exposure (the rules in force, and the complaint count when present).
5. Never cite a rule, a state law, an enforcement action or a regulator's view that is not in exhibits.regulatory. Follow exhibits.regulatory.limits.
`.trim();
