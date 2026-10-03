import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { detectFormat, documentTypeForFormat, isLikelyScannedPdf } from "./format";
import { ATTEMPT_OUTCOMES, ATTEMPT_STAGES, classifyFetchFailure, countOutcomes, isPermanentForInput } from "./outcomes";
import { applyAttempt, EMPTY_PLAYBOOK, playbookFromRow, strategyKey, type AttemptFacts, type Playbook } from "./playbook";
import { chooseStrategy, type StrategyCandidate } from "./router";

const NOW = new Date("2026-10-02T12:00:00Z");
const encode = (text: string) => new TextEncoder().encode(text);

function attempt(overrides: Partial<AttemptFacts> = {}): AttemptFacts {
  return {
    stage: "extract",
    strategy: "extract.rules",
    version: 1,
    fingerprint: "hash-a",
    outcome: "ok",
    yieldCount: 20,
    costMicrousd: 0,
    ...overrides,
  };
}

describe("outcomes", () => {
  it("matches the pipeline_attempts CHECK constraints in the migration", () => {
    const read = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
    // The latest definition of the outcome CHECK must list every outcome.
    const latestOutcomeCheck = read("20270103000000_repair_double_encoded_jsonb.sql");
    for (const outcome of ATTEMPT_OUTCOMES) expect(latestOutcomeCheck).toContain(`'${outcome}'`);
    const core = read("20270102020000_learning_core.sql");
    for (const stage of ATTEMPT_STAGES) expect(core).toContain(`'${stage}'`);
  });

  it("classifies HTTP failures and thrown errors into typed outcomes", () => {
    expect(classifyFetchFailure(403)).toBe("http_403");
    expect(classifyFetchFailure(401)).toBe("http_403");
    expect(classifyFetchFailure(404)).toBe("http_404");
    expect(classifyFetchFailure(410)).toBe("http_410");
    expect(classifyFetchFailure(429)).toBe("http_429");
    expect(classifyFetchFailure(503)).toBe("http_5xx");
    expect(classifyFetchFailure(418)).toBe("http_other");
    expect(classifyFetchFailure(null, Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("timeout");
    expect(classifyFetchFailure(null, new Error("getaddrinfo ENOTFOUND bank.example"))).toBe("network_error");
  });

  it("treats only deterministic outcomes as permanent for an input", () => {
    expect(isPermanentForInput("scanned_pdf")).toBe(true);
    expect(isPermanentForInput("no_candidates")).toBe(true);
    expect(isPermanentForInput("timeout")).toBe(false);
    expect(isPermanentForInput("http_5xx")).toBe(false);
    expect(isPermanentForInput("ok")).toBe(false);
  });

  it("counts outcomes for step detail", () => {
    expect(countOutcomes(["ok", "unchanged", "unchanged", null])).toEqual({ ok: 1, unchanged: 2 });
  });
});

describe("detectFormat", () => {
  it("trusts PDF magic bytes over the declared type and URL", () => {
    expect(detectFormat(encode("%PDF-1.7\n..."), "application/octet-stream", "https://b.example/download?id=7")).toBe("pdf");
    expect(detectFormat(encode("\n\n%PDF-1.4"), "text/html", "https://b.example/fees")).toBe("pdf");
  });

  it("recognizes an HTML error page behind a .pdf URL", () => {
    expect(detectFormat(encode("<!DOCTYPE html><html><body>Not found</body></html>"), "application/pdf", "https://b.example/fees.pdf"))
      .toBe("html");
  });

  it("recognizes Word documents and other zips", () => {
    expect(detectFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...encode("word/document.xml")]), null)).toBe("docx");
    expect(detectFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...encode("xl/workbook.xml")]), null)).toBe("other");
    expect(detectFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1]), null)).toBe("docx");
  });

  it("separates plain text from binary", () => {
    expect(detectFormat(encode("Overdraft fee: $35\nWire: $25\n"), "text/plain")).toBe("text");
    expect(detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), "image/png")).toBe("other");
  });

  it("falls back to the declared type when there are no bytes", () => {
    expect(detectFormat(null, "application/pdf")).toBe("pdf");
    expect(detectFormat(null, null, "https://b.example/schedule.pdf?v=2")).toBe("pdf");
    expect(detectFormat(null, "text/html")).toBe("html");
    expect(documentTypeForFormat("other")).toBe("unknown");
  });

  it("flags PDFs with under 200 non-whitespace characters per page as scans", () => {
    expect(isLikelyScannedPdf("", 3)).toBe(true);
    expect(isLikelyScannedPdf("Page 1\nPage 2\nPage 3", 3)).toBe(true);
    expect(isLikelyScannedPdf("x".repeat(600), 3)).toBe(false);
    expect(isLikelyScannedPdf("x".repeat(250), 0)).toBe(false);
  });
});

