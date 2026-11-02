import { describe, expect, it, vi } from "vitest";

import {
  amountRatio,
  comparablePriors,
  DARWIN_HISTORY_CHECK_LIVE,
  HISTORY_JUMP_RATIO,
  HISTORY_RULE_VERSION,
  historyCandidate,
  historyCohortSql,
  historyDetail,
  historyVerdict,
  OTHER_PAGE_STALE_DAYS,
  priorScope,
  priorsFor,
  unitOf,
  unitSql,
  unitsDiffer,
  type HistoryFee,
  type HistoryPrior,
  type PriorCandidateRow,
} from "./history-check";

// The verify integration tests below turn the switch on through this getter; the shipped value is
// read from the real module first.
const historySwitch = vi.hoisted(() => ({ on: false }));
vi.mock("./history-check", async (importOriginal) => {
  const real = await importOriginal<typeof import("./history-check")>();
  return {
    ...real,
    shippedHistorySwitch: real.DARWIN_HISTORY_CHECK_LIVE,
    get DARWIN_HISTORY_CHECK_LIVE() {
      return historySwitch.on;
    },
  };
});

const { runDarwinVerify, darwinStandingDecisionSql } = await import("./verify");
const shipped = (await import("./history-check")) as unknown as { shippedHistorySwitch: boolean };

const OLD_SCHEDULE = ["Schedule of Fees", "Effective January 1, 2026", "Overdraft fee $35.00", "Stop payment $30.00"].join("\n");

function fee(overrides: Partial<HistoryFee> = {}): HistoryFee {
  return {
    feeName: "Overdraft fee",
    amount: 3.5,
    frequency: "per_item",
    sourceDocumentId: 70,
    sourceUrl: "https://bank.example/personal/fees",
    text: ["Fee Schedule", "Overdraft fee $3.50", "Stop payment $30.00"].join("\n"),
    ...overrides,
  };
}

function prior(overrides: Partial<HistoryPrior> = {}): HistoryPrior {
  return {
    feePublishedId: 9001,
    feeName: "Overdraft fee",
    amount: 35,
    frequency: "per_item",
    sourceDocumentId: 55,
    sourceUrl: "https://bank.example/personal/fees",
    ...overrides,
  };
}

const PRIOR_TEXTS = new Map([[55, OLD_SCHEDULE]]);

