import type { FeeScene } from "../types";

/** Wire guide, "What is a wire transfer fee?": charged in both directions, final once it lands. */
const wire = { label: "Wire", amount: 1000 };

export const WIRE_TRANSFER_FEES_SCENE: FeeScene = {
  id: "wire_transfer",
  title: "One wire. A possible fee at each end.",
  left: { icon: "bank", label: "Your bank" },
  right: { icon: "bank", label: "Their bank" },
  charges: [
    { id: "outgoing", label: "Sending fee", amount: 30, under: "left" },
    { id: "incoming", label: "Receiving fee", amount: 15, under: "right" },
  ],
  steps: [
    {
      id: "wire",
      kind: "transaction",
      durationMs: 6000,
      caption: "A wire moves money between banks, usually the same day.",
      frame: { item: wire, charges: [], intro: "item" },
    },
    {
      id: "outgoing",
      kind: "charge",
      durationMs: 6000,
      caption: "Your bank may charge you to send it.",
      frame: { item: wire, charges: ["outgoing"], intro: "outgoing" },
    },
    {
      id: "incoming",
      kind: "charge",
      durationMs: 6000,
      caption: "The receiving bank may charge to receive it.",
      frame: { item: wire, charges: ["outgoing", "incoming"], intro: "incoming" },
    },
    {
      id: "final",
      kind: "outcome",
      durationMs: 6000,
      caption: "Once it lands, the money cannot be pulled back.",
      frame: {
        item: { ...wire, status: "Final once it lands", statusTone: "alert" },
        charges: ["outgoing", "incoming"],
        total: { label: "Fees, one wire" },
        intro: "total",
      },
    },
    {
      id: "look",
      kind: "decision",
      durationMs: 7000,
      caption: "Check both directions, and the cutoff, before you send.",
      frame: {
        item: { ...wire, status: "Final once it lands", statusTone: "alert" },
        charges: ["outgoing", "incoming"],
        lookFor: ["Sending and receiving prices", "Domestic and international prices", "The daily cutoff time"],
        intro: "lookFor",
      },
    },
  ],
  takeaway: "You can be charged to send a wire and to receive one.",
  describe:
    "A $1,000 wire leaves your bank for theirs. Your bank charges $30 to send it and theirs $15 to receive it, $45 in fees, and the money cannot be pulled back once it lands. Look for sending and receiving prices, domestic and international prices, and the daily cutoff time.",
};
