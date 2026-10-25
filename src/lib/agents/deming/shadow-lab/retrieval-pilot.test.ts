// @vitest-environment node
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TUNED_WEIGHTS,
  baselineRanking,
  bm25Corpus,
  pageKey,
  readRetrievalFixture,
  renderRetrievalReport,
  runRetrievalPilot,
  signTestP,
  splitFor,
  tuneWeights,
  type RetrievalCandidate,
} from "./retrieval-pilot";

/**
 * O2 retrieval shadow pilot. Measures on the frozen fixture and never gates on a rate: the pinned
 * numbers below are the measurement of record, so a change to either ranker or the fixture shows
 * up here and in the finding (docs/project/findings/2026-10-25-retrieval-pilot-no-holdout-lift.md).
 * With SHADOW_LAB_OUT set (`npm run test:shadow-lab`) it also writes retrieval-pilot.{json,md}.
 */

const fixture = readRetrievalFixture();
const CANDIDATE_FIELDS = [
  "content_type",
  "copies",
  "crawled_on",
  "document_id",
  "document_kind",
  "dollar_figures",
  "extra_source_role",
  "extra_source_status",
  "fee_link",
  "head_off_topic_cues",
  "head_schedule_cues",
  "head_year",
  "profile_link",
  "stated_date",
  "stated_date_basis",
  "term_counts",
  "text_chars",
  "text_type",
  "url",
];

function candidate(extra: Partial<RetrievalCandidate>): RetrievalCandidate {
  return {
    document_id: 1,
    url: "https://bank.example/page",
    crawled_on: null,
    copies: 1,
    stated_date: null,
    stated_date_basis: null,
    head_year: null,
    content_type: null,
    fee_link: false,
    profile_link: false,
    extra_source_status: null,
    extra_source_role: null,
    text_chars: 0,
    document_kind: null,
    text_type: null,
    term_counts: null,
    head_schedule_cues: 0,
    head_off_topic_cues: 0,
    dollar_figures: 0,
    ...extra,
  };
}

describe("retrieval pilot fixture", () => {
  it("should_keep_every_institution_in_the_split_its_id_hashes_to", () => {
    for (const inst of fixture.institutions) expect(inst.split, String(inst.institution_id)).toBe(splitFor(inst.institution_id));
    expect(fixture.institutions.filter((i) => i.split === "tuning")).toHaveLength(45);
    expect(fixture.institutions.filter((i) => i.split === "holdout")).toHaveLength(42);
    expect(fixture.about.pages).toBe(fixture.institutions.reduce((n, i) => n + i.candidates.length, 0));
  });

  it("should_store_counts_and_metadata_only_never_the_banks_text", () => {
    for (const inst of fixture.institutions) {
      for (const c of inst.candidates) expect(Object.keys(c).sort()).toEqual(CANDIDATE_FIELDS);
    }
  });
});

