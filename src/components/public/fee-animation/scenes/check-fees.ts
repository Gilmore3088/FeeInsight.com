import type { FeeScene } from "../types";

/** Check fees guide, "How much does it cost?": a stop payment is charged whether or not it works. */
const check = { label: "Your check", amount: 200 };

export const CHECK_FEES_SCENE: FeeScene = {
  id: "check_stop_payment",
  title: "Paying to stop a check.",
  left: { icon: "check", label: "Check you wrote" },
  right: { icon: "bank", label: "Your bank" },
  charges: [{ id: "stop", label: "Stop payment fee", amount: 30, under: "right" }],
  steps: [
    {
      id: "check",
      kind: "transaction",
      durationMs: 6000,
      caption: "You wrote a check, and now you want to stop it.",
      frame: { item: check, charges: [], intro: "item" },
    },
    {
      id: "fee",
      kind: "charge",
      durationMs: 6000,
      caption: "Asking your bank not to honor it carries a fee.",
      frame: { item: check, charges: ["stop"], intro: "stop" },
    },
    {
      id: "either",
      kind: "decision",
      durationMs: 7000,
      caption: "The fee is charged whether or not the stop succeeds.",
      frame: { item: check, charges: ["stop"], fork: { a: "Stopped in time", b: "Already cleared" }, intro: "fork" },
    },
    {
      id: "cleared",
      kind: "outcome",
      durationMs: 6000,
      caption: "If the check has already cleared, the stop does nothing.",
      frame: {
        item: { ...check, status: "Already paid", statusTone: "alert" },
        charges: ["stop"],
        fork: { a: "Stopped in time", b: "Already cleared", chosen: "b" },
      },
    },
    {
      id: "look",
      kind: "decision",
      durationMs: 7000,
      caption: "Look first, then put the stop in writing.",
      frame: {
        item: { ...check, status: "Already paid", statusTone: "alert" },
        charges: ["stop"],
        lookFor: ["Whether the check has cleared", "A stop order in writing", "The date the stop expires"],
        intro: "lookFor",
      },
    },
  ],
  takeaway: "Check whether a payment has cleared before you pay to stop it.",
  describe:
    "You wrote a $200 check and ask your bank to stop it. The $30 stop payment fee is charged whether or not the stop succeeds, and if the check has already cleared, the stop does nothing. Look for whether it has cleared, put the stop in writing and note the date it expires.",
};
