import type { FeeScene } from "../types";

/**
 * Overdraft guide, "I was charged. What happened?". Uses the guide's own example ($40 in
 * checking, a $60 payment) and its consent rule: debit card opt-in covers ATM withdrawals and
 * one-time debit card purchases only. No step promises a decline.
 */
const bill = { label: "Payment", amount: 60 };

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
      frame: {
        item: { ...bill, status: "-$20 before fee", statusTone: "alert" },
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
        item: { ...bill, status: "-$20 before fee", statusTone: "alert" },
        charges: ["overdraft"],
        lookFor: ["A daily limit on these fees", "A charge if you stay negative", "A small-overdraft exemption"],
        intro: "lookFor",
      },
    },
    {
      id: "consent",
      kind: "decision",
      durationMs: 7000,
      caption: "The debit card opt-in rule covers only ATM and one-time card purchases.",
      frame: {
        item: { ...bill, status: "-$20 before fee", statusTone: "alert" },
        charges: ["overdraft"],
        lookForTitle: "Debit card opt-in",
        lookFor: ["Covers: ATM, one-time card buys", "Not: checks or ACH payments", "Not: recurring card payments"],
        intro: "lookFor",
      },
    },
  ],
  takeaway: "An overdraft pays the bill, and a fee may apply. The debit card opt-in rule does not cover checks, ACH payments or recurring card payments.",
  describe:
    "With $40 in checking, a $60 payment is taken from your account. Your bank pays it, the balance goes to minus $20 before any fee, and a $35 overdraft fee may apply. Look for a daily limit, a charge for staying negative and a small-overdraft exemption. Debit card opt-in covers ATM withdrawals and one-time card purchases, not checks, ACH payments or recurring card payments.",
};