describe("retrieval pilot rankers", () => {
  it("should_fold_a_pages_spellings_into_one_key", () => {
    expect(pageKey("https://www.Bank.com/Fee%20Schedule/#top")).toBe("bank.com/fee schedule");
    expect(pageKey("http://bank.com/fees?print=1&output=amp")).toBe("bank.com/fees");
    expect(pageKey("https://bank.com/checking?utm_source=a&amp;utm_medium=b")).toBe("bank.com/checking");
    expect(pageKey("https://bank.com/fee_schedule.php?e=350")).toBe("bank.com/fee_schedule.php?e=350");
  });

  it("should_rank_like_today_fee_link_then_profile_then_sources_then_the_rest_newest_first", () => {
    const ranked = baselineRanking([
      candidate({ document_id: 9, url: "https://b.example/other" }),
      candidate({ document_id: 2, url: "https://b.example/companion", extra_source_status: "fetched" }),
      candidate({ document_id: 3, url: "https://b.example/rejected", extra_source_status: "rejected" }),
      candidate({ document_id: 1, url: "https://b.example/link", fee_link: true }),
      candidate({ document_id: 4, url: "https://b.example/profile", profile_link: true }),
      candidate({ document_id: 5, url: "https://b.example/companion2", extra_source_status: "fetched" }),
    ]);
    expect(ranked.map((c) => c.document_id)).toEqual([1, 4, 5, 2, 9, 3]);
  });

  it("should_tune_on_the_tuning_split_only_and_reproduce_the_committed_weights", () => {
    const corpus = bm25Corpus(fixture.institutions, fixture.about.terms.length);
    expect(tuneWeights(fixture.institutions.filter((i) => i.split === "tuning"), corpus)).toEqual(TUNED_WEIGHTS);
    expect(() => tuneWeights(fixture.institutions, corpus)).toThrow(/tuning split only/);
  });

  it("should_compute_the_exact_two_sided_sign_test", () => {
    expect(signTestP(0, 0)).toBe(1);
    expect(signTestP(5, 0)).toBe(0.0625);
    expect(signTestP(6, 0)).toBe(0.03125);
    expect(signTestP(6, 7)).toBe(1);
  });
});

describe("retrieval pilot measurement", () => {
  const result = runRetrievalPilot(fixture);

  it("should_report_the_measured_holdout_numbers", () => {
    const { baseline, metadata, paired } = result.splits.holdout;
    expect(baseline.relevantPages).toBe(53);
    expect(baseline.relevantPagesStored).toBe(51);
    expect([baseline.recallAt3, baseline.recallAt10, baseline.precisionAt1]).toEqual([42 / 53, 51 / 53, 33 / 42]);
    expect([metadata.recallAt3, metadata.recallAt10, metadata.precisionAt1]).toEqual([44 / 53, 51 / 53, 32 / 42]);
    expect([baseline.staleOrWrongAt1, metadata.staleOrWrongAt1]).toEqual([3, 1]);
    expect(baseline.falseNegativesAt3).toEqual({ notStored: [825, 7656], rankedLower: [6741] });
    expect(metadata.falseNegativesAt3).toEqual({ notStored: [825, 7656], rankedLower: [] });
    expect(baseline.falseNegativesAt10).toEqual({ notStored: [825, 7656], rankedLower: [] });
    expect(paired).toEqual({ wins: 6, losses: 7, ties: 29, p: 1 });
    expect(result.verdict).toBe("no_measurable_difference");
  });

  it("should_report_the_tuning_numbers_apart_from_the_holdout", () => {
    const { baseline, metadata } = result.splits.tuning;
    expect([baseline.recallAt3, baseline.precisionAt1, baseline.staleOrWrongAt1]).toEqual([48 / 61, 32 / 45, 7]);
    expect([metadata.recallAt3, metadata.precisionAt1, metadata.staleOrWrongAt1]).toEqual([56 / 61, 35 / 45, 1]);
  });

  it("should_write_the_report_when_the_shadow_lab_runs", () => {
    const report = renderRetrievalReport(result);
    expect(report).toContain("Verdict: no_measurable_difference.");
    const out = process.env.SHADOW_LAB_OUT;
    if (!out) return;
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "retrieval-pilot.json"), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(join(out, "retrieval-pilot.md"), report);
  });
});

describe("retrieval pilot stays out of live selection", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|mjs|js)$/.test(name) ? [path] : [];
    });
  }

  it("should_be_imported_by_nothing_outside_the_shadow_lab", () => {
    const root = process.cwd();
    const importers = files(join(root, "src"))
      .filter((path) => !path.includes(join("deming", "shadow-lab")))
      .filter((path) => /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'][^"']*retrieval-pilot["']/.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));
    expect(importers).toEqual([]);
  });

  it("should_import_no_database_provider_or_network_module", () => {
    const source = readFileSync(join(__dirname, "retrieval-pilot.ts"), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort();
    expect(imports).toEqual(["node:crypto", "node:fs", "node:path"]);
  });
});
