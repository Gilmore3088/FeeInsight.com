import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  clock: 0, admissions: 0, attempts: [] as Array<Record<string, unknown>>,
  reviewCount: 26, adjudicate: false, sourceText: "Fee Schedule\nStop Payment $30.00",
  currentText: "Fee Schedule\nStop Payment $30.00", calls: [] as Array<{ operation: string; admissions: number; attempts: number }>,
  stopAt: 0, failureAt: 0, malformedAt: 0, adjudicationSelectionError: false, reviewSettlementError: false,
}));
vi.mock("@/lib/agents/learning/attempts", () => ({
  learningSchemaReady: async () => true,
  recordAttempt: async (_db: unknown, attempt: Record<string, unknown>) => {
    fixture.attempts.push(attempt);
    if (fixture.reviewSettlementError && attempt.strategy === "verify.release_review") throw new Error("synthetic review settlement error");
  },
}));
vi.mock("@/lib/agents/learning/feedback", () => ({ feedbackSchemaReady: async () => false, BUSINESS_SCHEDULE_RESTORED_KIND: "restored" }));
vi.mock("./category-model", () => ({ loadCategoryModel: async () => ({}), DARWIN_CATEGORY_MODEL_STRATEGY: { strategy: "verify.category_model", version: 1 } }));
vi.mock("./verdict-score", () => ({ loadReviewMisses: async () => [], runDarwinVerdictScore: async () => ({ chunks: [], reference: { unbound: 0 } }) }));
vi.mock("./verify", () => ({
  loadSourceTexts: async () => new Map([[20, fixture.sourceText]]),
  rawFeeFingerprint: (id: number) => `raw:${id}`,
  resolvedRawCategory: () => "stop_payment",
}));
vi.mock("./release-held", () => ({
  DARWIN_RELEASE_ACTS: false, DARWIN_RELEASE_STRATEGY: { strategy: "verify.release_held", version: 4 },
  TEMPORARY_RELEASE_HOLDS: new Set(["no_source_text", "no_category_model"]),
  scheduleContext: (text: string) => text,
  releaseCheckHold: () => null,
  releaseVerdict: () => ({ sourceLine: "Stop Payment $30.00" }),
  releaseHeldFee: async () => ({ feeVerifiedId: 99 }),
}));
vi.mock("./international-verification", () => ({ requireInternationalVerification: () => { } }));
vi.mock("./locked-raw-source", () => ({
  withLockedCurrentRawSource: async (_db: unknown, id: number) => {
    fixture.admissions++;
    return {
      kind: "bound", currentRaw: { fee_raw_id: id }, source: {
        documentId: 20, institutionId: 10, artifactId: 30, normalizedText: fixture.currentText,
      }
    };
  }
}));
vi.mock("./verification-audience", () => {
  class VerificationAudienceDeferred extends Error { constructor(readonly reason: string) { super(reason); } }
  return {
    VerificationAudienceDeferred, prepareVerificationAudience: async (_db: unknown, row: Record<string, unknown>) => {
      fixture.admissions++;
      return {
        row, audience: null, ownClause: "none", sourceText: fixture.currentText,
        sourceContext: { kind: "bound", currentRaw: row, source: { documentId: 20, institutionId: 10, artifactId: 30, normalizedText: fixture.currentText } }
      };
    }
  };
});
vi.mock("@/lib/agents/paid-pass", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/agents/paid-pass")>();
  return {
    ...original, paidModelCall: async (options: { operation: string; metadata: { fee_raw_ids: number[] } }) => {
      fixture.calls.push({ operation: options.operation, admissions: fixture.admissions, attempts: fixture.attempts.length });
      fixture.clock += fixture.calls.length === 1 ? 10 : 100;
      if (fixture.stopAt === fixture.calls.length) {
        const error = new Error("synthetic provider budget stop"); error.name = "ProviderBudgetBlockedError"; throw error;
      }
      if (fixture.failureAt === fixture.calls.length) throw new Error("synthetic transport failure");
      return {
        costMicrousd: 2_501, message: {
          content: [{
            type: "text", text: fixture.malformedAt === fixture.calls.length ? "not JSON" : JSON.stringify(options.operation === "release_review"
              ? { verdicts: options.metadata.fee_raw_ids.map(id => ({ id, is_fee: true, category_fits: true, amount_is_price: true })) }
              : { verdicts: options.metadata.fee_raw_ids.map(id => ({ id, is_fee: true, category: "stop_payment" })) })
          }]
        }
      };
    }
  };
});

import { runDarwinReleaseReview } from "./release-review";
import { runDarwinAdjudicate } from "./adjudicate";

const raw = (id: number) => ({
  fee_raw_id: id, institution_id: 10, source_document_id: 20,
  source_url: "https://bank.example/fees", document_r2_key: null, extraction_confidence: null,
  fee_name: "Stop Payment", amount: "30.00", frequency: "per_item", outlier_flags: [], conditions: null
});
const tuple = (id: number) => JSON.stringify([raw(id), { id: 1_000 + id }]);
function dbFixture() {
  const db = Object.assign(vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join(" ");
    if (text.includes("paid_source_snapshot")) return [{
      source_document_id: 20, artifact_id: 30, institution_id: 10,
      normalized_text: fixture.sourceText, document_state: "document", artifact_state: "artifact"
    }];
    if (text.includes("paid_input_state")) return [{ state: tuple(Number(values[3])), document_state: "document", artifact_state: "artifact" }];
    return [];
  }), {
    unsafe: vi.fn(async (text: string) => {
      if (!text.includes("rel.detail->>'verdict' = 'review'") && fixture.adjudicationSelectionError) throw new Error("synthetic adjudication selection error");
      return text.includes("rel.detail->>'verdict' = 'review'") ? Array.from({ length: fixture.reviewCount }, (_, i) => ({
        ...raw(i + 1), institution_name: "Example Bank", state_code: "VT",
        held_reason: "peer_outlier", held_canonical_fee_key: "stop_payment", source_line: "Stop Payment $30.00",
        selected_attempt_id: 1_001 + i, selected_policy_state: tuple(i + 1)
      }))
        : fixture.adjudicate ? [{
          fee_raw_id: 99, institution_id: 10, source_document_id: 20, fee_name: "Stop Payment", amount: "30.00", conditions: null,
          knox_key: "stop_payment", suggested_key: "account_research", suggested_probability: "0.99", decision: "verified",
          selected_attempt_id: 1_099, selected_policy_state: tuple(99)
        }] : [];
    })
  });
  Object.assign(db, { savepoint: (work: (scope: typeof db) => Promise<unknown>) => work(db) });
  return db as unknown as NonNullable<Parameters<typeof runDarwinReleaseReview>[0]["db"]>;
}

