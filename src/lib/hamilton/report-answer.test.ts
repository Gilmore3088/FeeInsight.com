import { describe, expect, it } from "vitest";
import { parseAnswerSection, parseTradeoffSection, REPORT_CONFIDENCE_LIMITATION } from "./report-answer";

describe("parseAnswerSection", () => {
  it("reads the headline and up to three decisions with confidence", () => {
    const parsed = parseAnswerSection(
      [
        "HEADLINE: Raise the NSF fee; hold the rest.",
        "1. DECISION: Raise NSF to $30 || WHY: Five local banks charge $30. || CONFIDENCE: High — 5 competitors, verified",
        "DECISION: Hold overdraft at $25 || WHY: At the median. || CONFIDENCE: low",
        "DECISION: Publish the maintenance fee || WHY: Peers publish it.",
        "DECISION: A fourth one || WHY: ignored",
      ].join("\n"),
    );
    expect(parsed?.headline).toBe("Raise the NSF fee; hold the rest.");
    expect(parsed?.decisions).toEqual([
      { action: "Raise NSF to $30", why: "Five local banks charge $30.", confidence: "Medium", confidenceReason: `5 competitors, verified · ${REPORT_CONFIDENCE_LIMITATION}` },
      { action: "Hold overdraft at $25", why: "At the median.", confidence: "Low", confidenceReason: null },
      { action: "Publish the maintenance fee", why: "Peers publish it.", confidence: null, confidenceReason: null },
    ]);
  });

  it("caps a model-written High label even when its reason says verified", () => {
    const parsed = parseAnswerSection(
      "HEADLINE: Synthetic conclusion.\nDECISION: Review overdraft || WHY: 5 peers || CONFIDENCE: HIGH: 5 peers, verified",
    );
    expect(parsed?.decisions[0].confidence).toBe("Medium");
    expect(parsed?.decisions[0].confidenceReason).toContain(REPORT_CONFIDENCE_LIMITATION);
  });

  it("leaves Medium and Low directional labels intact", () => {
    const parsed = parseAnswerSection(
      "HEADLINE: Synthetic conclusion.\nDECISION: Review overdraft || WHY: 5 peers || CONFIDENCE: Medium - 5 peers, provisional",
    );
    expect(parsed?.decisions[0]).toMatchObject({ confidence: "Medium", confidenceReason: "5 peers, provisional" });
  });

  it("returns null when the model ignored the format, so the caller keeps the prose", () => {
    expect(parseAnswerSection("Fees are in line with peers.\n\nNo change is needed.")).toBeNull();
    expect(parseAnswerSection("HEADLINE: Something")).toBeNull();
  });
});

describe("parseTradeoffSection", () => {
  it("splits watch lines from the trade-off prose", () => {
    const parsed = parseTradeoffSection(
      "Raising NSF draws complaints.\n\nWhat this data cannot tell you: volumes.\nWATCH: Bank A's NSF price\n- WATCH: complaint trend",
    );
    expect(parsed.body).toBe("Raising NSF draws complaints.\n\nWhat this data cannot tell you: volumes.");
    expect(parsed.watch).toEqual(["Bank A's NSF price", "complaint trend"]);
  });
});
