import type { FeeScene } from "../types";

/** Digital banking guide, "You are usually paying for speed": the faster option often has a fee. */
const transfer = { label: "Transfer", amount: 200 };
const speeds = { a: "Standard", b: "Instant" };

export const DIGITAL_BANKING_FEES_SCENE: FeeScene = {
  id: "digital_speed",
  title: "Paying for speed.",
  left: { icon: "phone", label: "Your app" },
  right: { icon: "bank", label: "Other bank" },
  charges: [{ id: "expedite", label: "Instant fee", amount: 3, under: "left" }],
  steps: [
    {
      id: "transfer",
      kind: "transaction",
      durationMs: 6000,
      caption: "You move money electronically.",
      frame: { item: transfer, charges: [], intro: "item" },
    },
    {
      id: "choice",
      kind: "decision",
      durationMs: 6000,
      caption: "Many services offer a standard speed and a faster one.",
      frame: { item: transfer, charges: [], fork: speeds, intro: "fork" },
    },
    {
      id: "instant",
      kind: "charge",
      durationMs: 7000,
      caption: "The faster option often carries a fee.",
      frame: { item: transfer, charges: ["expedite"], fork: { ...speeds, chosen: "b" }, intro: "expedite" },
    },
    {
      id: "standard",
      kind: "outcome",
      durationMs: 6000,
      caption: "The slower version often has no fee.",
      frame: {
        item: { ...transfer, status: "1-3 business days" },
        charges: [],
        fork: { ...speeds, chosen: "a" },
      },
    },
    {
      id: "look",
      kind: "decision",
      durationMs: 7000,
      caption: "Plan a few days ahead, and keep a small buffer.",
      frame: {
        item: { ...transfer, status: "1-3 business days" },
        charges: [],
        lookFor: ["When the money must arrive", "A fee for a returned payment", "Limits on mobile deposit"],
        intro: "lookFor",
      },
    },
  ],
  takeaway: "Most digital banking fees you meet are for speed. A slower option is often free.",
  describe:
    "A $200 electronic transfer. The instant option carries a $3 fee; the standard one often has no fee and takes one to three business days. Look for when the money must arrive, a fee for a returned payment and limits on mobile deposit.",
};
