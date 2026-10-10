import { expect, it } from "vitest";
import { buildLandingReport } from "./landing-report";
import { buildGeographicResearchResult } from "./landing-geographic-research";
import type { LandingResearchHandoff } from "./landing-research-handoff";
const selection: LandingResearchHandoff = { version: 1, task: "board_report", scope: { kind: "state", stateCode: "DC" }, charter: "credit_union", categories: ["money_order", "paper_statement"] };
it("saves a self-contained exact-scope draft in the existing report/PDF schema", () => {
  const research = buildGeographicResearchResult({ ...selection, task: "compare" }, [], []);
  const report = buildLandingReport(selection, research, "2026-10-10");
  expect(report.title).toContain("DC");
  expect(report.exhibits![0].rows).toHaveLength(2);
  expect(report.exhibits![0].rows[0][1]).toBe("Not observed / insufficient evidence");
  expect(report.implementationNotes[0]).toContain(JSON.stringify(selection));
  expect(report.exportControls.pdfEnabled).toBe(true);
  expect(report.sources![0].detail).toContain("Credit unions");
});
