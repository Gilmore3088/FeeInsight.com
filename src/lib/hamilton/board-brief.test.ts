import { describe, expect, it } from "vitest";
import { boardBriefFromAnalysis, editBoardBrief, readerAsOf, readerLimitation } from "./board-brief";
import { buildFeeAnswer } from "./workspace/answer";
import { storylineAnalysis } from "./workspace/analysis-record";
import { overdraftResearch } from "./workspace/test-fixtures";
import { buildFeeResearchEvidence, CLAIM_BINDING_LIMITATION } from "./evidence-contract";

const research = overdraftResearch();
const frozen = storylineAnalysis(buildFeeAnswer(research).storyline!, "test", buildFeeResearchEvidence(research), { version: 1, researchInstitutionId: 2, accountInstitutionId: 1, accountStatus: "identified", researchInstitutionName: "Research CU", accountInstitutionName: "Home CU" });
const edits = { title: "Florida fee review", teamNote: "Discuss waivers with the team.", includeEvidence: true };

describe("board brief reuses frozen analysis", () => {
  it("preserves different home/subject identities, all values and record-bound evidence", () => {
    const report = boardBriefFromAnalysis(frozen, "saved-original", edits);
    expect(report.identityContext).toEqual(frozen.identityContext);
    expect(report.boardBrief?.factEvidence).toEqual(frozen.factEvidence);
    expect(report.exhibits?.[0].rows).toEqual(frozen.evidence.metrics.map(m => [m.label, m.value, m.note ?? ""]));
    expect(report.executiveSummary).toEqual([frozen.hamiltonView]);
    expect(report.implementationNotes).toContain("Team note (user-authored): Discuss waivers with the team.");
    expect(report.sources?.every(s => s.detail.startsWith("As of "))).toBe(true);
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
  it("lists every saved evidence record by ID, with the stored-source limit, and never claims a live check", () => {
    const report = boardBriefFromAnalysis(frozen, "saved-original", edits);
    const records = report.exhibits?.find(e => e.id === "evidence_records");
    const ids = [...frozen.factEvidence!.facts, ...frozen.factEvidence!.derivations].map(f => f.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(records?.rows.map(r => r[0])).toEqual(ids);
    expect(records?.note).toContain("did not re-check it against the bank's current live schedule");
    expect(report.recommendation).toContain("not re-checked against the bank's current live schedule");
    expect(JSON.stringify(report)).not.toMatch(/verified against the (current )?live/i);
  });
  it("labels missing legacy provenance instead of substituting current sources", () => {
    const report = boardBriefFromAnalysis({ ...frozen, storyline: undefined, factEvidence: undefined, identityContext: undefined }, "legacy", edits);
    expect(report.identityContext).toBeUndefined();
    expect(report.sources?.[0].detail).toContain("were not saved with this answer");
  });
});

describe("board brief words", () => {
  it("writes source dates as a board reads them", () => {
    expect(readerAsOf("2026-10-12T00:00:00.000Z")).toBe("Oct 12, 2026");
    expect(readerAsOf("2026-06-30")).toBe("Jun 30, 2026");
    expect(readerAsOf("Oct 2026")).toBe("Oct 2026");
  });
  it("puts the saved evidence limits in plain words without changing the stored record", () => {
    expect(readerLimitation("3 structured evidence records saved with explicit identity/source context.")).not.toMatch(/structured|identity\/source/);
    expect(readerLimitation(CLAIM_BINDING_LIMITATION)).toContain("not checked one by one");
    const report = boardBriefFromAnalysis(frozen, "saved-original", edits);
    expect(report.recommendation).not.toMatch(/structured evidence|derivations/);
    expect(frozen.confidence.basis).toContain(CLAIM_BINDING_LIMITATION);
  });
});
