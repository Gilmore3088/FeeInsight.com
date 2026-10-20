import type { FeeScene } from "../types";

/** Closure and dormancy guide, "What are closure and dormancy fees?": a recurring fee can empty a forgotten account. */
const account = { label: "Old account", amount: 50 };

export const ACCOUNT_CLOSURE_FEES_SCENE: FeeScene = {
  id: "dormant_account",
  title: "A forgotten account, slowly emptied.",
  left: { icon: "bank", label: "Your bank" },
  right: { icon: "calendar", label: "No activity" },
  charges: [{ id: "dormancy", label: "Dormancy fee", amount: 5, under: "left" }],
  steps: [
    {
      id: "account",
      kind: "transaction",
      durationMs: 6000,
      caption: "An account you stopped using still holds $50.",
      frame: { item: account, charges: [], intro: "item" },
    },
    {
      id: "fee",
      kind: "charge",
      durationMs: 6000,
      caption: "After a period with no activity, a dormancy fee can start.",
      frame: { item: { ...account, status: "Inactive" }, charges: ["dormancy"], intro: "dormancy" },
    },
    {
      id: "drained",
      kind: "outcome",
      durationMs: 7000,
      caption: "A recurring fee can empty a small, forgotten balance.",
      frame: {
        item: { ...account, status: "Inactive" },
        charges: ["dormancy"],
        total: { label: "Ten months of fees", amount: 50, note: "Enough to empty the $50 balance" },
        intro: "total",
      },
    },
    {
      id: "choice",
      kind: "decision",
      durationMs: 6000,
      caption: "Close it properly, or keep it active.",
      frame: {
        item: { ...account, status: "Inactive" },
        charges: ["dormancy"],
        fork: { a: "Close it properly", b: "Keep it active" },
        intro: "fork",
      },
    },
    {
      id: "look",
      kind: "decision",
      durationMs: 7000,
      caption: "Ask what counts as activity, and get closure in writing.",
      frame: {
        item: { ...account, status: "Inactive" },
        charges: ["dormancy"],
        lookFor: ["What counts as activity", "A fee for closing too soon", "Written proof it is closed"],
        intro: "lookFor",
      },
    },
  ],
  takeaway: "A forgotten account with a small balance can be emptied by a recurring fee.",
  describe:
    "An unused account holds $50. After a period with no activity, a $5 dormancy fee starts, and ten months of it empties the balance. Close it properly or keep it active. Look for what counts as activity, a fee for closing too soon and written proof it is closed.",
};
