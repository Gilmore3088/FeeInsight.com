import type { FeeScene } from "../types";

/** Foreign transaction guide, "What is a foreign transaction fee?": a percentage, folded into the amount. */
const purchase = { label: "Purchase", amount: 100 };

export const FOREIGN_TRANSACTION_FEES_SCENE: FeeScene = {
  id: "foreign_transaction",
  title: "A fee folded into the price.",
  left: { icon: "card", label: "Your card" },
  right: { icon: "globe", label: "Overseas seller" },
  charges: [{ id: "foreign", label: "3% foreign fee", amount: 3, under: "left" }],
  steps: [
    {
      id: "purchase",
      kind: "transaction",
      durationMs: 6000,
      caption: "You buy something in another currency, or from an overseas seller.",
      frame: { item: purchase, charges: [], intro: "item" },
    },
    {
      id: "fee",
      kind: "charge",
      durationMs: 6000,
      caption: "Your card issuer may add a percentage.",
      frame: { item: purchase, charges: ["foreign"], intro: "foreign" },
    },
    {
      id: "folded",
      kind: "outcome",
      durationMs: 6000,
      caption: "It is often folded into the purchase amount on your statement.",
      frame: {
        item: purchase,
        charges: ["foreign"],
        total: { label: "On your statement", amount: 103, note: "May show no separate fee line" },
        intro: "total",
      },
    },
    {
      id: "currency",
      kind: "decision",
      durationMs: 7000,
      caption: "Offered dollars at a terminal abroad? Choose the local currency.",
      frame: { item: purchase, charges: ["foreign"], fork: { a: "Local currency", b: "US dollars", chosen: "a" }, intro: "fork" },
    },
    {
      id: "look",
      kind: "decision",
      durationMs: 7000,
      caption: "Check the fee on each card before you travel or order.",
      frame: {
        item: purchase,
        charges: ["foreign"],
        lookFor: ["A card with no foreign fee", "Debit and credit terms can differ", "Overseas online buys count too"],
        intro: "lookFor",
      },
    },
  ],
  takeaway: "A foreign transaction fee is a percentage, so it grows with what you spend.",
  describe:
    "A $100 purchase from an overseas seller. Your card issuer adds a 3% fee, $3, and your statement may show $103 with no separate fee line. At a terminal abroad, choose the local currency over dollars. Look for a card with no foreign fee, check debit and credit terms separately, and remember overseas online purchases count too.",
};