describe("applyAttempt", () => {
  it("tracks per-strategy stats, the best strategy and the expected fee count", () => {
    let playbook: Playbook = EMPTY_PLAYBOOK;
    for (const yieldCount of [20, 24, 22]) playbook = applyAttempt(playbook, attempt({ yieldCount }), NOW);

    const stats = playbook.strategyStats[strategyKey("extract", "extract.rules", 1)];
    expect(stats).toMatchObject({ attempts: 3, successes: 3, meanYield: 22, recentYields: [20, 24, 22], lastOutcome: "ok" });
    expect(playbook.bestStrategy.extract).toBe("extract.rules");
    expect(playbook.expectedFeeCount).toBe(22);
  });

  it("remembers permanent failures per input, and forgets them on success", () => {
    const failed = applyAttempt(EMPTY_PLAYBOOK, attempt({ stage: "read", strategy: "read.pdf_text", outcome: "scanned_pdf", format: "pdf_scanned" }), NOW);
    expect(failed.doNotRetry).toEqual([
      { stage: "read", strategy: "read.pdf_text", version: 1, fingerprint: "hash-a", outcome: "scanned_pdf", at: NOW.toISOString() },
    ]);
    expect(failed.format).toBe("pdf_scanned");
    expect(failed.bestStrategy.read).toBeUndefined();

    const recovered = applyAttempt(failed, attempt({ stage: "read", strategy: "read.pdf_text", outcome: "ok" }), NOW);
    expect(recovered.doNotRetry).toEqual([]);
    expect(recovered.format).toBe("pdf_scanned");
  });

  it("keeps row-level rejections out of the document memory", () => {
    let playbook = applyAttempt(EMPTY_PLAYBOOK, attempt({ stage: "read", strategy: "read.pdf_text", outcome: "scanned_pdf" }), NOW);
    for (let index = 0; index < 80; index += 1) {
      playbook = applyAttempt(playbook, attempt({ stage: "verify", strategy: "verify.rules", outcome: "rejected", fingerprint: `raw:${index}` }), NOW);
    }
    expect(playbook.doNotRetry).toHaveLength(1);
    expect(playbook.doNotRetry[0]).toMatchObject({ stage: "read", outcome: "scanned_pdf" });
    expect(playbook.strategyStats[strategyKey("verify", "verify.rules", 1)]).toMatchObject({ attempts: 80, successes: 0 });
  });

  it("does not block retries after transient failures", () => {
    const playbook = applyAttempt(EMPTY_PLAYBOOK, attempt({ stage: "fetch", strategy: "fetch.http", outcome: "timeout" }), NOW);
    expect(playbook.doNotRetry).toEqual([]);
  });

  it("does not let unchanged or failed attempts move the expected fee count", () => {
    let playbook = applyAttempt(EMPTY_PLAYBOOK, attempt({ yieldCount: 30 }), NOW);
    playbook = applyAttempt(playbook, attempt({ outcome: "no_candidates", yieldCount: 0, fingerprint: "hash-b" }), NOW);
    expect(playbook.expectedFeeCount).toBe(30);
  });

  it("accumulates cost and caps the do-not-retry list", () => {
    let playbook = EMPTY_PLAYBOOK;
    for (let index = 0; index < 60; index += 1) {
      playbook = applyAttempt(playbook, attempt({ outcome: "no_candidates", fingerprint: `h${index}`, costMicrousd: 10 }), NOW);
    }
    expect(playbook.doNotRetry).toHaveLength(50);
    expect(playbook.doNotRetry[0].fingerprint).toBe("h10");
    expect(playbook.costToDateMicrousd).toBe(600);
  });

  it("reads a profile row, including JSON stored as text", () => {
    expect(playbookFromRow(null)).toEqual(EMPTY_PLAYBOOK);
    const playbook = playbookFromRow({
      format: "html_static",
      best_strategy: '{"read":"read.html_text"}',
      strategy_stats: {},
      do_not_retry: "not json",
      expected_fee_count: "18",
      cost_to_date_microusd: "1200",
    });
    expect(playbook).toMatchObject({
      format: "html_static",
      bestStrategy: { read: "read.html_text" },
      doNotRetry: [],
      expectedFeeCount: 18,
      costToDateMicrousd: 1200,
    });
  });
});

