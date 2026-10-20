import type { FeeScene } from "../types";

/**
 * Monthly maintenance guide, "What is a monthly maintenance fee?". Four beats (James's review,
 * Oct 17): $10 a month, $120 over a year, the waiver conditions, then check your account.
 */
const account = { label: "Account" };

export const MONTHLY_MAINTENANCE_FEES_SCENE: FeeScene = {
  id: "monthly_maintenance",
  title: "A fee for having the account.",
  left: { icon: "calendar", label: "Every month" },
  right: { icon: "bank", label: "Your bank" },
  charges: [{ id: "monthly", label: "Monthly fee", amount: 10, under: "right" }],
  steps: [
    {
      id: "monthly",
      kind: "charge",
      durationMs: 6000,
      caption: "Your bank charges $10 each month for having the account.",
      frame: { item: account, charges: ["monthly"], intro: "monthly" },
    },
    {
      id: "year",
      kind: "outcome",
      durationMs: 6000,
      caption: "A $10 monthly fee costs $120 a year unless waived.",
      frame: {
        item: account,
        charges: ["monthly"],
        total: { label: "A year, unwaived", amount: 120, note: "12 months at $10" },
        intro: "total",
      },
    },
    {
      id: "waivers",
      kind: "decision",
      durationMs: 6000,
      caption: "Many accounts list conditions that waive it.",
      frame: {
        item: account,
        charges: ["monthly"],
        lookForTitle: "Common waivers",
        lookFor: ["A qualifying direct deposit", "A minimum balance", "Linked balances that count"],
        intro: "lookFor",
      },
    },
    {
      id: "check",
      kind: "decision",
      durationMs: 6000,
      caption: "Check your account's waiver conditions.",
      frame: {
        item: account,
        charges: ["monthly"],
        lookForTitle: "Check your account",
        lookFor: ["Average or lowest balance rule", "A waiver you stopped meeting", "A new fee line on your statement"],
        intro: "lookFor",
      },
    },
  ],
  takeaway: "The waiver conditions decide whether you pay this fee.",
  describe:
    "Your bank charges $10 every month for having the account, $120 over a year if the fee is not waived. Common waivers are a qualifying direct deposit, a minimum balance and linked balances. Check your account's balance rule, whether you still meet the waiver and your statement for a new fee line.",
};
