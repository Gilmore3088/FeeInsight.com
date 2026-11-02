import { describe, expect, it, vi } from "vitest";

/**
 * Gap 9, switched on: the verified recheck's history cohort flags a live jump on its first look and
 * archives it on the second, 12 hours on. The shared second look and the attested attempt log are
 * replaced by in-memory doubles (their own suites cover them); every SQL statement the recheck sends
 * is answered by a stub that checks the recheck's identity stamps, so this exercises the wiring:
 * cohort selection, priors at publish, the history verdict, the second look and the archive.
 */
const secondLookState = vi.hoisted(() => ({ flaggedAt: new Map<number, Date>(), calls: [] as Array<{ failing: number[]; passing: number[] }> }));
vi.mock("@/lib/agents/hamilton/second-look", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/agents/hamilton/second-look")>();
  return {
    ...real,
    secondLook: async (_db: unknown, options: { failing: Array<{ feePublishedId: number }>; passing?: number[]; now?: Date }) => {
      const now = options.now ?? new Date();
      secondLookState.calls.push({ failing: options.failing.map((f) => f.feePublishedId), passing: options.passing ?? [] });
      const confirmed: Array<{ feePublishedId: number }> = [];
      let flagged = 0, waiting = 0;
      for (const fee of options.failing) {
        const at = secondLookState.flaggedAt.get(fee.feePublishedId);
        if (!at) { secondLookState.flaggedAt.set(fee.feePublishedId, now); flagged += 1; }
        else if (now.getTime() - at.getTime() >= real.SECOND_LOOK_MIN_MINUTES * 60_000) confirmed.push(fee);
        else waiting += 1;
      }
      return { confirmed, flagged, waiting, cleared: 0, feedbackIds: [1] };
    },
  };
});
vi.mock("@/lib/agents/learning/attempts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/learning/attempts")>()),
  recordAttestedAttempt: vi.fn(async () => 900),
}));
vi.mock("@/lib/data-store/fee-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/fee-cache")>()),
  invalidatePublicReadCache: vi.fn(() => true),
}));

const { recheckVerifiedFees } = await import("./verified-recheck");
const attempts = await import("@/lib/agents/learning/attempts");

const NEW_TEXT = ["Fee Schedule", "Overdraft fee $15.00", "Stop payment $30.00"].join("\n");
const OLD_TEXT = ["Schedule of Fees", "Effective January 1, 2026", "Overdraft fee $35.00", "Stop payment $30.00"].join("\n");

const liveRow = (selectedFeedback: string | null) => ({
  fee_verified_id: 501, fee_raw_id: 502, review_status: "verified", institution_id: 42, canonical_fee_key: "overdraft",
  verified_amount: 15, amount: 15, fee_name: "Overdraft fee", frequency: "per_item", source_document_id: 70,
  source_url: "https://bank.example/rates-and-fees", document_r2_key: null, extraction_confidence: 0.9, outlier_flags: [],
  conditions: "excerpt=\"Overdraft fee $15.00\"", amount_kind: null, rate_percent: null, fee_published_id: 601,
  selected_verified: "v", selected_raw: "r", selected_published: "p", selected_feedback: selectedFeedback,
});
const priorAtPublish = {
  live_fee_published_id: 601, live_fee_audience: "consumer", live_product_name: null,
  fee_published_id: 9001, institution_id: 42, canonical_fee_key: "overdraft", fee_name: "Overdraft fee", amount: 35,
  frequency: "per_item", fee_audience: "consumer", amount_kind: null, source_url: "https://bank.example/personal/fees",
  document_url: null, source_document_id: 55, product_name: null, published_at: null, rolled_back_reason: "superseded by #601",
};

