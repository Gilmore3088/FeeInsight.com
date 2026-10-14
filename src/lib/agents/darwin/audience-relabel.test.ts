import { describe, expect, it, vi } from "vitest";

import { AUDIENCE_RELABEL_MODE, decideAudience, runAudienceRelabel, type AudienceRelabelRow } from "./audience-relabel";

const row = (overrides: Partial<AudienceRelabelRow> = {}): AudienceRelabelRow => ({
  fee_verified_id: 501, fee_raw_id: 401, institution_id: 7, source_document_id: 21, source_url: "https://example.coop/fees",
  fee_name: "Stop Payment", amount: "30.00", amount_kind: "flat", canonical_fee_key: "stop_payment", audience_evidence: null,
  fee_published_ids: [601], ...overrides,
});
const consumerSchedule = "Fee Schedule\nStop Payment | $30.00\nNSF Fee | $32.00";

function createDb(rows: AudienceRelabelRow[], feedback: unknown[] = []) {
  let served = false;
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    if (text.includes("pg_get_functiondef")) return Promise.resolve([{ ready: true }]);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("WITH live AS")) {
      if (served) return Promise.resolve([]);
      served = true;
      return Promise.resolve(rows);
    }
    if (text.includes("FROM agent_source_texts")) return Promise.resolve([{ source_document_id: 21, normalized_text: consumerSchedule }]);
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(feedback);
    if (text.includes("UPDATE verified_fee_observations")) return Promise.resolve([{ fee_verified_id: 501 }]);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: 601 }]);
    if (text.includes("INSERT INTO pipeline_feedback")) return Promise.resolve([{ id: 1 }]);
    return Promise.resolve([]);
  });
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map(([strings]) => strings.join(" ")).filter((text) => /UPDATE|INSERT/.test(text));

describe("Darwin audience relabel (#1059)", () => {
  it.each([
    [row({ source_url: "https://umassfive.coop/business-fees" }), consumerSchedule, "business", "document_url"],
    [row(), consumerSchedule, "consumer", "default_general_schedule"],
    [row(), null, "unknown", "no_text"],
  ])("decides from the document like a new verification (%#)", (candidate, text, audience, source) => {
    expect(decideAudience(candidate, text)).toMatchObject({ feeAudience: audience, source });
  });

  it("is off: a dry run counts by audience and source and writes nothing", async () => {
    expect(AUDIENCE_RELABEL_MODE).toBe("off");
    const db = createDb([row(), row({ fee_verified_id: 502, source_document_id: 99 })]);
    const result = await runAudienceRelabel(db as never, {});
    expect(result).toMatchObject({ dryRun: true, fees: 2, byAudience: { consumer: 1, unknown: 1 }, bySource: { default_general_schedule: 1, no_text: 1 }, relabeled: 0 });
    expect(writes(db)).toEqual([]);
  });

  it("live: records the old value before writing, then updates the live row", async () => {
    const db = createDb([row()]);
    const result = await runAudienceRelabel(db as never, { mode: "live", runId: 9 });
    expect(result).toMatchObject({ dryRun: false, relabeled: 1, publishedTouched: 1 });
    const order = writes(db).map((text) => (text.includes("pipeline_feedback") ? "record" : text.includes("verified") ? "verified" : "published"));
    expect(order).toEqual(["record", "verified", "published"]);
  });

  it("rollback: restores the old evidence so the trigger restores the old audience", async () => {
    const db = createDb([], [{ fee_verified_id: 501, from_evidence: null, to_evidence: "darwin:default_general_schedule: x", fee_published_ids: [601] }]);
    const result = await runAudienceRelabel(db as never, { mode: "rollback" });
    expect(result).toMatchObject({ restored: 1, publishedTouched: 1 });
  });
});
