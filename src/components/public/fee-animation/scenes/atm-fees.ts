import type { FeeScene } from "../types";

/**
 * ATM fees guide, "Why was I charged twice?". The timing and the captions are James's pilot
 * sequence (Oct 17): 0-5 s, 5-12 s, 12-19 s, 19-25 s, then the end frame. The first caption
 * states the withdrawal instead of trailing off (James's review, Oct 17: exact wording).
 */
export const ATM_FEES_SCENE: FeeScene = {
  id: "atm_two_fee",
  title: "One withdrawal. Two possible fees.",
  left: { icon: "atm", label: "ATM operator" },
  right: { icon: "bank", label: "Your bank" },
  charges: [
    { id: "operator", label: "Operator surcharge", amount: 3, under: "left" },
    { id: "bank", label: "Out-of-network fee", amount: 2, under: "right" },
  ],
  steps: [
    {
      id: "withdrawal",
      kind: "transaction",
      durationMs: 5000,
      caption: "You withdraw $40 at another bank's ATM.",
      frame: { item: { label: "Cash", amount: 40, via: "card" }, charges: [], intro: "item" },
    },
    {
      id: "operator",
      kind: "charge",
      durationMs: 7000,
      caption: "The ATM operator may charge you.",
      frame: { item: { label: "Cash", amount: 40 }, charges: ["operator"], intro: "operator" },
    },
    {
      id: "bank",
      kind: "charge",
      durationMs: 7000,
      caption: "Your bank may charge you, too.",
      frame: { item: { label: "Cash", amount: 40 }, charges: ["operator", "bank"], intro: "bank" },
    },
    {
      id: "total",
      kind: "outcome",
      durationMs: 6000,
      caption: "Check both before you withdraw.",
      frame: {
        item: { label: "Cash", amount: 40 },
        charges: ["operator", "bank"],
        total: { label: "Total fees", note: "$45 leaves your account in all" },
        intro: "total",
      },
    },
  ],
  takeaway: "The surcharge displayed at the ATM may not be the only charge.",
  describe:
    "A $40 withdrawal at another bank's ATM. The ATM operator adds a $3 surcharge and your bank adds a $2 out-of-network fee, so the withdrawal carries $5 in fees.",
};