/** One recheck step's database: `phase` "first" selects the fee through the history cohort, "second" as a due second look. */
function stepDb(phase: "first" | "second", writes: string[]) {
  const answer = (text: string, values: unknown[]): unknown[] => {
    if (text.includes("FROM agent_run_steps s JOIN agent_runs r")) return [{ id: 9 }];
    // The due second looks first: their selection joins the verified row the same way the cohort's does.
    if (text.includes("JOIN published_fee_records p ON p.fee_published_id = f.fee_published_id")) return phase === "second" ? [liveRow("fb1")] : [];
    if (text.includes("JOIN verified_fee_observations v ON v.fee_verified_id = p.lineage_ref")) return phase === "first" ? [liveRow(null)] : [];
    if (text.includes("JOIN published_fee_records q")) return [priorAtPublish];
    if (text.includes("agent_source_texts t JOIN source_documents d")) {
      return [{ id: 1, source_document_id: 70, institution_id: 42, document_institution_id: 42, normalized_text: NEW_TEXT, selected_source: "s", selected_document: "d" }];
    }
    if (text.includes("FROM agent_source_texts") && text.includes("DISTINCT ON")) {
      const ids = (values.find(Array.isArray) as number[] | undefined) ?? [];
      return [{ id: 2, source_document_id: 55, normalized_text: OLD_TEXT }].filter((t) => ids.includes(t.source_document_id));
    }
    if (text.includes("UPDATE published_fee_records p SET rolled_back_at")) { writes.push("archive_published"); return [{ fee_published_id: 601, lineage_ref: 501 }]; }
    if (text.includes("UPDATE verified_fee_observations v SET review_status='rejected'")) { writes.push("reject_verified"); return [{ fee_verified_id: 501, fee_raw_id: 502, review_status: "rejected" }]; }
    if (/^\s*UPDATE\b/.test(text)) { writes.push("other_update"); return []; }
    if (text.includes("FROM published_fee_records p WHERE fee_published_id")) return [{ stamp: "p", lineage_ref: 501, institution_id: 42, rolled_back_at: null, quarantined_at: null }];
    if (text.includes("FROM verified_fee_observations v WHERE fee_verified_id")) return [{ stamp: "v", fee_raw_id: 502, institution_id: 42 }];
    if (text.includes("FROM raw_fee_observations r WHERE fee_raw_id")) return [{ stamp: "r" }];
    if (text.includes("SELECT fee_published_id FROM published_fee_records WHERE lineage_ref")) return [{ fee_published_id: 601 }];
    if (text.includes("FROM pipeline_feedback f WHERE dedupe_key")) return phase === "second" ? [{ stamp: "fb1" }] : [];
    if (text.includes("published_fee_corrections")) return [{ present: false }];
    if (text.includes("FROM source_documents d WHERE id")) return [{ stamp: "d" }];
    if (text.includes("FROM agent_source_texts t WHERE id")) return [{ stamp: "s" }];
    if (text.includes("SELECT EXISTS (SELECT 1 FROM pipeline_attempts")) return [{ present: false }];
    if (text.includes("INSERT INTO agent_run_events")) return [{ id: 77, matches: true }];
    return [];
  };
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join(" ") : String(strings);
    return Promise.resolve(answer(text, values));
  }) as ReturnType<typeof vi.fn> & { unsafe: (query: string) => string; savepoint: (work: (scope: unknown) => Promise<unknown>) => Promise<unknown> };
  db.unsafe = (query: string) => query;
  db.savepoint = (work) => work(db);
  return db;
}

describe("Darwin history check (Gap 9): the live re-check, switched on", () => {
  it("flags a cohort jump on its first look and archives it on the second", async () => {
    const options = { stepId: 9, historyRule: true, olderLive: false, tierRule: false, layoutRule: false, errorFixes: [] };
    const start = new Date("2026-11-02T00:00:00Z");

    const firstWrites: string[] = [];
    const first = await recheckVerifiedFees(stepDb("first", firstWrites) as never, { ...options, runId: 501, now: start });
    expect(first.execution).toMatchObject({ state: "complete", selected: 1, settled: 1, unresolved: 0 });
    expect(first).toMatchObject({ checked: 1, passed: 0, flagged: 1, takenDown: [], historyRuleRead: 1 });
    expect(firstWrites).toEqual([]);
    expect(secondLookState.calls[0]).toEqual({ failing: [601], passing: [] });
    const firstAttempt = vi.mocked(attempts.recordAttestedAttempt).mock.calls[0][1];
    expect(firstAttempt.detail).toMatchObject({
      code: "history_jump", action: "flagged", history_rule: 1,
      history: { outcome: "jump", prior_fee_published_id: 9001, prior_amount: 35, held: true },
    });

    const secondWrites: string[] = [];
    const later = new Date(start.getTime() + 13 * 60 * 60_000);
    const second = await recheckVerifiedFees(stepDb("second", secondWrites) as never, { ...options, runId: 503, now: later });
    expect(second.execution).toMatchObject({ state: "complete", selected: 1, settled: 1, unresolved: 0 });
    expect(second).toMatchObject({ checked: 1, takenDown: [601] });
    expect(secondWrites).toEqual(["archive_published", "reject_verified"]);
    const secondAttempt = vi.mocked(attempts.recordAttestedAttempt).mock.calls[1][1];
    expect(secondAttempt.detail).toMatchObject({ code: "history_jump", action: "taken_down", history_rule: 1 });
  });
});
