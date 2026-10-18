/**
 * #1924 step 3: Ask answers and saved evidence carry the stamp of the data behind every median,
 * percentile and count they quote. Synthetic data only; no claim about a real institution.
 */
import { describe, expect, it } from "vitest";
import { makeStamp, type DatasetStampInput } from "@/lib/dataset-stamp";
import { readStampedFigures } from "@/lib/dataset-note";
import { buildFeeResearchEvidence } from "./evidence-contract";
import { savedEvidenceAppendix } from "./evidence-export";
import { boardBriefFromAnalysis, editBoardBrief } from "./board-brief";
import { answerStamps, buildFeeAnswer } from "./workspace/answer";
import { storylineAnalysis } from "./workspace/analysis-record";
import { buildAskResponse, parseAsk } from "./workspace/ask";
import { overdraftResearch } from "./workspace/test-fixtures";
import type { AnalyzeResponse } from "./types";

const SOURCED = { key: "sourced", label: "Only fees traced to a stored copy of the institution's own fee schedule" };
const LEFT_OUT = { key: "exclude:institution:1", label: "The institution being compared left out" };
const read: DatasetStampInput = {
  dataset: "published_fee_catalog",
  mode: "live",
  readAt: "2026-10-18T14:10:00Z",
  runId: null,
  newestRecordAt: "2026-10-01T00:00:00Z",
  methodVersion: 13,
  counting: "counted_once",
  filters: [SOURCED, LEFT_OUT],
};
const peerStamp = makeStamp({ ...read, filters: [SOURCED, { key: "state:TN", label: "Institutions in Tennessee" }, { key: "charter:credit_union", label: "Credit unions only" }, LEFT_OUT] });
const nationalStamp = makeStamp(read);
const stateStamp = makeStamp({ ...read, filters: [SOURCED, { key: "state:TN", label: "Institutions in Tennessee" }, LEFT_OUT] });

function stampedResearch() {
  return overdraftResearch({ peerStamp, layerStamps: { national: nationalStamp, state: stateStamp } });
}

describe("Ask answer stamps (#1924 step 3)", () => {
  it("puts the stamp of each read behind the answer's figures in its provenance: peers, then each layer", () => {
    const answer = buildFeeAnswer(stampedResearch());
    expect(answer.provenance.stamps).toEqual([
      { label: "Peers", stamp: peerStamp },
      { label: "National", stamp: nationalStamp },
      { label: "Tennessee", stamp: stateStamp },
    ]);
    // Stamps are plain data: they cross to the browser and back unchanged.
    expect(JSON.parse(JSON.stringify(answer.provenance.stamps))).toEqual(answer.provenance.stamps);
  });

  it("names each read once, and leaves out a layer with no median or no stamp", () => {
    const research = overdraftResearch({
      peerStamp: nationalStamp,
      layerStamps: { national: nationalStamp, state: stateStamp },
      layers: overdraftResearch().layers.map((l) => (l.scope === "state" ? { ...l, median: null } : l)),
    });
    expect(answerStamps(research)).toEqual([{ label: "Peers", stamp: nationalStamp }]);
  });

  it("shows no stamp for figures from a read that has none, and never makes one up", () => {
    const answer = buildFeeAnswer(overdraftResearch());
    expect(answer.provenance.stamps).toBeUndefined();
    expect(answerStamps(overdraftResearch({ band: null, peerStamp }))).toEqual([]);
  });

  it("keeps only the national stamp on a segment-led answer, since a segment read has none", () => {
    expect(answerStamps(stampedResearch(), true)).toEqual([{ label: "National", stamp: nationalStamp }]);
  });

  it("reaches the Ask bar's response: the answer it returns carries the stamps", () => {
    const question = "How does our overdraft fee compare?";
    const res = buildAskResponse({ question, intent: parseAsk(question), research: stampedResearch(), memory: [] });
    expect(res.kind).toBe("research");
    expect(res.answer?.provenance.stamps?.map((f) => f.stamp.id)).toEqual([peerStamp.id, nationalStamp.id, stateStamp.id]);
  });
});