describe("Darwin history check (Gap 9): pure rule", () => {
  it("ships off, reporting only", () => {
    expect(shipped.shippedHistorySwitch).toBe(false);
    expect(HISTORY_JUMP_RATIO).toBe(1.5);
    expect(HISTORY_RULE_VERSION).toBe(2);
    expect(OTHER_PAGE_STALE_DAYS).toBe(365);
  });

  it("measures a move either way, and $0 against a charge as unbounded", () => {
    expect(amountRatio(30, 30)).toBe(1);
    expect(amountRatio(30, 45)).toBe(1.5);
    expect(amountRatio(45, 30)).toBe(1.5);
    expect(amountRatio(0, 30)).toBe(Number.POSITIVE_INFINITY);
    expect(amountRatio(0, 0)).toBe(1);
  });

  it("maps frequencies to charging units and finds a stated unit change", () => {
    expect(unitOf("per_occurrence")).toBe("item");
    expect(unitOf("per_statement")).toBe("month");
    expect(unitOf(null)).toBeNull();
    expect(unitOf("other")).toBeNull();
    expect(unitsDiffer("monthly", "per_item")).toBe(true);
    expect(unitsDiffer("monthly", null)).toBe(false);
    expect(unitsDiffer("per_transaction", "per_item")).toBe(false);
    expect(() => unitSql("frequency; DROP")).toThrow();
  });

  it("has no prior when the bank has no live value for the fee, or only one on the same document", () => {
    expect(historyVerdict(fee(), [], PRIOR_TEXTS)).toEqual({ outcome: "no_prior", hold: false });
    expect(historyVerdict(fee(), [prior({ sourceDocumentId: 70 })], PRIOR_TEXTS)).toMatchObject({ outcome: "no_prior" });
    expect(comparablePriors(fee(), [prior({ sourceDocumentId: 70 }), prior()])).toHaveLength(1);
  });

  it("passes a fee within the ratio of any prior", () => {
    expect(historyVerdict(fee({ amount: 36 }), [prior()], PRIOR_TEXTS)).toEqual({ outcome: "consistent", hold: false });
    // One prior far off and one close: the close one agrees.
    expect(historyCandidate(fee({ amount: 12 }), [prior(), prior({ feePublishedId: 9002, amount: 10 })])).toEqual({ outcome: "consistent" });
    // The same amount agrees even when the two reads state different units.
    expect(historyCandidate(fee({ amount: 35, frequency: "monthly" }), [prior()])).toEqual({ outcome: "consistent" });
  });

  it("holds a same-page move the bank's copy does not explain (jump): held at verify, review live", () => {
    // The fee's own line names no price; its $3.50 is the neighbouring line's (a misread).
    const verdict = historyVerdict(fee({ text: ["Fee Schedule", "Overdraft fee", "Stop payment $3.50"].join("\n") }), [prior()], PRIOR_TEXTS);
    expect(verdict).toMatchObject({ outcome: "jump", hold: true, takedown: false, scope: "same_page", kind: "amount", ratio: 10, changeHold: "not_confirmed" });
    expect(verdict.prior?.feePublishedId).toBe(9001);
    expect(historyDetail(verdict, false)).toEqual({
      outcome: "jump", would_hold: true, held: false, would_take_down: false, review: true, scope: "same_page",
      prior_fee_published_id: 9001, prior_amount: 35, prior_source_document_id: 55, ratio: 10, kind: "amount", change_hold: "not_confirmed",
    });
    expect(historyDetail(verdict, true)).toMatchObject({ held: true });
  });

  it("keeps the ratio JSON-safe for $0 against a charge", () => {
    const verdict = historyVerdict(fee({ amount: 0, text: ["Fee Schedule", "Overdraft fee", "ATM balance inquiry $0.00"].join("\n") }), [prior()], PRIOR_TEXTS);
    expect(verdict).toMatchObject({ outcome: "jump", hold: true, ratio: null });
  });

  it("never compares a generic name across two accounts' or products' pages (v2)", () => {
    // Nov 2 sample: "Monthly service fee" $20 on the checking page against $2 on the savings page; both real.
    const checking = fee({ feeName: "Monthly service fee", amount: 20, frequency: "monthly", sourceUrl: "https://bank.example/personal-checking-accounts/",
      text: ["Personal Checking", "Monthly service fee $20.00"].join("\n") });
    const savings = prior({ feeName: "Monthly service fee", amount: 2, frequency: "monthly", sourceUrl: "https://bank.example/personal-savings-accounts/" });
    const verdict = historyVerdict(checking, [savings], new Map([[55, ["Personal Savings", "Monthly service fee $2.00"].join("\n")]]));
    expect(verdict).toMatchObject({ outcome: "not_comparable", hold: false });
    expect(verdict.takedown).toBeUndefined();
    expect(priorScope(checking, savings, null)).toBe("other_page");
    // A unit change at a close amount on another page is no move either.
    const unit = historyVerdict(fee({ amount: 5, frequency: "monthly", sourceUrl: "https://bank.example/business/fees", text: "Overdraft fee $5.00 per month" }),
      [prior({ amount: 4 })], new Map([[55, "Overdraft fee $4.00 per item"]]));
    expect(unit).toMatchObject({ outcome: "not_comparable", hold: false });
  });

  it("skips a prior its own text does not print at its amount (a misread prior proves nothing)", () => {
    // Nov 2 sample: Maui County's live "Account Closure" $1.00 was a column slip; its disclosure prints $25.
    expect(historyVerdict(fee({ text: "Overdraft fee" }), [prior()], new Map([[55, "Returned item $35.00"]]))).toMatchObject({ outcome: "not_comparable", hold: false });
    // No stored text for the prior: nothing to compare.
    expect(historyVerdict(fee(), [prior()], new Map())).toMatchObject({ outcome: "not_comparable", hold: false });
  });

  it("drops held priors (a takedown pending, or no longer verified)", () => {
    const row: PriorCandidateRow = {
      fee_published_id: 1, institution_id: 42, canonical_fee_key: "overdraft", fee_name: "Overdraft fee", amount: "35.00",
      frequency: "per_item", fee_audience: "consumer", amount_kind: null, source_url: "https://bank.example/a", document_url: null,
      source_document_id: 55, product_name: null, published_at: null, rolled_back_reason: null,
    };
    const key = { institutionId: 42, canonicalFeeKey: "overdraft", feeAudience: "consumer", productName: null };
    expect(priorsFor(key, [row, { ...row, fee_published_id: 2, held: true }, { ...row, fee_published_id: 3, held: false }]).map((p) => p.feePublishedId)).toEqual([1, 3]);
  });

  it("compares a fee only with priors under the same name (sameFeeName)", () => {
    // Another fee of the category on another page is not an earlier value of this one (the
    // 2026-11-02 sample's wrong holds: "Copy of Statement" $5 against "Xerox copies (per page)" $2).
    const statement = fee({ feeName: "Copy of Statement", amount: 5, text: "Copy of Statement $5.00" });
    expect(historyVerdict(statement, [prior({ feeName: "Xerox copies (per page)", amount: 2 })], new Map())).toEqual({ outcome: "no_prior", hold: false });
    // Case and punctuation do not make another name.
    expect(comparablePriors(fee(), [prior({ feeName: "OVERDRAFT  fee:" })])).toHaveLength(1);
    expect(comparablePriors(fee(), [prior({ feeName: "Overdraft fee (business)" })])).toHaveLength(0);
  });

  it("passes a second line the current copy prints beside the prior (both prices stated)", () => {
    const text = ["Overdrafts", "Overdraft fee $15.00 first item per day", "Overdraft fee $30.00 each additional item"].join("\n");
    const verdict = historyVerdict(
      fee({ amount: 30, text }),
      [prior({ amount: 15 })],
      new Map([[55, ["Overdrafts", "Overdraft fee $15.00 first item per day"].join("\n")]]),
    );
    expect(verdict).toMatchObject({ outcome: "both_stated", hold: false, ratio: 2 });
  });

  it("passes a change the bank made: a newer copy of the same page prints the new price and drops the old", () => {
    const url = "https://bank.example/personal/fees";
    const verdict = historyVerdict(
      fee({ amount: 15, sourceUrl: url, text: ["Schedule of Fees", "Effective July 1, 2026", "Overdraft fee $15.00", "Stop payment $30.00"].join("\n") }),
      [prior({ sourceUrl: url })],
      PRIOR_TEXTS,
    );
    expect(verdict).toMatchObject({ outcome: "change_confirmed", hold: false });
  });

  it("holds a move read from an older edition than the prior's", () => {
    const url = "https://bank.example/personal/fees";
    const verdict = historyVerdict(
      fee({ amount: 15, sourceUrl: url, text: ["Schedule of Fees", "Effective January 1, 2024", "Overdraft fee $15.00"].join("\n") }),
      [prior({ sourceUrl: url })],
      PRIOR_TEXTS,
    );
    expect(verdict).toMatchObject({ outcome: "older_edition", hold: true, takedown: true, scope: "same_page", changeHold: "older_edition" });
  });

  it("retires a stale edition on another page only when it is a year or more older, reading Reviewed/Updated lines", () => {
    // Nov 2 sample: Temple-Inland FCU's fee PDF, "Reviewed: January 1, 2018", against its 2026 disclosure.
    const stale = fee({ feeName: "Temporary Checks (8 checks)", amount: 2, frequency: null, sourceUrl: "https://bank.example/index_htm_files/CUFeesdec2018.pdf",
      text: ["Credit Union Fees", "Temporary Checks (8 checks) $2.00", "Reviewed: January 1, 2018 Federally Insured by NCUA"].join("\n") });
    const current = prior({ feeName: "Temporary Checks (8 checks)", amount: 5, frequency: null, sourceUrl: "https://bank.example/index_htm_files/TRUTH-in-SAVINGS.pdf" });
    const currentText = ["TRUTH-IN-SAVINGS DISCLOSURE", "The rates and terms applicable to your account. | Updated: 1/1/2026", "Temporary Checks (8 checks) $5.00"].join("\n");
    expect(historyVerdict(stale, [current], new Map([[55, currentText]]))).toMatchObject({ outcome: "older_edition", hold: true, takedown: true, scope: "other_page" });
    // Six months apart on two pages: two current pages, not a stale copy.
    const recent = { ...stale, text: stale.text!.replace("January 1, 2018", "July 1, 2025") };
    expect(historyVerdict(recent, [current], new Map([[55, currentText]]))).toMatchObject({ outcome: "not_comparable", hold: false });
  });

  it("sends an unexplained move against the same schedule on another page to review, never a hold", () => {
    const verdict = historyVerdict(
      fee({ sourceUrl: "https://bank.example/personal/schedule-of-charges", text: ["Schedule of Fees", "Effective July 1, 2026", "Overdraft fee", "Stop payment $3.50"].join("\n") }),
      [prior({ sourceUrl: "https://bank.example/personal/fee-schedule" })],
      PRIOR_TEXTS,
    );
    expect(verdict).toMatchObject({ outcome: "review", hold: false, takedown: false, scope: "same_schedule" });
    expect(historyDetail(verdict, true)).toMatchObject({ held: false, would_take_down: false, review: true });
  });

  it("passes MSUFCU's NSF cut to No Charge: a dated whole schedule replaced an undated one in another file (live fee 106085)", () => {
    const newText = ["Schedule of Service Charges", "(effective July 1, 2026)", "This Schedule of Service Charges is part of the Account Agreements and Disclosures.",
      "Account Overdraft Charges", "Non-Sufficient Funds (NSF) | No Charge", "Courtesy Pay Daily Usage2", "Check or ACH | $30.00 per day", "Federally Insured by NCUA | Rev. 7/26"].join("\n");
    const oldText = ["Service Fee Schedule", "Checking Account Fees", "Miscellaneous Fees", "Courtesy Pay1.................. $30.00",
      "Non-Sufficient Funds (NSF)................... $30.00", "Overdraft Notice (Paper)........ $5.00", "by NCUA", "206 | 09/16"].join("\n");
    const verdict = historyVerdict(
      fee({ feeName: "Non-Sufficient Funds (NSF)", amount: 0, frequency: null, sourceUrl: "https://media.msufcu.org/publicsites/publicsite/documents/n3f20bqdze6kt8onqdyq.pdf", text: newText }),
      [prior({ feeName: "Non-Sufficient Funds (NSF)", amount: 30, frequency: null, sourceUrl: "https://media.msufcu.org/publicsites/publicsite/documents/msufcu_feeschedule.pdf" })],
      new Map([[55, oldText]]),
    );
    expect(verdict).toMatchObject({ outcome: "change_confirmed", hold: false, scope: "same_schedule" });
  });

  it("matches priors on institution, category, audience and product, dollar amounts only", () => {
    const row = (overrides: Partial<PriorCandidateRow>): PriorCandidateRow => ({
      fee_published_id: 1, institution_id: 42, canonical_fee_key: "overdraft", fee_name: "Overdraft fee", amount: "35.00",
      frequency: "per_item", fee_audience: "consumer", amount_kind: null, source_url: "https://bank.example/a", document_url: null,
      source_document_id: 55, product_name: null, published_at: null, rolled_back_reason: null, ...overrides,
    });
    const key = { institutionId: 42, canonicalFeeKey: "overdraft", feeAudience: "consumer", productName: null };
    const candidates = [
      row({}),
      row({ fee_published_id: 2, institution_id: 43 }),
      row({ fee_published_id: 3, canonical_fee_key: "nsf" }),
      row({ fee_published_id: 4, fee_audience: "business" }),
      row({ fee_published_id: 5, product_name: "Premier Checking" }),
      row({ fee_published_id: 6, amount_kind: "percent" }),
      row({ fee_published_id: 7, document_url: "https://bank.example/doc.pdf" }),
    ];
    const matched = priorsFor(key, candidates);
    expect(matched.map((p) => p.feePublishedId)).toEqual([1, 7]);
    expect(matched[0]).toEqual({ feePublishedId: 1, feeName: "Overdraft fee", amount: 35, frequency: "per_item", sourceDocumentId: 55, sourceUrl: "https://bank.example/a" });
    expect(matched[1].sourceUrl).toBe("https://bank.example/doc.pdf");
    expect(priorsFor({ ...key, productName: " premier  checking " }, candidates).map((p) => p.feePublishedId)).toEqual([5]);
  });

  it("selects the live cohort on priors at publish from another document that all disagree", () => {
    const cohort = historyCohortSql();
    expect(cohort).toContain("q.published_at < p.published_at");
    expect(cohort).toContain("'superseded by #' || p.fee_published_id::text");
    expect(cohort).toContain("qr.source_document_id IS DISTINCT FROM r.source_document_id");
    expect(cohort).toContain(`< ${HISTORY_JUMP_RATIO}`);
    // The same raw fee name (Knox's, the name verify and the live verdict use), by sameFeeName's normalisation.
    expect(cohort).toContain("btrim(regexp_replace(lower(COALESCE(qr.fee_name, '')), '[^a-z0-9]+', ' ', 'g')) = btrim(regexp_replace(lower(COALESCE(r.fee_name, '')), '[^a-z0-9]+', ' ', 'g'))");
    expect(cohort).not.toContain("q.fee_name");
    // Held priors are no evidence.
    expect(cohort).toContain("qv.review_status IN ('verified', 'approved')");
    expect(cohort).toContain("pf.kind = 'takedown_pending'");
    expect(cohort.split("(").length).toBe(cohort.split(")").length);
  });
});

