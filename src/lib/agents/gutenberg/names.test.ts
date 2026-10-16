import { describe, expect, it } from "vitest";

import { STEP_OWNER } from "@/lib/agents/narrate";
import { GUTENBERG_AGENT, isPublisherAgent, ledgerAgent, PUBLISHER_AGENT_NAMES, PUBLISHER_STEP_KEYS } from "./names";

describe("Gutenberg's names (#1075)", () => {
  it("reads publisher work under Hamilton's name and Gutenberg's", () => {
    expect(PUBLISHER_AGENT_NAMES).toEqual(["hamilton", "gutenberg"]);
    expect(isPublisherAgent("hamilton")).toBe(true);
    expect(isPublisherAgent(GUTENBERG_AGENT)).toBe(true);
    expect(isPublisherAgent("darwin")).toBe(false);
    expect(isPublisherAgent(null)).toBe(false);
  });

  it("owns exactly the publisher steps, and Hamilton keeps the product's", () => {
    const gutenbergSteps = Object.entries(STEP_OWNER).filter(([, agent]) => agent === GUTENBERG_AGENT).map(([key]) => key);
    expect(gutenbergSteps.sort()).toEqual([...PUBLISHER_STEP_KEYS].sort());
    for (const key of ["briefing-refresh", "competitor-alerts", "hamilton-answer-eval", "report-render", "study-fee-income"]) {
      expect(STEP_OWNER[key]).toBe("hamilton");
    }
  });

  it("files a pre-switch publisher step under Gutenberg and leaves everything else alone", () => {
    expect(ledgerAgent("hamilton", "publish")).toBe("gutenberg");
    expect(ledgerAgent("hamilton", "category-guard")).toBe("gutenberg");
    expect(ledgerAgent("hamilton", "briefing-refresh")).toBe("hamilton");
    expect(ledgerAgent("hamilton", null)).toBe("hamilton");
    expect(ledgerAgent("gutenberg", "publish")).toBe("gutenberg");
    expect(ledgerAgent("darwin", "publish")).toBe("darwin");
  });
});
