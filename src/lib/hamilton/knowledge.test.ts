import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { detectSkill, findOfferedSkill, listSkills } from "@/lib/research/skills";

import { HAMILTON_DELIVERABLES, HAMILTON_KNOWLEDGE_VERSION } from "./knowledge";

const DEVELOPER_SKILLS = [
  "adversarial-document-testing",
  "data-quality-audit",
  "error-to-test",
  "fee-evaluation",
  "fee-taxonomy-regression",
  "report-reconciliation",
  "source-evidence-audit",
];

describe("Hamilton product knowledge (#1081)", () => {
  it("offers only the reviewed product deliverables, never a developer skill", () => {
    const ids = listSkills().map((skill) => skill.id);
    expect(ids).toEqual(HAMILTON_DELIVERABLES.map((deliverable) => deliverable.id));
    for (const id of DEVELOPER_SKILLS) expect(ids).not.toContain(id);
    expect(HAMILTON_KNOWLEDGE_VERSION).toBe(2);
  });

  it("never tells the model to recommend a fee change", () => {
    for (const deliverable of HAMILTON_DELIVERABLES) {
      expect(deliverable.framework).not.toMatch(/#+\s*Recommendations/i);
      expect(deliverable.framework).not.toMatch(/actionable recommendation|numbered recommendations/i);
    }
  });

  it("prints no invented example figures in an output template", () => {
    for (const deliverable of HAMILTON_DELIVERABLES) {
      const template = deliverable.framework.split(/\n## (?:Output|Structure) Template\n/)[1]?.split(/\n## /)[0] ?? "";
      expect(template, deliverable.id).not.toMatch(/\|\s*[-+]?\$?\d[\d.,]*\s*(?:%|bps|pp|[MB])?\s*\|/);
    }
  });

  it("matches and recalls deliverables without reading the filesystem", () => {
    const source = readFileSync(path.join(__dirname, "../research/skills.ts"), "utf-8");
    expect(source).not.toMatch(/from "fs"|readFileSync|readdirSync|process\.cwd/);
    expect(detectSkill("How does our overdraft fee benchmark against peers?")?.id).toBe("fee-benchmarking");
    expect(detectSkill("How do I fix this failing test?")).toBeNull();
    const offered = findOfferedSkill([{ text: "Would you like me to generate a full **fee-benchmarking**?" }]);
    expect(offered?.content).toContain("Peer");
  });
});
