// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractText } from "unpdf";
import { assembleResearchSnapshot } from "./assemble";
import { parseResearchRequest } from "./types";
import { researchExhibits } from "./presentation";
import { renderResearchPdf } from "./pdf";

describe("research PDF artifacts", () => {
  it("renders the same frozen figures, source periods and evidence hash as HTML", async () => {
    const snapshot = assembleResearchSnapshot(parseResearchRequest({ scope: "national", cadence: "quarterly", modules: ["market"] }), {
      capturedAt: "2026-10-26T00:00:00Z", institutions: [], branches: [], footprint: null, audit: [], financials: [], fees: [], areas: [],
      demographics: [{ geo_id: "county:01001", geo_name: "County", year: 2024, total_population: 4242, median_household_income: 100 }],
    });
    const bytes = await renderResearchPdf(snapshot);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
    for (const exhibit of researchExhibits(snapshot)) expect(text).toContain(exhibit.formatted);
    expect(text).toContain("2024"); expect(text.replaceAll(/\s/g, "")).toContain(snapshot.snapshotHash);
  });
});
