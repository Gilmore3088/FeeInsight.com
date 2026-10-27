import { describe, expect, it, vi } from "vitest";

import {
  amountEnvelopesJson,
  inNameAwareEnvelopeSql,
  NAME_ENVELOPES,
  outlierReason,
  outlierRestoreVerdict,
  restoreOutliersNowInRange,
  rollBackPublishedOutliers,
} from "./outlier-rollback";
import { amountEnvelopeFor } from "@/lib/agents/darwin/envelopes";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn(() => Promise.resolve([])) as DbMock;
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db;
}

function asDb(db: DbMock): Parameters<typeof rollBackPublishedOutliers>[0] {
  return db as unknown as Parameters<typeof rollBackPublishedOutliers>[0];
}

const outlier = {
  fee_published_id: 9001,
  institution_id: 42,
  canonical_fee_key: "monthly_maintenance",
  fee_name: "Monthly service charge",
  amount: "1500.00",
};

const tracedCandidate = { ...outlier, source_document_id: 55, normalized_text: "Monthly service charge | $25.00" };

const escheat = {
  fee_published_id: 461,
  institution_id: 200,
  canonical_fee_key: "dormant_account",
  fee_name: "Escheatment Fee",
  amount: "50.00",
  source_document_id: 64,
  normalized_text: "Escheatment Fee | $50.00",
};

