/**
 * The client's goal for a report. It changes how Hamilton ranks and frames its
 * decisions, never the figures: every number still comes from the DATA payload.
 */
export type ReportClientGoal = "balanced" | "protect_income" | "win_accounts" | "lower_risk";

export const REPORT_GOALS: ReadonlyArray<{ value: ReportClientGoal; label: string; hint: string; guidance: string }> = [
  {
    value: "balanced",
    label: "Balanced",
    hint: "Weigh income, competitiveness and risk evenly",
    guidance: "CLIENT GOAL: balanced. Weigh fee income, local competitiveness and regulatory risk evenly, and say which one drives each decision point.",
  },
  {
    value: "protect_income",
    label: "Protect fee income",
    hint: "Decision points ranked by income at stake",
    guidance:
      "CLIENT GOAL: protect fee income. Rank decision points by the income at stake in exhibits.fee_impacts, and state what each option does to income per 1,000 charges.",
  },
  {
    value: "win_accounts",
    label: "Win accounts",
    hint: "Decision points ranked by what shoppers compare",
    guidance:
      "CLIENT GOAL: win and keep accounts. Rank decision points by how visible the fee is to someone comparing the named local competitors (monthly maintenance, overdraft, NSF and ATM fees first), and state what each option does to the local rank and to income.",
  },
  {
    value: "lower_risk",
    label: "Lower regulatory risk",
    hint: "Decision points ranked by regulatory and complaint exposure",
    guidance:
      "CLIENT GOAL: lower regulatory and complaint risk. Rank decision points by the exposure in exhibits.regulatory (overdraft and NSF fees first, and the complaint counts), and state what each option does to that exposure and to income.",
  },
];

export function reportGoal(value: string | null | undefined) {
  return REPORT_GOALS.find((goal) => goal.value === value) ?? REPORT_GOALS[0];
}
