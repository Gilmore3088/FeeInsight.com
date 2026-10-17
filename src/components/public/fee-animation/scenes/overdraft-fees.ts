import type { FeeScene } from "../types";

/**
 * Overdraft guide, "I was charged. What happened?". Uses the guide's own example ($40 in
 * checking, a $60 bill) and its consent rule: the debit card choice covers ATM withdrawals and
 * one-time debit card purchases only. No step promises a decline.
 */
const bill = { label: "Bill", amount: 60 };

export const OVERDRAFT_FEES_SCENE: FeeScene = {
  id: "overdraft",
  title: "Paid, and charged for it.",
  left: { icon: "bank", label: "Your bank" },
  right: { icon: "store", label: "The biller" },
  charges: [{ id: "overdraft", label: "Overdraft fee", amount: 35, under: "left" }],
  steps: [
    {
      id: "payment",
      kind: "transaction",
      durationMs: 6000,
      caption: "You have $40 in checking, and a $60 bill arrives.",
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
      frame: {
        item: { ...bill, status: "Balance now -$20", statusTone: "alert" },
        charges: ["overdraft"],
        fork: { a: "Paid (overdraft)", b: "Returned (NSF)", chosen: "a" },
        intro: "overdraft",
      },
    },
    {
      id: "limits",
      kind: "outcome",
      durationMs: 7000,
      caption: "Find your account's limits and extra charges.",
      frame: {
        item: { ...bill, status: "Balance now -$20", statusTone: "alert" },
        charges: ["overdraft"],
        lookFor: ["A daily limit on these fees", "A charge if you stay negative", "Grace period, small-shortfall rule"],
        intro: "lookFor",
      },
    },
    {
      id: "consent",
      kind: "decision",
      durationMs: 7000,
      caption: "Your debit card choice covers only some payments.",
      frame: {
        item: { ...bill, status: "Balance now -$20", statusTone: "alert" },
        charges: ["overdraft"],
        lookForTitle: "Your debit card choice",
        lookFor: ["Covers: ATM, one-time card buys", "Not: checks or ACH payments", "Not: recurring card payments"],
        intro: "lookFor",
      },
    },
  ],
  takeaway: "An overdraft pays the bill, and a fee may apply. Your debit card choice does not cover checks, ACH payments or recurring card payments.",
  describe:
    "With $40 in checking, a $60 bill arrives. Your bank pays it, the balance goes to minus $20, and a $35 overdraft fee may apply. Look for a daily limit, a charge for staying negative and a grace period. Your debit card choice covers ATM withdrawals and one-time card purchases, not checks, ACH payments or recurring card payments.",
};
