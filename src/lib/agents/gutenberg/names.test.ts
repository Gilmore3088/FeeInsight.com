import { describe, expect, it } from "vitest";

import { GUTENBERG_AGENT, isPublisherAgent, PUBLISHER_AGENT_NAMES } from "./names";

describe("Gutenberg's names (#1075 step 1)", () => {
  it("reads publisher work under Hamilton's name and Gutenberg's", () => {
    expect(PUBLISHER_AGENT_NAMES).toEqual(["hamilton", "gutenberg"]);
    expect(isPublisherAgent("hamilton")).toBe(true);
    expect(isPublisherAgent(GUTENBERG_AGENT)).toBe(true);
    expect(isPublisherAgent("darwin")).toBe(false);
    expect(isPublisherAgent(null)).toBe(false);
  });
});
