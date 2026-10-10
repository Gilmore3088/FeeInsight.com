import { describe, expect, it } from "vitest";
import { buildFeeAnswer } from "./answer";
import { overdraftResearch } from "./test-fixtures";

describe("canonical research-subject templates", () => {
  it("names figures at their templates and never rewrites institution names, URLs or private facts", () => {
    const evidence = overdraftResearch();
    const sourceUrl = "https://example.test/your-source.pdf";
    const clientFact = { factId: "private1", fieldKey: "client.note", value: "your imported text", givenBy: "Your Analyst", givenAt: "2026-10-06" };
    const research = { ...evidence, subjectName: "Research Bank", institutionName: "Research Bank",
      ownRows: evidence.ownRows.map((row) => ({ ...row, documentUrl: sourceUrl })),
      peers: evidence.peers.map((peer, i) => i === 0 ? { ...peer, institutionName: "Your Savings Bank", amount: 10 } : peer),
      provenance: { ...evidence.provenance, clientFacts: [clientFact] },
    };
    const answer = buildFeeAnswer(research);
    expect(answer.headline).toContain("Research Bank's $32");
    expect(answer.storyline?.keyFigures[0].label).toBe("Research Bank's overdraft fee");
    expect(answer.claims.find((fact) => fact.source.url === sourceUrl)?.source.url).toBe(sourceUrl);
    expect(answer.provenance.clientFacts).toEqual([clientFact]);
    const archetypes = answer.storyline?.exhibits.find((piece) => piece.exhibit.kind === "archetype_map")?.exhibit;
    expect(JSON.stringify(archetypes)).toContain("Your Savings Bank");
    expect(research.peers[0].institutionName).toBe("Your Savings Bank");
    expect(research.provenance.clientFacts[0].value).toBe("your imported text");
  });
});
