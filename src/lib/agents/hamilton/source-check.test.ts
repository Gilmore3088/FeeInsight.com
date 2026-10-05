import { describe, expect, it, vi } from "vitest";

import { SOURCE_CHECK_REASON, takeDownUntraceableFees, traceLiveFee, type LiveFeeRow } from "./source-check";

// From Texar FCU's stored fee schedule text.
const TEXAR = [
  "Service | Fee",
  "Cashiers Check | $3",
  "Overdraft Protection Items - Negative $25 or less | $5",
  "Overdraft Protection Items - Negative from $50.01 and more | $35",
  "Overnight Courier Service",
  "$50.00",
  "/Item",
  "Wire Transfer - Incoming",
  "Wire Transfer - Outgoing",
  "$25.00",
  "Notary Service | FREE",
].join("\n");

function fee(id: number, name: string, amount: string | null, source = "knox", documentId: number | null = 7): LiveFeeRow {
  return {
    fee_published_id: id,
    lineage_ref: id + 1000,
    fee_raw_id: id + 2000,
    institution_id: 42,
    source,
    source_document_id: documentId,
    canonical_fee_key: "other",
    fee_name: name,
    amount,
  };
}

const texts = [{ source_document_id: 7, normalized_text: TEXAR }];

describe("traceLiveFee", () => {
  it("takes down a balance threshold published as the fee (Texar $50.01)", () => {
    expect(traceLiveFee(fee(1, "Overdraft Protection Items - Negative from", "50.01"), texts).kind).toBe("untraceable");
  });

  it("keeps the price of a tier, a price under its name and a free service", () => {
    expect(traceLiveFee(fee(2, "Overdraft Protection Items - Negative or less", "5"), texts).kind).toBe("traced");
    expect(traceLiveFee(fee(3, "Overnight Courier Service", "50"), texts).kind).toBe("traced");
    expect(traceLiveFee(fee(4, "Notary Service", "0"), texts).kind).toBe("traced");
  });

  it("never gives a fee the next fee's price", () => {
    expect(traceLiveFee(fee(5, "Wire Transfer - Incoming", "25"), texts).kind).toBe("untraceable");
  });

  it("relinks an imported fee to the stored schedule that states it, but not a Knox fee", () => {
    expect(traceLiveFee(fee(6, "Cashiers Check", "3", "migration_v10", null), texts)).toEqual({ kind: "relinked", sourceDocumentId: 7 });
    expect(traceLiveFee(fee(7, "Cashiers Check", "3", "knox", 8), texts)).toEqual({ kind: "untraceable", reason: "no_source_text" });
  });

  it("takes down a fee with no stored schedule or no amount", () => {
    expect(traceLiveFee(fee(8, "Cashiers Check", "3", "migration_v10", null), [])).toEqual({ kind: "untraceable", reason: "no_source_text" });
    expect(traceLiveFee(fee(9, "Cashiers Check", null), texts)).toEqual({ kind: "untraceable", reason: "no_amount" });
  });
});

describe("takeDownUntraceableFees", () => {
  function createDb(rows: LiveFeeRow[]) {
    const calls: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      calls.push(query);
      if (query.includes("MAX(fp.fee_published_id)")) return Promise.resolve([{ institution_id: 42, max_fee_id: 9 }]);
      if (query.includes("FROM agent_source_texts")) return Promise.resolve(texts.map((text) => ({ ...text, institution_id: 42 })));
      if (query.includes("JOIN raw_fee_observations")) return Promise.resolve(rows);
      return Promise.resolve([]);
    });
    return { db: db as unknown as Parameters<typeof takeDownUntraceableFees>[0], calls };
  }

  it("relinks, takes down and logs the batch", async () => {
    const { db, calls } = createDb([
      fee(1, "Overdraft Protection Items - Negative from", "50.01"),
      fee(2, "Cashiers Check", "3", "migration_v10", null),
      fee(3, "Notary Service", "0"),
    ]);
    const result = await takeDownUntraceableFees(db, { runId: 5, batchId: "agentic-run-5", dryRun: false, stateCode: "TX" });

    expect(result).toMatchObject({ institutionsChecked: 1, liveFeesChecked: 3, traced: 1, relinked: 1 });
    expect(result.takedowns.map((row) => row.feePublishedId)).toEqual([1]);
    expect(calls.some((query) => query.includes("UPDATE raw_fee_observations"))).toBe(true);
    expect(calls.some((query) => query.includes("UPDATE published_fee_records"))).toBe(true);
    expect(calls.some((query) => query.includes("review_status = 'rejected'"))).toBe(true);
    expect(calls.some((query) => query.includes("INSERT INTO pipeline_attempts"))).toBe(true);
    expect(calls.some((query) => query.includes("'hamilton.source_check'"))).toBe(true);
    expect(SOURCE_CHECK_REASON).toBe("source_check_untraceable");
  });

  it("writes nothing on a dry run", async () => {
    const { db, calls } = createDb([fee(1, "Overdraft Protection Items - Negative from", "50.01")]);
    const result = await takeDownUntraceableFees(db, { runId: 5, batchId: "b", dryRun: true, stateCode: "TX" });
    expect(result.takedowns).toHaveLength(1);
    expect(calls.some((query) => query.includes("UPDATE"))).toBe(false);
  });
});