beforeEach(() => {
  Object.assign(fixture, {
    clock: 0, admissions: 0, attempts: [], reviewCount: 26, adjudicate: false, calls: [],
    stopAt: 0, failureAt: 0, malformedAt: 0, adjudicationSelectionError: false, reviewSettlementError: false,
    sourceText: "Fee Schedule\nStop Payment $30.00", currentText: "Fee Schedule\nStop Payment $30.00"
  });
  vi.spyOn(Date, "now").mockImplementation(() => fixture.clock);
});
afterEach(() => vi.restoreAllMocks());

describe("paid collection finishes before locked settlement", () => {
  it("does not admit or settle the first review batch before the final provider call", async () => {
    await runDarwinReleaseReview({ db: dbFixture(), runId: 1, calls: 2, acts: false });
    expect(fixture.calls).toEqual([
      { operation: "release_review", admissions: 0, attempts: 0 },
      { operation: "release_review", admissions: 0, attempts: 0 },
    ]);
    expect(fixture.attempts).toHaveLength(26);
  });

  it("collects adjudication before review locks and records each returned duration immediately", async () => {
    fixture.reviewCount = 1;
    fixture.adjudicate = true;
    await runDarwinAdjudicate({ db: dbFixture(), runId: 1, limit: 2, measure: true });
    expect(fixture.calls).toEqual([
      { operation: "release_review", admissions: 0, attempts: 0 },
      { operation: "adjudicate", admissions: 0, attempts: 0 },
    ]);
    expect(fixture.attempts.map(a => [a.strategy, a.durationMs])).toEqual([
      ["verify.release_review", 10], ["verify.adjudicate", 100],
    ]);
  });

  it("does not settle a paid verdict against a different ordinary current source body", async () => {
    fixture.reviewCount = 1;
    fixture.currentText += "\nA new ordinary schedule clause";
    const result = await runDarwinReleaseReview({ db: dbFixture(), runId: 1, calls: 1, acts: false });
    expect(fixture.attempts).toHaveLength(0);
    expect(result.deferred).toBe(1);
    expect(result.costMicrousd).toBe(2_501);
  });

  it("settles the earlier returned batch once after a later provider stop", async () => {
    fixture.stopAt = 2;
    const result = await runDarwinReleaseReview({ db: dbFixture(), runId: 1, calls: 2, acts: false });
    expect(result).toMatchObject({ calls: 1, processed: 25, succeeded: 25, budgetStopped: true, costMicrousd: 2_501 });
    expect(fixture.attempts).toHaveLength(25);
    expect(fixture.attempts.every(attempt => attempt.durationMs === 10 && attempt.costMicrousd === 100)).toBe(true);
    expect(fixture.calls[1]).toMatchObject({ admissions: 0, attempts: 0 });
  });

  it("settles malformed and failed returned work in original batch order", async () => {
    fixture.malformedAt = 1; fixture.failureAt = 2;
    const result = await runDarwinReleaseReview({ db: dbFixture(), runId: 1, calls: 2, acts: false });
    expect(result).toMatchObject({ calls: 2, processed: 26, succeeded: 0, failed: 26, costMicrousd: 2_501 });
    expect(fixture.attempts.slice(0, 25).every(attempt => attempt.outcome === "parse_error" && attempt.durationMs === 10 && attempt.costMicrousd === 100)).toBe(true);
    expect(fixture.attempts[25]).toMatchObject({ outcome: "network_error", durationMs: 100, costMicrousd: 0 });
    expect(fixture.calls.every(call => call.admissions === 0 && call.attempts === 0)).toBe(true);
  });

  it("settles returned review work when later adjudication collection throws", async () => {
    fixture.reviewCount = 1; fixture.adjudicationSelectionError = true;
    await expect(runDarwinAdjudicate({ db: dbFixture(), runId: 1, limit: 2, measure: true })).rejects.toThrow("synthetic adjudication selection error");
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.attempts).toHaveLength(1);
    expect(fixture.attempts[0]).toMatchObject({ strategy: "verify.release_review", durationMs: 10, costMicrousd: 2_501 });
  });

  it("still consumes collected shadow work if review settlement throws", async () => {
    fixture.reviewCount = 1; fixture.adjudicate = true; fixture.reviewSettlementError = true;
    await expect(runDarwinAdjudicate({ db: dbFixture(), runId: 1, limit: 2, measure: true })).rejects.toThrow("synthetic review settlement error");
    expect(fixture.calls.map(call => call.operation)).toEqual(["release_review", "adjudicate"]);
    expect(fixture.attempts.map(attempt => attempt.strategy)).toEqual(["verify.release_review", "verify.adjudicate"]);
  });
});
