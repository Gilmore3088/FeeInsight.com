import type { FeeScene } from "../types";

/** Safe deposit guide, "What is a safe deposit box fee?": annual, set by size, contents not FDIC insured. */
const rental = { label: "Yearly rent" };

export const SAFE_DEPOSIT_FEES_SCENE: FeeScene = {
  id: "safe_deposit",
  title: "Renting a box in the vault.",
  left: { icon: "box", label: "Vault box" },
  right: { icon: "bank", label: "Your bank" },
  charges: [{ id: "annual", label: "Annual fee", amount: 60, under: "right" }],
  steps: [
    {
      id: "rental",
      kind: "transaction",
      durationMs: 6000,
      caption: "A safe deposit box is a locked box in your bank's vault, rented by the year.",
      frame: { item: rental, charges: [], intro: "item" },
    },
    {
      id: "fee",
      kind: "charge",
      durationMs: 6000,
      caption: "The fee is annual and set by box size.",
      frame: { item: rental, charges: ["annual"], intro: "annual" },
    },
    {
      id: "size",
      kind: "decision",
      durationMs: 6000,
      caption: "Larger boxes cost more, and prices can vary by branch.",
      frame: { item: rental, charges: ["annual"], fork: { a: "Smaller box", b: "Larger box" }, intro: "fork" },
    },
    {
      id: "insured",
      kind: "outcome",
      durationMs: 7000,
      caption: "The contents are not FDIC insured.",
      frame: { item: { ...rental, status: "Not FDIC insured", statusTone: "alert" }, charges: ["annual"] },
    },
    {
      id: "look",
      kind: "decision",
      durationMs: 7000,
      caption: "Ask about waivers, insurance and lost keys.",
      frame: {
        item: { ...rental, status: "Not FDIC insured", statusTone: "alert" },
        charges: ["annual"],
        lookFor: ["A waiver on your account", "Insurance you arrange yourself", "Charges if both keys are lost"],
        intro: "lookFor",
      },
    },
  ],
  takeaway: "A box rents space in the vault. Its contents are insured only if you arrange that separately.",
  describe:
    "A box in your bank's vault, rented by the year for an illustrative $60. Larger boxes cost more, and the contents are not FDIC insured. Look for a waiver on your account, insurance you arrange yourself and the charge if both keys are lost.",
};
