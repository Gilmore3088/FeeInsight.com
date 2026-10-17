import type { FeeScene } from "../types";

/**
 * NSF guide, "What is an NSF fee?". Four beats (James's review, Oct 17): the payment is
 * attempted, it is returned unpaid, your bank and the biller may each charge, and the bill is
 * still owed. Uses the guide's $40 and $60.
 */
const payment = { label: "Payment", amount: 60 };
const returned = { ...payment, status: "Returned unpaid", statusTone: "alert" as const };
const fork = { a: "Paid (overdraft)", b: "Returned (NSF)", chosen: "b" as const };

export const NSF_FEES_SCENE: FeeScene = {
  id: "nsf",
  title: "Not paid, and you can still be charged.",
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
      durationMs: 5000,
      caption: "You have $40 in checking, and a $60 payment is attempted.",
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
      id: "charges",
      kind: "charge",
      durationMs: 7000,
      caption: "Your bank may charge an NSF fee, and the biller may add its own.",
      frame: { item: returned, charges: ["nsf", "biller"], fork, intro: "charges" },
    },
    {
      id: "owed",
      kind: "outcome",
      durationMs: 6000,
      caption: "You still owe the $60 bill.",
      frame: {
        item: returned,
        charges: ["nsf", "biller"],
        total: { label: "Fees, one payment", note: "And the $60 bill is still owed" },
        intro: "total",
      },
    },
  ],
  takeaway: "A returned payment can bring an NSF fee and a biller's fee, and you still owe the bill.",
  describe:
    "With $40 in checking, a $60 payment is attempted and your bank returns it unpaid. Your bank may charge a $35 NSF fee, and the biller may add $20 of its own: $55 in fees, and you still owe the $60 bill.",
};
