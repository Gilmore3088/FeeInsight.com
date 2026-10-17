import type { FeeScene } from "../types";

/**
 * NSF guide, "What is an NSF fee?". The payment is returned unpaid, a fee may still apply, and
 * the biller may add its own, so one returned payment can cost twice. Uses the guide's $40 and $60.
 */
const payment = { label: "Payment", amount: 60 };
const returned = { ...payment, status: "Returned unpaid", statusTone: "alert" as const };
const fork = { a: "Paid (overdraft)", b: "Returned (NSF)", chosen: "b" as const };

export const NSF_FEES_SCENE: FeeScene = {
  id: "nsf",
  title: "Not paid, and still charged.",
  left: { icon: "bank", label: "Your bank" },
  right: { icon: "store", label: "The biller" },
  charges: [
    { id: "nsf", label: "NSF fee", amount: 35, under: "left" },
    { id: "biller", label: "Biller's own fee", amount: 20, under: "right" },
  ],
  steps: [
    {
      id: "payment",
      kind: "transaction",
      durationMs: 6000,
      caption: "You have $40 in checking, and a $60 payment is taken from your account.",
      frame: { item: payment, charges: [], intro: "item" },
    },
    {
      id: "returned",
      kind: "decision",
      durationMs: 6000,
      caption: "Your bank sends it back unpaid.",
      frame: { item: returned, charges: [], fork, intro: "fork" },
    },
    {
      id: "nsf",
      kind: "charge",
      durationMs: 7000,
      caption: "The payment fails, and an NSF fee may still apply.",
      frame: { item: returned, charges: ["nsf"], fork, intro: "nsf" },
    },
    {
      id: "biller",
      kind: "charge",
      durationMs: 7000,
      caption: "The biller may add a fee of its own.",
      frame: { item: returned, charges: ["nsf", "biller"], fork, intro: "biller" },
    },
    {
      id: "twice",
      kind: "outcome",
      durationMs: 6000,
      caption: "One returned payment can cost you twice.",
      frame: {
        item: returned,
        charges: ["nsf", "biller"],
        total: { label: "Fees, one payment", note: "And the $60 bill is still unpaid" },
        intro: "total",
      },
    },
    {
      id: "look",
      kind: "decision",
      durationMs: 7000,
      caption: "Check your account's NSF policy before it happens.",
      frame: {
        item: returned,
        charges: ["nsf", "biller"],
        lookFor: ["An NSF fee on your account", "A daily limit on these fees", "A fee each time it's retried"],
        intro: "lookFor",
      },
    },
  ],
  takeaway: "With an NSF fee, the payment fails and you can still be charged.",
  describe:
    "With $40 in checking, a $60 payment is taken from your account and your bank returns it unpaid. A $35 NSF fee may apply, and the biller may add $20 of its own: $55 in fees, with the bill still unpaid. Look for an NSF fee on your account, a daily limit and a fee each time the payment is retried.",
};