describe("Darwin history check (Gap 9): in verify", () => {
  const rawFee = {
    fee_raw_id: 811,
    institution_id: 42,
    source_url: "https://bank.example/rates-and-fees",
    document_r2_key: null,
    extraction_confidence: "0.9200",
    fee_name: "Overdraft fee",
    amount: "15.00",
    frequency: "per_item",
    source_document_id: 70,
    fee_audience: "unknown",
    outlier_flags: ["needs_darwin_verification", "canonical_hint:overdraft"],
    conditions: "canonical_hint=overdraft; excerpt=\"Overdraft fee $15.00\"",
  };
  const texts = [
    // Seven months older than the prior's copy: an older edition on one page, not a stale copy across pages.
    { id: 1, source_document_id: 70, normalized_text: ["Fee Schedule", "Effective June 1, 2025", "Overdraft fee $15.00", "Stop payment $30.00"].join("\n") },
    { id: 2, source_document_id: 55, normalized_text: OLD_SCHEDULE },
  ];
  const livePrior: PriorCandidateRow = {
    fee_published_id: 9001, institution_id: 42, canonical_fee_key: "overdraft", fee_name: "Overdraft fee", amount: "35.00",
    // Darwin reads this schedule as consumer (`darwinAudience`), so the prior is a consumer fee too.
    frequency: "per_item", fee_audience: "consumer", amount_kind: null, source_url: "https://bank.example/rates-and-fees",
    document_url: null, source_document_id: 55, product_name: null, published_at: null, rolled_back_reason: null,
  };

  function dbMock(priors: PriorCandidateRow[], options: { failPriorText?: boolean } = {}) {
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.isArray(strings) ? strings.join(" ") : String(strings);
      if (text.includes("FROM agent_source_texts")) {
        const ids = (values[0] as number[] | undefined) ?? [];
        if (options.failPriorText && ids.includes(55)) return Promise.reject(new Error("canceling statement due to statement timeout"));
        return Promise.resolve(texts.filter((t) => ids.includes(t.source_document_id)));
      }
      if (text.includes("FROM published_fee_records fp") && text.includes("fr.product_name")) return Promise.resolve(priors);
      return Promise.resolve([]);
    }) as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn>; savepoint: unknown };
    db.unsafe = vi.fn((query: string) => Promise.resolve(query.includes("FROM raw_fee_observations") ? [rawFee] : []));
    db.savepoint = (work: (scope: unknown) => Promise<unknown>) => work(db);
    return db as unknown as NonNullable<Parameters<typeof runDarwinVerify>[0]["db"]>;
  }

  it("off: verifies the fee and reports the older edition it would hold", async () => {
    historySwitch.on = false;
    const result = await runDarwinVerify({ runId: 7001, dryRun: true, db: dbMock([livePrior]) });
    expect(result.results[0]).toMatchObject({ status: "verified", reasonCode: null });
    expect(result.historyCheck).toEqual({ live: false, compared: 1, outcomes: { older_edition: 1 }, wouldHold: 1, held: 0 });
  });

  it("on: holds the older edition as history_jump for review", async () => {
    historySwitch.on = true;
    try {
      const result = await runDarwinVerify({ runId: 7002, dryRun: true, db: dbMock([livePrior]) });
      expect(result.results[0]).toMatchObject({ status: "skipped", reasonCode: "history_jump", decision: "needs_review" });
      expect(result.results[0].reason).toContain("$15.00 against the live $35.00 (published fee #9001)");
      expect(result.historyCheck).toMatchObject({ live: true, wouldHold: 1, held: 1 });
      expect(result.reasonCounts).toEqual({ history_jump: 1 });
    } finally {
      historySwitch.on = false;
    }
  });

  it("on: verifies a fee whose prior is on another page a few months newer, reporting it for review (v2)", async () => {
    historySwitch.on = true;
    try {
      const result = await runDarwinVerify({ runId: 7006, dryRun: true, db: dbMock([{ ...livePrior, source_url: "https://bank.example/savings" }]) });
      expect(result.results[0]).toMatchObject({ status: "verified", reasonCode: null });
      expect(result.historyCheck).toMatchObject({ compared: 1, outcomes: { review: 1 }, wouldHold: 0, held: 0 });
    } finally {
      historySwitch.on = false;
    }
  });

  it("on: verifies a fee whose prior agrees, and one with no prior", async () => {
    historySwitch.on = true;
    try {
      const agrees = await runDarwinVerify({ runId: 7003, dryRun: true, db: dbMock([{ ...livePrior, amount: "16.00" }]) });
      expect(agrees.results[0]).toMatchObject({ status: "verified" });
      expect(agrees.historyCheck).toMatchObject({ compared: 1, outcomes: { consistent: 1 }, held: 0 });
      const none = await runDarwinVerify({ runId: 7004, dryRun: true, db: dbMock([]) });
      expect(none.results[0]).toMatchObject({ status: "verified" });
      expect(none.historyCheck).toMatchObject({ compared: 0, held: 0 });
    } finally {
      historySwitch.on = false;
    }
  });

  it("a failed prior-text read is recorded on the row and never fails the verify step", async () => {
    for (const on of [false, true]) {
      historySwitch.on = on;
      try {
        const result = await runDarwinVerify({ runId: 7005, dryRun: true, db: dbMock([livePrior], { failPriorText: true }) });
        expect(result.results[0]).toMatchObject({ status: "verified", reasonCode: null, historyError: "canceling statement due to statement timeout" });
        expect(result.historyCheck).toMatchObject({ live: on, compared: 0, wouldHold: 0, held: 0, errors: 1 });
      } finally {
        historySwitch.on = false;
      }
    }
  });

  it("re-reads history holds under an older rule version, and all of them once the switch is off", () => {
    historySwitch.on = true;
    const on = darwinStandingDecisionSql();
    historySwitch.on = false;
    const off = darwinStandingDecisionSql();
    expect(on).toContain("pa.detail->>'reason_code' = 'history_jump'");
    expect(on).toContain(`(pa.detail->>'history_rule_version')::int, 0) < ${HISTORY_RULE_VERSION}`);
    expect(on).toContain("NOT true");
    expect(off).toContain("NOT false");
  });

  it("the shipped switch value matches the module constant", () => {
    expect(DARWIN_HISTORY_CHECK_LIVE).toBe(historySwitch.on);
  });
});

