import { describe, expect, it } from "vitest";
import { boardBriefFromAnalysis, editBoardBrief } from "./board-brief";
import { buildFeeAnswer } from "./workspace/answer";
import { storylineAnalysis } from "./workspace/analysis-record";
import { overdraftResearch } from "./workspace/test-fixtures";
import { buildFeeResearchEvidence } from "./evidence-contract";

const research = overdraftResearch();
const frozen = storylineAnalysis(buildFeeAnswer(research).storyline!, "test", buildFeeResearchEvidence(research), { version: 1, researchInstitutionId: 2, accountInstitutionId: 1, accountStatus: "identified", researchInstitutionName: "Research CU", accountInstitutionName: "Home CU" });
const edits = { title: "Florida fee review", teamNote: "Discuss waivers with the team.", includeEvidence: true };

describe("board brief reuses frozen analysis", () => {
  it("preserves different home/subject identities, all values and record-bound evidence", () => {
    const report = boardBriefFromAnalysis(frozen, "saved-original", edits);
    expect(report.identityContext).toEqual(frozen.identityContext);
    expect(report.boardBrief?.factEvidence).toEqual(frozen.factEvidence);
    expect(report.exhibits?.[0].rows).toEqual(frozen.evidence.metrics.map(m => [m.label, m.value, m.note ?? "Not recorded"]));
    expect(report.executiveSummary).toEqual([frozen.hamiltonView]);
    expect(report.implementationNotes).toContain("Team note (user-authored): Discuss waivers with the team.");
    expect(report.sources?.every(s => s.detail.includes("Reporting period"))).toBe(true);
  });
  it("edits team text without changing the original findings, sources or institution", () => {
    const report = boardBriefFromAnalysis(frozen, "saved-original", edits);
    const updated = editBoardBrief(report, { ...edits, title: "Edited title", teamNote: "New team note", includeEvidence: false });
    expect(updated.title).toBe("Edited title");
    expect(updated.exhibits).toEqual(report.exhibits);
    expect(updated.sources).toEqual(report.sources);
    expect(updated.identityContext).toEqual(report.identityContext);
    expect(updated.boardBrief?.factEvidence).toEqual(frozen.factEvidence);
    expect(updated.implementationNotes.filter(n => n.startsWith("Team note"))).toEqual(["Team note (user-authored): New team note"]);
  });
  it("can leave the exhibit out on creation without discarding the evidence snapshot", () => {
    const report = boardBriefFromAnalysis(frozen, "saved-original", { ...edits, includeEvidence: false });
    expect(report.exhibits).toEqual([]);
    expect(report.boardBrief?.factEvidence).toEqual(frozen.factEvidence);
  });
  it("labels missing legacy provenance instead of substituting current sources", () => {
    const report = boardBriefFromAnalysis({ ...frozen, storyline: undefined, factEvidence: undefined, identityContext: undefined }, "legacy", edits);
    expect(report.identityContext).toBeUndefined();
    expect(report.sources?.[0].detail).toContain("not recorded");
  });
});
