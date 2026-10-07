/**
 * What a fee change takes once management has chosen it: approvals, customer notice, systems and
 * monitoring. Deterministic: no model call, no recommendation. Hamilton never decides the price;
 * this only lays out the work that follows a decision the bank has made.
 */

export type ChangeDirection = "increase" | "decrease" | "eliminate" | "none";
export type Charter = "bank" | "credit_union";

export interface RuleCitation {
  label: string;
  url: string;
}

export interface PlanItem {
  text: string;
  rule?: RuleCitation;
}

export interface PlanSection {
  title: string;
  items: PlanItem[];
}

export interface ImplementationPlan {
  direction: ChangeDirection;
  /** Days of advance written notice the deposit rules require before the change takes effect. */
  advanceNoticeDays: number;
  noticeSummary: string;
  noticeRule: RuleCitation;
  sections: PlanSection[];
}

const REG_DD: RuleCitation = {
  label: "Reg DD, 12 CFR 1030.5(a)",
  url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1030/section-1030.5",
};
const NCUA_TIS: RuleCitation = {
  label: "NCUA Truth in Savings, 12 CFR 707.5(a)",
  url: "https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-707/section-707.5",
};
const REG_E_OPT_IN: RuleCitation = {
  label: "Reg E, 12 CFR 1005.17",
  url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1005/subpart-A/section-1005.17",
};

/** Truth in Savings requires this much notice before a change that hurts the consumer. */
export const ADVERSE_CHANGE_NOTICE_DAYS = 30;

/** Fees charged only on business accounts, which the consumer deposit rules don't cover. */
const BUSINESS_ONLY_CATEGORIES = new Set(["night_deposit"]);

export function changeDirection(current: number, proposed: number): ChangeDirection {
  if (proposed === current) return "none";
  if (proposed === 0) return "eliminate";
  return proposed > current ? "increase" : "decrease";
}

/** The earliest date a change can take effect when notice goes out on `noticeDate` (YYYY-MM-DD). */
export function earliestEffectiveDate(noticeDate: string, noticeDays: number): string {
  const d = new Date(`${noticeDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + noticeDays);
  return d.toISOString().slice(0, 10);
}

export function buildImplementationPlan(input: {
  feeCategory: string;
  feeLabel: string;
  current: number;
  proposed: number;
  charter: Charter;
}): ImplementationPlan {
  const direction = changeDirection(input.current, input.proposed);
  const noticeRule = input.charter === "credit_union" ? NCUA_TIS : REG_DD;
  const businessOnly = BUSINESS_ONLY_CATEGORIES.has(input.feeCategory);
  const adverse = direction === "increase";
  const advanceNoticeDays = adverse && !businessOnly ? ADVERSE_CHANGE_NOTICE_DAYS : 0;
  const fee = input.feeLabel.toLowerCase();

  const noticeSummary = businessOnly
    ? `The consumer deposit rules don't cover a business-only fee. Your business account agreement sets the notice for changing the ${fee}.`
    : adverse
      ? `An increase needs written notice at least ${ADVERSE_CHANGE_NOTICE_DAYS} days before it takes effect.`
      : "A change that doesn't hurt customers needs no advance notice. Disclosures still have to match from the effective date.";

  const noticeItems: PlanItem[] = businessOnly
    ? [
        { text: "Check the notice terms in your business account agreement" },
        { text: "Tell affected business customers before the effective date" },
      ]
    : adverse
      ? [
          {
            text: `Mail or deliver notice at least ${ADVERSE_CHANGE_NOTICE_DAYS} days before the effective date`,
            rule: noticeRule,
          },
          { text: "Notice goes to every account holder the fee can apply to" },
        ]
      : [
          { text: "No advance notice required for a change that doesn't hurt customers", rule: noticeRule },
          { text: "Decide whether to tell customers anyway" },
        ];

  const systems: PlanItem[] = [
    { text: `${input.feeLabel} fee code in the core system` },
    { text: "Published fee schedule and account disclosures" },
  ];
  if (input.feeCategory === "overdraft") {
    systems.push({ text: "Overdraft opt-in notice for ATM and one-time debit card transactions, which states the fee", rule: REG_E_OPT_IN });
  }
  systems.push({ text: "Website, branch and call center materials" });

  const monitoring: PlanItem[] = [
    { text: `${input.feeLabel} income against the model` },
    { text: "Waivers and refunds" },
    { text: "Customer complaints and contacts about the fee" },
  ];
  if (input.feeCategory === "overdraft") monitoring.push({ text: "Opt-in rate for debit card overdraft coverage" });

  return {
    direction,
    advanceNoticeDays,
    noticeSummary,
    noticeRule,
    sections: [
      {
        title: "Governance",
        items: [
          { text: "Pricing committee or management approval" },
          { text: "Board approval, if your fee policy requires it" },
          { text: "Compliance review of the notice and disclosures" },
        ],
      },
      { title: "Customer notice", items: noticeItems },
      { title: "Systems and disclosures", items: systems },
      { title: "Monitoring after launch", items: monitoring },
    ],
  };
}
