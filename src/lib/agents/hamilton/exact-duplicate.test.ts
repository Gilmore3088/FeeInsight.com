import { describe, expect, it, vi } from "vitest";

import {
  collapseCategories,
  collapseKeepOrder,
  collapseLineKey,
  exactDuplicateDecision,
  frequencyClass,
  PUBLISH_REFUSE_DUPLICATES_LIVE,
} from "./exact-duplicate";
import { runHamiltonPublish, type VerifiedFeeRow } from "./publish";

const copy = (id: number, frequency: string | null, fee_audience: string | null, published_at = "2026-10-01T00:00:00.000Z") => ({
  fee_published_id: id,
  frequency,
  fee_audience,
  published_at,
});

describe("exact duplicate check at publish (#1069 step 1)", () => {
  const audiences = ["consumer", "business", "both", "unknown"] as const;
  it("is on: publish refuses a row the collapse would close", () => {
    expect(PUBLISH_REFUSE_DUPLICATES_LIVE).toBe(true);
  });

  it.each(audiences.flatMap((a) => audiences.filter((b) => a !== b).map((b) => [a, b] as const)))(
    "never refuses or replaces %s using a %s copy", (audience, other) => {
      expect(exactDuplicateDecision({ frequency: "monthly", fee_audience: audience }, [copy(9, "monthly", other)]))
        .toEqual({ kind: "none" });
      expect(exactDuplicateDecision({ frequency: "monthly", fee_audience: audience }, [{ ...copy(9, "monthly", other), in_step: true }]))
        .toEqual({ kind: "none" });
    },
  );

  it("normalizes null only to unknown, and excludes held or unrelated copies before frequency decisions", () => {
    expect(exactDuplicateDecision({ frequency: "monthly", fee_audience: null }, [{ ...copy(9, "monthly", "unknown"), in_step: true }]))
      .toEqual({ kind: "refuse", keptFeePublishedId: 9 });
    expect(exactDuplicateDecision({ frequency: "monthly", fee_audience: "consumer" }, [
      copy(8, "annual", "business"), { ...copy(9, "monthly", "consumer"), in_step: true },
      { ...copy(10, "monthly", "consumer"), quarantined_at: new Date() },
    ])).toEqual({ kind: "refuse", keptFeePublishedId: 9 });
    expect(exactDuplicateDecision({ frequency: "monthly", fee_audience: "consumer" }, [
      { ...copy(10, "monthly", "consumer"), quarantined_at: new Date() },
    ])).toEqual({ kind: "none" });
  });

  it("keys step copies by audience and represented variant/rate applicability", () => {
    const base = { institutionId: 42, canonicalFeeKey: "coin_counting", feeName: "Coin Counting", variantType: null,
      amountKind: "percent" as const, amount: null, ratePercent: 5, rateMinAmount: null, rateMaxAmount: null,
      rateBasis: "transaction", feeAudience: "consumer" };
    expect(new Set(audiences.map((audience) => collapseLineKey({ ...base, feeAudience: audience })))).toHaveProperty("size", 4);
    expect(collapseLineKey({ ...base, feeAudience: null })).toBe(collapseLineKey({ ...base, feeAudience: "unknown" }));
    const keys = [base, { ...base, variantType: "premium" }, { ...base, rateBasis: "balance" },
      { ...base, rateMinAmount: 1 }, { ...base, rateMaxAmount: 20 }, { ...base, ratePercent: 6 }].map(collapseLineKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("decides as the exact duplicate collapse would", () => {
    expect(exactDuplicateDecision({ frequency: "per_item", fee_audience: "consumer" }, [])).toEqual({ kind: "none" });
    // The live copy states a frequency the new read leaves blank: the collapse keeps the live one.
    expect(exactDuplicateDecision({ frequency: null, fee_audience: "consumer" }, [copy(10, "monthly", "consumer")])).toEqual({
      kind: "refuse",
      keptFeePublishedId: 10,
    });
    // Unknown applicability is separate from a stated audience, never its duplicate.
    expect(exactDuplicateDecision({ frequency: "per_item", fee_audience: "unknown" }, [copy(11, "per_item", "business")])).toEqual({
      kind: "none",
    });
    // Per item and per occurrence are one frequency; both stated, so the newest (the new row) stays.
    expect(exactDuplicateDecision({ frequency: "per_occurrence", fee_audience: "consumer" }, [copy(12, "per_item", "consumer")])).toEqual({
      kind: "replace",
      closedFeePublishedIds: [12],
    });
    // A stated audience cannot replace an ambiguously scoped live copy.
    expect(exactDuplicateDecision({ frequency: "monthly", fee_audience: "consumer" }, [copy(13, "monthly", "unknown")])).toEqual({
      kind: "none",
    });
    // Stated frequencies that disagree are two fee lines; the collapse closes neither.
    expect(exactDuplicateDecision({ frequency: "monthly", fee_audience: "consumer" }, [copy(14, "per_item", "consumer")])).toEqual({ kind: "none" });
    expect(exactDuplicateDecision({ frequency: null, fee_audience: "consumer" }, [copy(15, "monthly", "consumer"), copy(16, "per_item", "consumer")])).toEqual({ kind: "none" });
    // Within unknown applicability the collapse keeps the stated frequency, then newest.
    expect(
      exactDuplicateDecision({ frequency: null, fee_audience: "unknown" }, [
        copy(17, null, "unknown", "2026-10-03T00:00:00.000Z"),
        copy(18, "monthly", "unknown", "2026-10-02T00:00:00.000Z"),
      ]),
    ).toEqual({ kind: "refuse", keptFeePublishedId: 18 });
    expect(frequencyClass("one_time")).toBe("each");
    expect(frequencyClass("other")).toBeNull();
  });

  it("keeps a copy published earlier in the same step when it ranks as well (Oct 17, step 42289)", () => {
    const inStep = (id: number, frequency: string | null, fee_audience: string | null) => ({ ...copy(id, frequency, fee_audience), in_step: true });
    // Stated audiences are different fees, even when another audience published first.
    expect(exactDuplicateDecision({ frequency: "monthly", fee_audience: "business" }, [inStep(152056, "monthly", "consumer")])).toEqual({
      kind: "none",
    });
    // Unknown is not a wildcard for a consumer copy in this step.
    expect(exactDuplicateDecision({ frequency: "monthly", fee_audience: "consumer" }, [inStep(152032, "monthly", "unknown")])).toEqual({
      kind: "none",
    });
    // Both is explicit applicability of its own, not an exact business duplicate.
    expect(exactDuplicateDecision({ frequency: "per_item", fee_audience: "business" }, [copy(152164, "per_item", "both")])).toEqual({
      kind: "none",
    });
  });

  it("orders each collapse line so the copy the collapse keeps is decided first", () => {
    const rows = [
      { id: 1, line: "a", frequency: "monthly", fee_audience: "consumer" },
      { id: 2, line: "b", frequency: null, fee_audience: "consumer" },
      { id: 3, line: "a", frequency: "monthly", fee_audience: "consumer" },
      { id: 4, line: "a", frequency: "monthly", fee_audience: "consumer" },
    ];
    // Line a: 3 and 4 tie, and 4 would be inserted last, so the collapse keeps 4; then 3; then 1.
    expect(collapseKeepOrder(rows, (row) => row.line).map((row) => row.id)).toEqual([4, 2, 3, 1]);
  });

  it("checks live copies under the category the live split moves a row to (152013 beside 86530)", () => {
    expect(collapseCategories("account_research", "(per occurrence) fee for withdrawals in excess of six per statement cycle")).toEqual([
      "account_research",
      "excess_withdrawal",
    ]);
    expect(collapseCategories("stop_payment", "Stop Payment Fee")).toEqual(["stop_payment"]);
  });

  describe("in the publish step", () => {
    const verified = {
      fee_verified_id: 901,
      fee_raw_id: 701,
      institution_id: 42,
      source_url: "https://testbank.example/fees",
      document_r2_key: null,
      extraction_confidence: "0.9200",
      canonical_fee_key: "stop_payment",
      fee_audience: "consumer" as const,
      variant_type: null,
      outlier_flags: ["agentic_darwin_verified"],
      verified_by_agent_event_id: "00000000-0000-4000-8000-000000000901",
      fee_name: "Stop Payment Fee",
      amount: "30.00",
      frequency: null,
      raw_agent_event_id: "00000000-0000-4000-8000-000000000701",
      source_document_id: 77,
      document_crawled_at: "2026-10-01T00:00:00.000Z",
    };
    function dbWithLiveCopy() {
      const db = vi.fn((strings: TemplateStringsArray) => {
        const text = strings.join(" ");
        if (text.includes("INSERT INTO published_fee_records")) return Promise.resolve([{ fee_published_id: 1301 }]);
        // The live copy states its frequency, so the publish step's own identical check (same
        // frequency) misses it; only the collapse's test finds it.
        if (text.includes("lower(btrim(fp.fee_name))")) return Promise.resolve([copy(555, "per_item", "consumer")]);
        return Promise.resolve([]);
      }) as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
      db.unsafe = vi.fn((query: string) => {
        if (query.includes("institution_fee_depth")) {
          return Promise.resolve(["monthly_maintenance", "nsf", "wire_domestic_outgoing"].map((key) => ({ depth_source: "published", institution_id: 42, canonical_fee_key: key })));
        }
        if (query.includes("FROM verified_fee_observations")) return Promise.resolve([verified]);
        return Promise.resolve([]);
      });
      return db;
    }
    const asDb = (db: ReturnType<typeof dbWithLiveCopy>) => db as unknown as NonNullable<Parameters<typeof runHamiltonPublish>[0]["db"]>;
    const inserts = (db: ReturnType<typeof dbWithLiveCopy>) =>
      db.mock.calls.filter((call) => (call[0] as string[]).join(" ").includes("INSERT INTO published_fee_records")).length;

    it("switched off, publishes the row and counts it as one the collapse would close", async () => {
      const db = dbWithLiveCopy();
      const result = await runHamiltonPublish({ runId: 1069, db: asDb(db), refuseDuplicatesLive: false, refuseSweepRulesLive: false });
      expect(result.publishedFees).toBe(1);
      expect(inserts(db)).toBe(1);
      expect(result.results[0].exactDuplicate).toEqual({ kind: "refuse", keptFeePublishedId: 555 });
      expect(result.duplicateCheck).toMatchObject({ live: false, withLiveCopy: 1, wouldRefuse: 1, refused: 0, wouldReplace: 0 });
      expect(result.duplicateCheck.samples[0]).toMatchObject({ fee_verified_id: 901, fee_published_id: 1301, kept_fee_published_id: 555 });
    });

    it("when turned on, refuses the row before insert", async () => {
      const db = dbWithLiveCopy();
      const result = await runHamiltonPublish({ runId: 1069, db: asDb(db), refuseDuplicatesLive: true });
      expect(result.publishedFees).toBe(0);
      expect(inserts(db)).toBe(0);
      expect(result.results[0]).toMatchObject({ status: "skipped", reason: "Exact duplicate of live fee #555" });
      expect(result.duplicateCheck).toMatchObject({ live: true, wouldRefuse: 1, refused: 1 });
    });

    function dbWithTwinsInStep(first: Partial<VerifiedFeeRow> = {}, second: Partial<VerifiedFeeRow> = {}) {
      let nextId = 2000;
      const twins = [
        { ...verified, fee_verified_id: 911, fee_raw_id: 711, ...first },
        { ...verified, fee_verified_id: 912, fee_raw_id: 712, ...second },
      ];
      const db = vi.fn((strings: TemplateStringsArray) => {
        const text = strings.join(" ");
        if (text.includes("INSERT INTO published_fee_records")) return Promise.resolve([{ fee_published_id: nextId++ }]);
        return Promise.resolve([]);
      }) as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
      db.unsafe = vi.fn((query: string) => {
        if (query.includes("institution_fee_depth")) {
          return Promise.resolve(["monthly_maintenance", "nsf", "wire_domestic_outgoing"].map((key) => ({ depth_source: "published", institution_id: 42, canonical_fee_key: key })));
        }
        if (query.includes("FROM verified_fee_observations")) return Promise.resolve(twins);
        return Promise.resolve([]);
      });
      return db;
    }

    it("publishes one copy of a fee read twice in one step: the one the collapse would keep", async () => {
      const db = dbWithTwinsInStep();
      const result = await runHamiltonPublish({ runId: 1069, db: asDb(db), refuseSweepRulesLive: false });
      expect(result.publishedFees).toBe(1);
      expect(inserts(db)).toBe(1);
      const byId = new Map(result.results.map((row) => [row.feeVerifiedId, row]));
      // Equally scoped copies are decided newest first, even when selected second.
      expect(byId.get(912)).toMatchObject({ status: "published", feePublishedId: 2000 });
      expect(byId.get(911)).toMatchObject({ status: "skipped", reason: "Exact duplicate of live fee #2000" });
    });

    it("a dry run reports the same twin refusal without inserting", async () => {
      const db = dbWithTwinsInStep();
      const result = await runHamiltonPublish({ runId: 1069, db: asDb(db), dryRun: true, refuseSweepRulesLive: false });
      expect(inserts(db)).toBe(0);
      expect(result.publishedFees).toBe(1);
      expect(result.results.find((row) => row.feeVerifiedId === 911)).toMatchObject({ status: "skipped" });
    });

    it.each(audiences.flatMap((a) => audiences.filter((b) => a !== b).map((b) => [a, b] as const)))(
      "publishes both %s and %s in one step and in a dry run", async (first, second) => {
        for (const dryRun of [false, true]) {
          const db = dbWithTwinsInStep({ fee_audience: first }, { fee_audience: second });
          const result = await runHamiltonPublish({ runId: 2131, db: asDb(db), dryRun, refuseSweepRulesLive: false });
          expect(result.publishedFees).toBe(2);
          expect(result.results.map((row) => row.status)).toEqual(["published", "published"]);
          expect(inserts(db)).toBe(dryRun ? 0 : 2);
          expect(result.duplicateCheck.refused).toBe(0);
        }
      },
    );

    it("refuses a true unknown/null twin in the same step without relabeling it", async () => {
      const db = dbWithTwinsInStep({ fee_audience: undefined }, { fee_audience: "unknown" });
      const result = await runHamiltonPublish({ runId: 2131, db: asDb(db), refuseSweepRulesLive: false });
      expect(result.publishedFees).toBe(1);
      expect(inserts(db)).toBe(1);
    });

    it.each(["variant", "frequency", "rate_basis", "rate_floor", "rate_cap"])(
      "keeps distinct %s applicability in the step-copy map", async (dimension) => {
        const rate = { canonical_fee_key: "coin_counting", fee_name: "Coin Counting", amount: null,
          amount_kind: "percent", rate_percent: 5, rate_basis: "transaction" };
        const a: Partial<VerifiedFeeRow> = dimension.startsWith("rate") ? rate : {};
        const b: Partial<VerifiedFeeRow> = { ...a };
        if (dimension === "variant") b.variant_type = "premium";
        if (dimension === "frequency") { a.frequency = "monthly"; b.frequency = "annual"; }
        if (dimension === "rate_basis") b.rate_basis = "balance";
        if (dimension === "rate_floor") b.rate_min_amount = 1;
        if (dimension === "rate_cap") b.rate_max_amount = 20;
        const db = dbWithTwinsInStep(a, b);
        const result = await runHamiltonPublish({ runId: 2131, db: asDb(db), refuseSweepRulesLive: false });
        expect(result.publishedFees).toBe(2);
        expect(inserts(db)).toBe(2);
      },
    );
  });
});
