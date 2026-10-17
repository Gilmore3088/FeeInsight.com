import type { FeeScene } from "../types";

/** Monthly maintenance guide, "What is a monthly maintenance fee?": recurring, twelve a year, often waivable. */
const account = { label: "Account" };

export const MONTHLY_MAINTENANCE_FEES_SCENE: FeeScene = {
  id: "monthly_maintenance",
  title: "A fee for having the account.",
  left: { icon: "calendar", label: "Every month" },
  right: { icon: "bank", label: "Your bank" },
  charges: [{ id: "monthly", label: "Monthly fee", amount: 10, under: "right" }],
  steps: [
    {
      id: "account",
      kind: "transaction",
      durationMs: 6000,
      caption: "A monthly maintenance fee is a charge for having an account.",
      frame: { item: account, charges: [], intro: "item" },
    },
    {
      id: "monthly",
      kind: "charge",
      durationMs: 6000,
      caption: "It arrives whether you make one transaction or a hundred.",
      frame: { item: account, charges: ["monthly"], intro: "monthly" },
    },
    {
      id: "year",
      kind: "outcome",
      durationMs: 6000,
      caption: "Over a year, it costs twelve times what it looks like.",
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
      durationMs: 7000,
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
      id: "look",
      kind: "decision",
      durationMs: 7000,
      caption: "Read the waiver conditions, not just the fee.",
      frame: {
        item: account,
        charges: ["monthly"],
        lookFor: ["Average or lowest balance rule", "A waiver you stopped meeting", "A new fee line on your statement"],
        intro: "lookFor",
      },
    },
  ],
  takeaway: "The waiver conditions decide whether you pay this fee.",
  describe:
    "Your bank charges $10 every month for having the account, $120 over a year if the fee is not waived. Common waivers are a qualifying direct deposit, a minimum balance and linked balances. Look for the balance rule, a waiver you stopped meeting and a new fee line on your statement.",
};