describe("Hamilton outlier rollback", () => {
  it("serializes a Darwin range for every canonical key", () => {
    const parsed = JSON.parse(amountEnvelopesJson()) as Record<string, { min: number; max: number }>;
    expect(Object.keys(parsed).length).toBe(new Set(Object.values(CANONICAL_KEY_MAP)).size);
    expect(parsed.monthly_maintenance).toEqual({ min: 1, max: 50 });
  });

  it("leaves escheat processing inside its own range live, as Darwin verifies it", async () => {
    const db = createDbMock([]);
    await rollBackPublishedOutliers(asDb(db), { runId: 1, batchId: "b", dryRun: true });
    const query = String(db.unsafe.mock.calls[0][0]);
    expect(query).toContain("fp.canonical_fee_key = 'dormant_account'");
    expect(query).toContain("fp.fee_name ~* '\\mescheat'");
    expect(query).toContain("fp.amount BETWEEN 1 AND 150");
  });

  it("leaves a box late fee under the rent floor live, as Darwin verifies it (#1912)", async () => {
    const db = createDbMock([]);
    await rollBackPublishedOutliers(asDb(db), { runId: 1, batchId: "b", dryRun: true });
    const query = String(db.unsafe.mock.calls[0][0]);
    expect(query).toContain("fp.canonical_fee_key = 'safe_deposit_box'");
    expect(query).toContain("fp.fee_name ~* '\\mlate\\M'");
    expect(query).toContain("fp.amount BETWEEN 1 AND 1500");
  });

  it("explains which side of the range an amount fell on", () => {
    expect(outlierReason("monthly_maintenance", 1500)).toBe(
      "Amount $1,500 is above the monthly_maintenance range ($1-$50)",
    );
    expect(outlierReason("wire_intl_outgoing", 2)).toContain("below");
  });

  it("rolls back live out-of-range rows with a reason and batch id, and logs a run event", async () => {
    const db = createDbMock([outlier]);

    const rollbacks = await rollBackPublishedOutliers(asDb(db), {
      runId: 111,
      batchId: "agentic-run-111",
      dryRun: false,
    });

    expect(rollbacks).toEqual([
      {
        feePublishedId: 9001,
        institutionId: 42,
        canonicalFeeKey: "monthly_maintenance",
        feeName: "Monthly service charge",
        amount: 1500,
        reason: "Amount $1,500 is above the monthly_maintenance range ($1-$50)",
      },
    ]);
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("UPDATE published_fee_records");
    expect(query).toContain("SET rolled_back_at = NOW()");
    expect(query).toContain("rolled_back_reason = 'amount_outside_category_range'");
    expect(query).toContain("fp.rolled_back_at IS NULL");
    expect(query).toContain("fp.amount > 0");
    expect(params[params.length - 1]).toBe("agentic-run-111");
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton.outliers_rolled_back");
  });

  it("only reads in a dry run", async () => {
    const db = createDbMock([outlier]);

    const rollbacks = await rollBackPublishedOutliers(asDb(db), {
      runId: 112,
      batchId: "agentic-run-112",
      dryRun: true,
    });

    expect(rollbacks).toHaveLength(1);
    expect(String(db.unsafe.mock.calls[0][0])).not.toContain("UPDATE");
    expect(db).not.toHaveBeenCalled();
  });

  it("scopes the sweep to one institution when asked", async () => {
    const db = createDbMock([]);

    await rollBackPublishedOutliers(asDb(db), {
      runId: 113,
      batchId: "agentic-run-113",
      dryRun: false,
      institutionId: 42,
    });

    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("fp.institution_id = $3");
    expect(params[2]).toBe(42);
    expect(params[3]).toBe("agentic-run-113");
    expect(db).not.toHaveBeenCalled();
  });

  it("never fails the publish when the sweep errors", async () => {
    const db = createDbMock([]);
    db.unsafe = vi.fn(() => Promise.reject(new Error("boom")));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      rollBackPublishedOutliers(asDb(db), { runId: 114, batchId: "agentic-run-114", dryRun: false }),
    ).resolves.toEqual([]);
    spy.mockRestore();
  });

  it("restores an earlier outlier takedown now inside its range, never over a live copy", async () => {
    const db = createDbMock([{ ...tracedCandidate, amount: "25.00", normalized_text: "Monthly service charge | $25.00" }]);

    const restores = await restoreOutliersNowInRange(asDb(db), { runId: 8, dryRun: false });

    expect(restores.map((fee) => fee.feePublishedId)).toEqual([9001]);
    // #1912: the candidates are read first, with their source text; only those over the bar are updated.
    const [select, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(select).toContain("rolled_back_at IS NOT NULL");
    expect(select).toContain("NOT EXISTS");
    expect(select).toContain("agent_source_texts");
    // The text is the bank's current copy's: a superseded document is followed to its replacement.
    expect(select).toContain("JOIN source_documents nxt ON nxt.id = chain.superseded_by_id");
    expect(select).toContain("ast.source_document_id = cur.current_document_id");
    expect(params[2]).toBe("amount_outside_category_range");
    const [update, updateParams] = db.unsafe.mock.calls[1] as [string, unknown[]];
    expect(update).toContain("SET rolled_back_at = NULL");
    expect(updateParams).toEqual([[9001], "amount_outside_category_range"]);
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton.outliers_restored");
  });

  it("keeps a takedown down when it has no source text, its name is a cut-in sentence, or its text does not state it (#1912)", async () => {
    const noSource = { ...escheat, fee_published_id: 6459, source_document_id: null, normalized_text: null };
    const noText = { ...escheat, fee_published_id: 6460, normalized_text: null };
    // 13758's shape: a sentence and the next row's name read as one fee name.
    const cutIn = {
      ...escheat,
      fee_published_id: 13758,
      fee_name: "(Assessed in the month an inactive account is processed for escheatment) ACCOUNT RELATED FEES Courtesy Pay Fee‡ ........",
      normalized_text: "Escheatment Fee | $50.00 (Assessed in the month an inactive account is processed for escheatment)\nACCOUNT RELATED FEES\nCourtesy Pay Fee‡ ........ $30.00",
    };
    const otherAmount = { ...escheat, fee_published_id: 461, normalized_text: "Escheatment Fee | $25.00" };
    const traced = { ...escheat, fee_published_id: 13567, fee_name: "Escheat Fee", amount: "100.00", normalized_text: "Inactive Fee (Dormant) $5.00\nEscheat Fee $100.00" };
    const db = createDbMock([noSource, noText, cutIn, otherAmount, traced]);

    const restores = await restoreOutliersNowInRange(asDb(db), { runId: 9, dryRun: true });

    expect(restores.map((fee) => fee.feePublishedId)).toEqual([13567]);
    expect(outlierRestoreVerdict(noSource)).toEqual({ restore: false, reason: "no_source_document" });
    expect(outlierRestoreVerdict(noText)).toEqual({ restore: false, reason: "no_stored_text" });
    expect(outlierRestoreVerdict(cutIn).restore).toBe(false);
    expect(outlierRestoreVerdict(otherAmount)).toMatchObject({ restore: false, reason: expect.stringMatching(/^source_trace:/) });
    expect(outlierRestoreVerdict(traced)).toEqual({ restore: true });
    // A dry run only reads.
    expect(db.unsafe).toHaveBeenCalledTimes(1);
  });

  it("refuses on the restore bar's category step with the stored-text context (#1912)", () => {
    // A box late fee filed as a safe deposit box passes; a night drop late fee does not.
    const box = { canonical_fee_key: "safe_deposit_box", fee_name: "Safe Deposit Box Late Fee", amount: "2.00", source_document_id: 7, normalized_text: "Safe Deposit Box Late Fee $2.00" };
    expect(outlierRestoreVerdict(box)).toEqual({ restore: true });
    const night = { ...box, fee_name: "Night Drop Deposit Box Late Fee", normalized_text: "Night Drop Deposit Box Late Fee $2.00" };
    expect(outlierRestoreVerdict(night)).toMatchObject({ restore: false, reason: expect.stringMatching(/^category_guard:/) });
  });

  it("restores by the fee's name range as the takedown reads it: a box late fee and escheat processing (#1912)", async () => {
    const db = createDbMock([]);
    await restoreOutliersNowInRange(asDb(db), { runId: 8, dryRun: true });
    const restore = String(db.unsafe.mock.calls[0][0]);
    expect(restore).toContain(
      "WHEN fp.canonical_fee_key = 'safe_deposit_box' AND fp.fee_name ~* '\\mlate\\M' THEN fp.amount BETWEEN 1 AND 1500",
    );
    expect(restore).toContain(
      "WHEN fp.canonical_fee_key = 'dormant_account' AND fp.fee_name ~* '\\mescheat' THEN fp.amount BETWEEN 1 AND 150",
    );
    // The category-only bounds are gone: they kept a $1-$4 box late fee down.
    expect(restore).not.toContain("fp.amount >= (env.bounds->>'min')::numeric");

    const takedown = createDbMock([]);
    await rollBackPublishedOutliers(asDb(takedown), { runId: 1, batchId: "b", dryRun: true });
    expect(String(takedown.unsafe.mock.calls[0][0])).toContain(`AND NOT (${inNameAwareEnvelopeSql()})`);
    expect(restore).toContain(`AND (${inNameAwareEnvelopeSql()})`);
  });

  it("reads the same name ranges Darwin does (#1912)", () => {
    const names: Record<string, string> = { dormant_account: "Escheatment Fee", safe_deposit_box: "Safe Deposit Box Late Fee" };
    for (const { key, envelope } of NAME_ENVELOPES) {
      expect(amountEnvelopeFor(key, names[key]), key).toEqual(envelope);
      expect(amountEnvelopeFor(key), key).not.toEqual(envelope);
    }
    expect(outlierReason("safe_deposit_box", 0.5, "Box Late Fee")).toBe("Amount $0.5 is below the safe_deposit_box range ($1-$1,500)");
  });

  it("only reads when restoring in a dry run", async () => {
    const db = createDbMock([{ ...outlier, amount: "25.00" }]);

    await restoreOutliersNowInRange(asDb(db), { runId: 8, dryRun: true });

    expect((db.unsafe.mock.calls[0] as [string])[0]).not.toContain("UPDATE");
    expect(db).not.toHaveBeenCalled();
  });
});
