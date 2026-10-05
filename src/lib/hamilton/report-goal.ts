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
    guidance: "CLIENT GOAL: balanced. Weigh fee income, local competitiveness and regulatory risk evenly, and say which one drives each decision.",
  },
  {
    value: "protect_income",
    label: "Protect fee income",
    hint: "Decisions ranked by income at stake",
    guidance:
      "CLIENT GOAL: protect fee income. Rank decisions by the income at stake in exhibits.fee_impacts. Prefer holding or raising fees priced below the local median, and state the income cost of any cut per 1,000 charges.",
  },
  {
    value: "win_accounts",
    label: "Win accounts",
    hint: "Decisions ranked by what shoppers compare",
    guidance:
      "CLIENT GOAL: win and keep accounts. Rank decisions by how visible the fee is to someone comparing the named local competitors (monthly maintenance, overdraft, NSF and ATM fees first). Prefer moves that improve the local rank, and state each move's income cost.",
  },
  {
    value: "lower_risk",
    label: "Lower regulatory risk",
    hint: "Decisions ranked by regulatory and complaint exposure",
    guidance:
      "CLIENT GOAL: lower regulatory and complaint risk. Rank decisions by the exposure in exhibits.regulatory (overdraft and NSF fees first, and the complaint counts). Prefer moves that reduce that exposure, and state each move's income cost.",
  },
];

export function reportGoal(value: string | null | undefined) {
  return REPORT_GOALS.find((goal) => goal.value === value) ?? REPORT_GOALS[0];
}
