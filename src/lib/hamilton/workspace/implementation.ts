/**
 * What it would take to put a price management has chosen into effect. Pure and
 * client-safe. Modeling and implementation are separate steps: this runs only after the
 * bank has picked an amount, and it never judges whether the amount is a good idea.
 *
 * Notice rules cited (the bank's compliance team confirms what applies):
 * - Reg DD, 12 CFR 1030.5(a) (banks) and NCUA Part 707, 12 CFR 707.5(a) (credit unions):
 *   at least 30 days' advance notice of a change that may adversely affect the consumer.
 *   A change that is not adverse (a lower fee) needs no advance notice.
 * - Reg E, 12 CFR 1005.8(a): 21 days' notice of increased fees for electronic fund transfers.
 * - Reg E, 12 CFR 1005.17: the overdraft opt-in notice states the fee for ATM and one-time
 *   debit card overdrafts, so a changed overdraft fee means an updated notice.
 */

import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { WORKSPACE_ENGINE_VERSION, type ImplementationPlan, type PlanStep, type PriceDirection, type SourceRef } from "./types";

export const ADVERSE_CHANGE_NOTICE_DAYS = 30;
export const EFT_FEE_NOTICE_DAYS = 21;

export const REG_DD_BANK: SourceRef = {
  label: "Reg DD, 12 CFR 1030.5(a)",
  url: "https://www.consumerfinance.gov/rules-policy/regulations/1030/5/",
};
export const REG_DD_CU: SourceRef = {
  label: "NCUA Truth in Savings, 12 CFR 707.5(a)",
  url: "https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-707/section-707.5",
};
export const REG_E_FEE_NOTICE: SourceRef = {
  label: "Reg E, 12 CFR 1005.8(a)",
  url: "https://www.consumerfinance.gov/rules-policy/regulations/1005/8/",
};
export const REG_E_OPT_IN: SourceRef = {
  label: "Reg E, 12 CFR 1005.17",
  url: "https://www.consumerfinance.gov/rules-policy/regulations/1005/17/",
};

const OVERDRAFT_CATEGORIES = new Set(["overdraft", "od_daily_cap", "continuous_od"]);

const EFT_CATEGORIES = new Set<string>(FEE_FAMILIES["ATM & Card"] ?? []);

/** ATM and debit card fees, which Reg E's change-in-terms notice also covers. */
export function isEftFee(feeCategory: string): boolean {
  return EFT_CATEGORIES.has(feeCategory);
}

export function priceDirection(current: number, chosen: number): PriceDirection {
  if (Math.abs(chosen - current) < 0.005) return "no_change";
  if (chosen <= 0) return "eliminate";
  return chosen > current ? "increase" : "decrease";
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function buildImplementationPlan(input: {
  feeCategory: string;
  current: number;
  chosen: number;
  /** ISO date management chose the amount; the notice period counts from here. */
  decidedOn: string;
  charterType: "bank" | "credit_union";
  /** False for fees charged only on business accounts, which Reg DD does not cover. */
  consumer?: boolean;
  /** ISO time the plan is built; defaults to now. */
  generatedAt?: string;
}): ImplementationPlan {
  const { feeCategory, current, chosen, decidedOn, charterType } = input;
  const consumer = input.consumer ?? true;
  const name = getDisplayName(feeCategory);
  const direction = priceDirection(current, chosen);
  const adverse = direction === "increase";
  const regDd = charterType === "credit_union" ? REG_DD_CU : REG_DD_BANK;

  const notice: PlanStep[] = [];
  let noticeRequiredDays = 0;
  if (!consumer) {
    notice.push({ text: "Business accounts are outside Reg DD; the account agreement sets the notice owed." });
  } else if (adverse) {
    noticeRequiredDays = ADVERSE_CHANGE_NOTICE_DAYS;
    notice.push({
      text: `Mail or deliver notice of the ${name} increase to affected consumer account holders at least ${ADVERSE_CHANGE_NOTICE_DAYS} days before it takes effect, stating the new amount and the effective date.`,
      rule: regDd,
    });
    if (isEftFee(feeCategory)) {
      notice.push({
        text: `This is an electronic fund transfer fee, so Reg E also requires ${EFT_FEE_NOTICE_DAYS} days' written notice; the ${ADVERSE_CHANGE_NOTICE_DAYS}-day notice covers both if sent once.`,
        rule: REG_E_FEE_NOTICE,
      });
    }
  } else if (direction !== "no_change") {
    notice.push({
      text: `A lower ${name} is not an adverse change, so no advance notice is required; update the fee schedule and disclosures by the effective date.`,
      rule: regDd,
    });
  }
  if (consumer && direction !== "no_change") {
    notice.push({ text: "Check state law and the account agreement, which can require more notice than federal rules." });
  }
  if (OVERDRAFT_CATEGORIES.has(feeCategory) && direction !== "no_change") {
    notice.push({
      text: "Update the overdraft opt-in notice, which states the fee for ATM and one-time debit card overdrafts.",
      rule: REG_E_OPT_IN,
    });
  }

  const approvals: PlanStep[] = [
    { text: "Pricing committee or management approval, recorded with the scenarios considered." },
    { text: "Board approval if the bank's fee policy requires it." },
    { text: "Compliance review of the notice wording and the affected account and product populations." },
  ];

  const systems: PlanStep[] = [
    { text: `Core system: update the ${name} fee code to ${fmtMoney(chosen)} with the effective date.` },
    { text: "Online fee schedule and website disclosures." },
    { text: "Branch fee schedules, account opening disclosures and staff talking points." },
  ];
  if (direction === "eliminate") {
    systems[0] = { text: `Core system: retire or zero the ${name} fee code as of the effective date.` };
  }

  const monitoring: PlanStep[] = [
    { text: "Customer calls and complaints that mention the fee, for the first 90 days." },
    { text: "Waivers and refunds of the fee, against the months before the change." },
    { text: "Fee income in the next two quarterly call reports." },
  ];

  const rules = [...notice, ...approvals, ...systems]
    .map((step) => step.rule)
    .filter((rule): rule is SourceRef => !!rule)
    .filter((rule, i, all) => all.findIndex((r) => r.label === rule.label) === i);
  const assumptions = [
    `${consumer ? "Consumer" : "Business"} accounts at a ${charterType === "credit_union" ? "credit union" : "bank"}.`,
    `The notice period counts from ${decidedOn}, the date the amount was chosen; notice must actually go out that day for the earliest date to hold.`,
  ];

  return {
    feeCategory,
    current,
    chosen,
    direction,
    noticeRequiredDays,
    notice,
    approvals,
    systems,
    earliestEffectiveDate: addDays(decidedOn, noticeRequiredDays),
    monitoring,
    caveat: "Hamilton cites the federal rules that commonly apply. Your compliance team confirms what applies to your accounts and products.",
    provenance: {
      engineVersion: WORKSPACE_ENGINE_VERSION,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      dataAsOf: {},
      sources: rules,
      assumptions,
      clientFacts: [],
    },
  };
}