describe("chooseStrategy", () => {
  const free: StrategyCandidate = { strategy: "extract.rules", version: 1, costMicrousd: 0 };
  const template: StrategyCandidate = { strategy: "extract.template", version: 1, costMicrousd: 0, formats: ["html_static"] };
  const paid: StrategyCandidate = { strategy: "extract.llm", version: 1, costMicrousd: 4_000 };
  const ocr: StrategyCandidate = { strategy: "read.ocr_vision", version: 1, costMicrousd: 9_000, formats: ["pdf_scanned"] };
  const pdfText: StrategyCandidate = { strategy: "read.pdf_text", version: 1, costMicrousd: 0, formats: ["pdf_text"] };

  it("never repeats a (strategy, version, input) that already failed", () => {
    const playbook = applyAttempt(EMPTY_PLAYBOOK, attempt({ outcome: "no_candidates" }), NOW);
    expect(chooseStrategy({ stage: "extract", playbook, fingerprint: "hash-a", candidates: [free] })).toMatchObject({
      kind: "skip",
      reason: "known_failure",
    });
    // New content, or a new version of the strategy, earns another attempt.
    expect(chooseStrategy({ stage: "extract", playbook, fingerprint: "hash-b", candidates: [free] })).toMatchObject({ kind: "run" });
    expect(chooseStrategy({ stage: "extract", playbook, fingerprint: "hash-a", candidates: [{ ...free, version: 2 }] }))
      .toMatchObject({ kind: "run", version: 2 });
  });

  it("escalates past a failed free strategy instead of repeating it", () => {
    const playbook = applyAttempt(EMPTY_PLAYBOOK, attempt({ outcome: "no_candidates" }), NOW);
    expect(chooseStrategy({ stage: "extract", playbook, fingerprint: "hash-a", candidates: [free, paid] }))
      .toMatchObject({ kind: "run", strategy: "extract.llm" });
  });

  it("prefers the cheapest strategy that has worked for this institution", () => {
    let playbook = applyAttempt(EMPTY_PLAYBOOK, attempt({ strategy: "extract.llm", costMicrousd: 4_000, fingerprint: "x" }), NOW);
    playbook = applyAttempt(playbook, attempt({ strategy: "extract.template", fingerprint: "y" }), NOW);
    expect(chooseStrategy({ stage: "extract", playbook, fingerprint: "z", candidates: [paid, template] }))
      .toMatchObject({ kind: "run", strategy: "extract.template", reason: expect.stringContaining("worked here") });
  });

  it("does not prefer a strategy that mostly fails here", () => {
    let playbook = applyAttempt(EMPTY_PLAYBOOK, attempt({ fingerprint: "a" }), NOW);
    playbook = applyAttempt(playbook, attempt({ outcome: "no_candidates", fingerprint: "b" }), NOW);
    playbook = applyAttempt(playbook, attempt({ outcome: "no_candidates", fingerprint: "c" }), NOW);
    const decision = chooseStrategy({ stage: "extract", playbook, fingerprint: "d", candidates: [free] });
    expect(decision).toMatchObject({ kind: "run", reason: expect.stringContaining("default") });
  });

  it("uses the learned format as a prior when there is no history", () => {
    const scanned: Playbook = { ...EMPTY_PLAYBOOK, format: "pdf_scanned" };
    expect(chooseStrategy({ stage: "read", playbook: scanned, fingerprint: "h", candidates: [pdfText, ocr] }))
      .toMatchObject({ kind: "run", strategy: "read.ocr_vision", reason: "router: pdf_scanned prior → read.ocr_vision" });
    expect(chooseStrategy({ stage: "read", playbook: EMPTY_PLAYBOOK, fingerprint: "h", candidates: [ocr, pdfText] }))
      .toMatchObject({ kind: "run", strategy: "read.pdf_text" });
  });

  it("skips when no strategy exists for the input", () => {
    expect(chooseStrategy({ stage: "read", playbook: EMPTY_PLAYBOOK, fingerprint: "h", candidates: [] }))
      .toMatchObject({ kind: "skip", reason: "no_strategy" });
  });
});