describe("Darwin history check (Gap 9): the live re-check", () => {
  const live = {
    fee_verified_id: 501, fee_raw_id: 502, review_status: "verified", institution_id: 42, canonical_fee_key: "overdraft",
    verified_amount: "15.00", amount: "15.00", fee_name: "Overdraft fee", frequency: "per_item", source_document_id: 70,
    source_url: "https://bank.example/rates-and-fees", document_r2_key: null, extraction_confidence: "0.9", outlier_flags: [],
    conditions: null, amount_kind: null, rate_percent: null, fee_published_id: 601,
    selected_verified: "v", selected_raw: "r", selected_published: "p", selected_feedback: null,
  };
  const priorAtPublish = {
    live_fee_published_id: 601, live_fee_audience: "consumer", live_product_name: null,
    fee_published_id: 9001, institution_id: 42, canonical_fee_key: "overdraft", fee_name: "Overdraft fee", amount: "35.00",
    frequency: "per_item", fee_audience: "consumer", amount_kind: null, source_url: "https://bank.example/rates-and-fees",
    document_url: null, source_document_id: 55, product_name: null, published_at: null, rolled_back_reason: "superseded by #601",
  };
  function recheckDb(newText: string) {
    const texts = [{ id: 1, source_document_id: 70, normalized_text: newText }, { id: 2, source_document_id: 55, normalized_text: OLD_SCHEDULE }];
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = Array.isArray(strings) ? strings.join(" ") : String(strings);
      if (text.includes("FROM agent_source_texts")) {
        const ids = (values.find(Array.isArray) as number[] | undefined) ?? [];
        return Promise.resolve(texts.filter((t) => ids.includes(t.source_document_id)));
      }
      if (text.includes("JOIN published_fee_records q")) return Promise.resolve([priorAtPublish]);
      if (text.includes("JOIN verified_fee_observations v ON v.fee_verified_id = p.lineage_ref")) return Promise.resolve([live]);
      return Promise.resolve([]);
    }) as ReturnType<typeof vi.fn> & { unsafe: (query: string) => string };
    db.unsafe = (query: string) => query;
    return db;
  }

  it("off: reports the live older edition it would flag and writes nothing", async () => {
    const { historyLiveShadow } = await import("./verified-recheck");
    const db = recheckDb(["Fee Schedule", "Effective January 1, 2024", "Overdraft fee $15.00"].join("\n"));
    const shadow = await historyLiveShadow(db as never);
    expect(shadow).toEqual({
      read: 1, outcomes: { older_edition: 1 }, wouldHold: 1,
      samples: [{ feePublishedId: 601, institutionId: 42, canonicalFeeKey: "overdraft", amount: 15, priorFeePublishedId: 9001, priorAmount: 35, ratio: 2.33 }],
    });
    expect(db.mock.calls.some((call) => /\b(INSERT|UPDATE|DELETE)\b/.test((call[0] as string[]).join(" ")))).toBe(false);
  });

  it("off: a live same-page jump is reported for review, never for takedown", async () => {
    const { historyLiveShadow } = await import("./verified-recheck");
    // The new copy prints no price on the fee's own line ($15 is the next line's): no change confirmed.
    const db = recheckDb(["Fee Schedule", "Overdraft fee", "Stop payment $15.00"].join("\n"));
    const shadow = await historyLiveShadow(db as never);
    expect(shadow).toMatchObject({ read: 1, outcomes: { jump: 1 }, wouldHold: 0, wouldReview: 1, samples: [] });
  });

  it("off: a live fee whose current copy still prints the prior is not flagged", async () => {
    const { historyLiveShadow } = await import("./verified-recheck");
    const db = recheckDb(["Fee Schedule", "Overdraft fee $15.00 per item, first three", "Overdraft fee $35.00 per item thereafter"].join("\n"));
    const shadow = await historyLiveShadow(db as never);
    expect(shadow).toMatchObject({ read: 1, wouldHold: 0, outcomes: { both_stated: 1 } });
  });

  it("a failed selection is reported, not thrown", async () => {
    const { historyLiveShadow } = await import("./verified-recheck");
    const db = vi.fn(() => Promise.reject(new Error("boom"))) as ReturnType<typeof vi.fn> & { unsafe: (query: string) => string };
    db.unsafe = (query: string) => query;
    const shadow = await historyLiveShadow(db as never);
    expect(shadow).toMatchObject({ read: 0, wouldHold: 0, error: "boom" });
  });
});
