import { describe, expect, it } from "vitest";
import { questionOnly, writtenAnswerResponse } from "./answer-save";

describe("questionOnly", () => {
  it("drops the earlier question the Analyze screen appends", () => {
    expect(questionOnly('Who are my local competitors?\n\n(For context, my previous question was: "What is my OD fee?")'))
      .toBe("Who are my local competitors?");
  });

  it("leaves a plain question alone", () => {
    expect(questionOnly("  What is my OD fee? ")).toBe("What is my OD fee?");
  });
});

describe("writtenAnswerResponse", () => {
  const text = [
    "## Hamilton's View",
    "Your overdraft fee of $35 sits above the peer median of $29.",
    "## What This Means",
    "You charge more than most peers.",
    "## Why It Matters",
    "- Overdraft is the most compared fee",
    "## Evidence",
    "| Metric | Value |",
    "|---|---|",
    "| Overdraft fee | $35 |",
  ].join("\n");

  it("parses the sections without treating numerical matches as verified claims", () => {
    const response = writtenAnswerResponse(text, [{ fee: 35, peer_median: 29 }]);
    expect(response.hamiltonView).toContain("$35");
    expect(response.whatThisMeans).toBe("You charge more than most peers.");
    expect(response.title.length).toBeGreaterThan(0);
    expect(response.confidence.level).toBe("medium");
    expect(response.confidence.basis.join(" ")).toContain("Numerical consistency only");
  });

  it("marks confidence low when a figure is not in the data", () => {
    expect(writtenAnswerResponse(text, [{ fee: 35 }]).confidence.level).toBe("low");
  });
});