describe("saved evidence keeps the stamp from save time (#1924 step 3)", () => {
  const research = stampedResearch();
  const answer = buildFeeAnswer(research);
  const saved = storylineAnalysis(answer.storyline!, "test-engine", buildFeeResearchEvidence(research), undefined, answer.provenance.stamps);
  // What the database hands back: the saved JSON, parsed.
  const reopened = JSON.parse(JSON.stringify(saved)) as AnalyzeResponse;

  it("stores the stamps inside the saved answer's JSON and reads them back exactly as saved", () => {
    expect(saved.datasetStamps).toHaveLength(3);
    expect(readStampedFigures(reopened.datasetStamps)).toEqual(answer.provenance.stamps);
  });

  it("shows the saved stamp, not a newer read, when the answer is reopened", () => {
    const later = makeStamp({ ...read, readAt: "2026-10-25T09:00:00Z" });
    const fresh = buildFeeAnswer(overdraftResearch({ peerStamp: later, layerStamps: { national: later } }));
    expect(fresh.provenance.stamps?.[0].stamp.id).not.toBe(peerStamp.id);
    expect(readStampedFigures(reopened.datasetStamps)[0].stamp.id).toBe(peerStamp.id);
    expect(savedEvidenceAppendix(reopened).dataset?.summary).toContain("18 Oct 2026 14:10 UTC");
  });

  it("prints the stamp's words in the evidence appendix: line, filters, details and how the reads differ", () => {
    const words = savedEvidenceAppendix(reopened).dataset;
    expect(words?.summary).toBe("Published fee schedules, read live 18 Oct 2026 14:10 UTC. Institutions sharing one fee schedule count once.");
    expect(words?.filters).toEqual([SOURCED.label, "Institutions in Tennessee", "Credit unions only", LEFT_OUT.label]);
    expect(words?.details).toContain(`Data reference (for support): ${peerStamp.id}`);
    expect(words?.differences?.heading).toBe("Why these figures can differ");
    expect(words?.differences?.lines).toContain("Only Peers: Credit unions only");
  });

  it("carries the stamps into a board brief, and prints their words among its sources", () => {
    const brief = boardBriefFromAnalysis(reopened, "analysis-1", { title: "", teamNote: "", includeEvidence: true });
    expect(readStampedFigures(brief.datasetStamps)).toEqual(answer.provenance.stamps);
    const line = brief.sources?.find((s) => s.label.startsWith("Published fee schedules, read live"));
    expect(line?.label).toBe("Published fee schedules, read live 18 Oct 2026 14:10 UTC. Institutions sharing one fee schedule count once.");
    expect(line?.detail).toContain("What is counted: Only fees traced to a stored copy of the institution's own fee schedule; Institutions in Tennessee; Credit unions only");
    expect(line?.detail).toContain(`Data reference (for support): ${peerStamp.id}, ${nationalStamp.id}, ${stateStamp.id}.`);
    expect(line?.detail).not.toMatch(/—/);
    // Editing the brief keeps the stamps it was made with.
    expect(editBoardBrief(brief, { title: "New title", teamNote: "Note", includeEvidence: true }).datasetStamps).toEqual(brief.datasetStamps);
  });
});

describe("older saved records without a stamp (#1924 step 3)", () => {
  const research = overdraftResearch();
  const old = JSON.parse(JSON.stringify(storylineAnalysis(buildFeeAnswer(research).storyline!, "1.18.3", buildFeeResearchEvidence(research)))) as AnalyzeResponse;

  it("still open, export and brief, with no dataset note and no invented stamp", () => {
    expect(old.datasetStamps).toBeUndefined();
    expect(readStampedFigures(old.datasetStamps)).toEqual([]);
    const appendix = savedEvidenceAppendix(old);
    expect(appendix.dataset).toBeNull();
    expect(appendix.facts.length).toBeGreaterThan(0);
    const brief = boardBriefFromAnalysis(old, "analysis-old", { title: "", teamNote: "", includeEvidence: true });
    expect(brief.datasetStamps).toBeUndefined();
    expect(brief.sources?.some((s) => /read live|Snapshot of/.test(s.label))).toBe(false);
  });

  it("drops a damaged stamp rather than repairing it", () => {
    const damaged = { ...old, datasetStamps: [{ label: "Peers", stamp: { ...peerStamp, readAt: "not a time" } }, { label: 7, stamp: peerStamp }] } as unknown as AnalyzeResponse;
    expect(readStampedFigures(damaged.datasetStamps)).toEqual([]);
    expect(savedEvidenceAppendix(damaged).dataset).toBeNull();
  });
});
