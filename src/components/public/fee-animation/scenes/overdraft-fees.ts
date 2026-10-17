import type { FeeScene } from "../types";

/**
 * Overdraft guide, "I was charged. What happened?". Uses the guide's own example ($40 in
 * checking, a $60 payment) and stays on paid versus sent back (James's review, Oct 17): daily
 * limits, negative-balance charges, exemptions and debit card consent are the guide text's job.
 * It ends on one prompt. No step promises a decline.
 */
const bill = { label: "Payment", amount: 60 };
const paid = { ...bill, status: "-$20 before fee", statusTone: "alert" as const };
const chosen = { a: "Paid (overdraft)", b: "Returned (NSF)", chosen: "a" as const };

export const OVERDRAFT_FEES_SCENE: FeeScene = {
  id: "overdraft",
  title: "Paid, and a fee may apply.",
  left: { icon: "bank", label: "Your bank" },
  right: { icon: "store", label: "The biller" },
  charges: [{ id: "overdraft", label: "Overdraft fee", amount: 35, under: "left" }],
  steps: [
    {
      id: "payment",
      kind: "transaction",
      durationMs: 6000,
      caption: "You have $40 in checking, and a $60 payment is taken from your account.",
      frame: { item: bill, charges: [], intro: "item" },
    },
    {
      id: "decision",
      kind: "decision",
      durationMs: 6000,
      caption: "Your bank can pay it or send it back.",
      frame: { item: bill, charges: [], fork: { a: "Paid (overdraft)", b: "Returned (NSF)" }, intro: "fork" },
    },
    {
      id: "paid",
      kind: "charge",
      durationMs: 7000,
      caption: "If your bank pays it, an overdraft fee may apply.",
      frame: { item: paid, charges: ["overdraft"], fork: chosen, intro: "overdraft" },
    },
    {
      id: "check",
      kind: "outcome",
      durationMs: 6000,
      caption: "Check which transactions your overdraft choice covers.",
      frame: { item: paid, charges: ["overdraft"], fork: chosen },
    },
  ],
  takeaway: "If your bank pays a payment you cannot cover, an overdraft fee may apply.",
  describe:
    "With $40 in checking, a $60 payment is taken from your account. Your bank can pay it or send it back. If it pays, the balance goes to minus $20 before any fee, and a $35 overdraft fee may apply. Check which transactions your overdraft choice covers.",
};
