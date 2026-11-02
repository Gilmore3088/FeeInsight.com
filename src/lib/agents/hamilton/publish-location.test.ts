import { describe, expect, it } from "vitest";
import { PUBLISH_LOCATION_EVENT, publishLocationMessage, recordPublishLocations, summarizePublishLocations } from "./publish-location";
import type { FeeSourceLocationResult } from "@/lib/data-store/source-line-traces";

const located = (page: number | null): FeeSourceLocationResult => ({
  location: { version: 1, page, pageLine: page === null ? null : 3, textLine: 9, charStart: 10, charEnd: 40, basis: "excerpt", textId: 5, textSha256: "a".repeat(64) },
  miss: null,
});

describe("summarizePublishLocations", () => {
  it("counts found fees, pages and each reason a fee was not found", () => {
    const results = new Map<number, FeeSourceLocationResult>([
      [1, located(2)],
      [2, located(null)],
      [3, { location: null, miss: "ambiguous" }],
    ]);
    const check = summarizePublishLocations(results, 4);
    expect(check).toEqual({ version: 1, checked: 4, located: 2, withPage: 1, misses: { ambiguous: 1, not_found: 1 } });
    expect(publishLocationMessage(check)).toBe("Source location: 2 of 4 published fee(s) found in their stored schedule (1 with a page); not found: 1 ambiguous, 1 not found.");
  });
});

describe("recordPublishLocations", () => {
  it("records nothing when the step published nothing", async () => {
    const db = (() => { throw new Error("no query expected"); }) as never;
    expect(await recordPublishLocations(db, { runId: 1, feePublishedIds: [] })).toBeNull();
  });

  it("writes one run event with each fee's place, and never throws", async () => {
    const TEXT = "First Example Bank\nMoney Order ........ $5.00";
    const writes: unknown[][] = [];
    const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      if (query.includes("FROM published_fee_catalog")) {
        return Promise.resolve([{ id: 21, institution_id: 3, source_document_id: 30, amount: "5.00", fee_name: "Money Order", extraction_note: 'excerpt="Money Order ........ $5.00"', conditions: null, trace: null }]);
      }
      if (query.includes("FROM agent_source_texts")) return Promise.resolve([{ id: 31, institution_id: 3, source_document_id: 30, normalized_text: TEXT, text_hash: null }]);
      if (query.includes("INSERT INTO agent_run_events")) { writes.push(values); return Promise.resolve([]); }
      return Promise.resolve([]);
    }) as never;
    const check = await recordPublishLocations(db, { runId: 8, stepId: 9, feePublishedIds: [21, 21] });
    expect(check).toMatchObject({ checked: 1, located: 1, withPage: 0, misses: {} });
    expect(writes).toHaveLength(1);
    expect(writes[0].slice(0, 3)).toEqual([8, 9, PUBLISH_LOCATION_EVENT]);
    const detail = JSON.parse(String(writes[0][4]));
    expect(detail.fees).toEqual([{ fee_published_id: 21, text_id: 31, text_sha256: expect.any(String), char_start: 19, char_end: 45, page: null, page_line: null, text_line: 2, basis: "excerpt" }]);
  });

  it("reports a failed read instead of failing the publish", async () => {
    const db = (() => Promise.reject(new Error("canceling statement"))) as never;
    const check = await recordPublishLocations(db, { runId: 1, feePublishedIds: [5] });
    expect(check).toMatchObject({ checked: 1, located: 0, error: "canceling statement" });
  });
});
