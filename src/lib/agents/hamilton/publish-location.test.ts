import { describe, expect, it } from "vitest";
import { SOURCE_LOCATION_VERSION } from "@/lib/source-location";
import { PUBLISH_LOCATION_EVENT, publishLocationMessage, recordPublishLocations, summarizePublishLocations } from "./publish-location";
import type { FeeSourceLocationResult } from "@/lib/data-store/source-line-traces";

const located = (page: number | null): FeeSourceLocationResult => ({
  location: { version: SOURCE_LOCATION_VERSION, page, pageLine: page === null ? null : 3, textLine: 9, charStart: 10, charEnd: 40, basis: "excerpt", textId: 5, textSha256: "a".repeat(64) },
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
    expect(check).toEqual({ version: SOURCE_LOCATION_VERSION, checked: 4, located: 2, withPage: 1, misses: { ambiguous: 1, not_found: 1 }, notChecked: 0 });
    expect(publishLocationMessage(check)).toBe("Source location: 2 of 4 published fee(s) found in the bank's fee schedule (1 with a page); not found: 1 ambiguous, 1 not found.");
  });

  it("counts fees left unread at the deadline as not checked, not as not found", () => {
    const results = new Map<number, FeeSourceLocationResult>([[1, located(2)]]);
    const check = summarizePublishLocations(results, 3, true);
    expect(check).toEqual({ version: SOURCE_LOCATION_VERSION, checked: 1, located: 1, withPage: 1, misses: {}, notChecked: 2 });
    expect(publishLocationMessage(check)).toBe("Source location: 1 of 1 published fee(s) found in the bank's fee schedule (1 with a page); 2 not checked, the step's deadline passed.");
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
    expect(check).toMatchObject({ checked: 1, located: 1, withPage: 0, misses: {}, notChecked: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0].slice(0, 4)).toEqual([8, 9, PUBLISH_LOCATION_EVENT, "completed"]);
    const detail = JSON.parse(String(writes[0][5]));
    expect(detail.fees).toEqual([{ fee_published_id: 21, text_id: 31, text_sha256: expect.any(String), char_start: 19, char_end: 45, page: null, page_line: null, text_line: 2, basis: "excerpt" }]);
  });

  it("reports a failed read instead of failing the publish, and records it as a failed event", async () => {
    const writes: unknown[][] = [];
    const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      if (query.includes("INSERT INTO agent_run_events")) { writes.push(values); return Promise.resolve([]); }
      if (query.includes("FROM published_fee_catalog")) return Promise.reject(new Error("canceling statement"));
      return Promise.resolve([]);
    }) as never;
    const check = await recordPublishLocations(db, { runId: 4, stepId: 6, feePublishedIds: [5] });
    expect(check).toMatchObject({ checked: 0, located: 0, notChecked: 1, error: "canceling statement" });
    expect(writes).toHaveLength(1);
    expect(writes[0].slice(0, 4)).toEqual([4, 6, PUBLISH_LOCATION_EVENT, "failed"]);
    expect(String(writes[0][4])).toContain("read failed, 1 published fee(s) not checked: canceling statement");
  });

  it("never throws when the read and the event write both fail", async () => {
    const db = (() => Promise.reject(new Error("canceling statement"))) as never;
    const check = await recordPublishLocations(db, { runId: 1, feePublishedIds: [5] });
    expect(check).toMatchObject({ checked: 0, notChecked: 1, error: "canceling statement" });
  });

  it("reads nothing once the publish step's deadline has passed, and says so", async () => {
    const writes: unknown[][] = [];
    const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      if (query.includes("INSERT INTO agent_run_events")) { writes.push(values); return Promise.resolve([]); }
      if (query.includes("FROM published_fee_catalog") || query.includes("FROM agent_source_texts")) throw new Error("no read expected");
      return Promise.resolve([]);
    }) as never;
    const check = await recordPublishLocations(db, { runId: 8, feePublishedIds: [21, 22], deadlineAt: 100, now: () => 100 });
    expect(check).toMatchObject({ checked: 0, located: 0, notChecked: 2 });
    expect(check?.error).toBeUndefined();
  });
});
