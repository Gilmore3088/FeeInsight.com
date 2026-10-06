import { describe, it, expect } from "vitest";
import { HAMILTON_VOICE, HAMILTON_VERSION, HAMILTON_ROLES, HAMILTON_RULES, HAMILTON_FORBIDDEN, HAMILTON_SYSTEM_PROMPT } from "./voice";

describe("HAMILTON_VOICE", () => {
  it("exports a version string matching semver pattern", () => {
    expect(HAMILTON_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("HAMILTON_VOICE.version matches HAMILTON_VERSION", () => {
    expect(HAMILTON_VOICE.version).toBe(HAMILTON_VERSION);
  });

  it("has at least 6 stylistic rules", () => {
    expect(HAMILTON_RULES.length).toBeGreaterThanOrEqual(6);
  });

  it("rules are non-empty strings", () => {
    for (const rule of HAMILTON_RULES) {
      expect(typeof rule).toBe("string");
      expect(rule.length).toBeGreaterThan(10);
    }
  });

  it("has at least 5 forbidden terms", () => {
    expect(HAMILTON_FORBIDDEN.length).toBeGreaterThanOrEqual(5);
  });

  it("forbidden terms include key D-05 items: might, I think, I believe", () => {
    const forbidden = HAMILTON_FORBIDDEN as readonly string[];
    expect(forbidden).toContain("might");
    expect(forbidden).toContain("I think");
    expect(forbidden).toContain("I believe");
  });

  it("forbidden terms include casual language from D-05: very, really, quite", () => {
    const forbidden = HAMILTON_FORBIDDEN as readonly string[];
    expect(forbidden).toContain("very");
    expect(forbidden).toContain("really");
    expect(forbidden).toContain("quite");
  });

  it("systemPrompt contains all rules inline", () => {
    for (const rule of HAMILTON_RULES) {
      // Each rule should appear in the system prompt (trimmed to first 40 chars)
      const ruleFragment = rule.slice(0, 40);
      expect(HAMILTON_SYSTEM_PROMPT).toContain(ruleFragment);
    }
  });

  it("systemPrompt references data integrity instruction", () => {
    expect(HAMILTON_SYSTEM_PROMPT).toContain("DATA");
    expect(HAMILTON_SYSTEM_PROMPT).toContain("Do not invent");
  });

  it("systemPrompt references decisive analytical voice", () => {
    expect(HAMILTON_SYSTEM_PROMPT).toContain("decisive");
    expect(HAMILTON_SYSTEM_PROMPT).toContain("top-tier consulting partner");
    expect(HAMILTON_SYSTEM_PROMPT).toContain("implication");
  });

  it("HAMILTON_VOICE.rules is the same reference as HAMILTON_RULES", () => {
    expect(HAMILTON_VOICE.rules).toBe(HAMILTON_RULES);
  });

  it("HAMILTON_VOICE.forbidden is the same reference as HAMILTON_FORBIDDEN", () => {
    expect(HAMILTON_VOICE.forbidden).toBe(HAMILTON_FORBIDDEN);
  });
});

describe("consultant bar", () => {
  it("tells Hamilton not to restate what the public site shows", () => {
    expect(HAMILTON_VERSION).toBe("3.4.0");
    expect(HAMILTON_SYSTEM_PROMPT).toContain("Consultant, not restatement.");
    expect(HAMILTON_SYSTEM_PROMPT).toContain("Never answer by repeating them.");
    expect(HAMILTON_SYSTEM_PROMPT).toContain("Never tell the institution to raise, lower or drop a fee.");
  });
});

describe("implication, never prescription", () => {
  it("never asks Hamilton for what the reader should do", () => {
    expect(HAMILTON_SYSTEM_PROMPT).not.toMatch(/what to do about it|should the reader DO|language: 'Banks must'|or recommendation/);
    expect(HAMILTON_SYSTEM_PROMPT).toContain("You support the decision; you never make it.");
  });
});

describe("the four roles", () => {
  it("puts all four roles in the system prompt", () => {
    expect(HAMILTON_ROLES.map((r) => r.role)).toEqual([
      "Inquisitive Economist",
      "Rigorous Consultant",
      "Artistic Data Engineer",
      "Technical yet Clear Writer",
    ]);
    for (const r of HAMILTON_ROLES) expect(HAMILTON_SYSTEM_PROMPT).toContain(`${r.role}: ${r.rule}`);
    expect(HAMILTON_SYSTEM_PROMPT).toContain("ask exactly one clarifying question");
    expect(HAMILTON_SYSTEM_PROMPT).toContain("$209 thousand");
  });
});
