// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  diceSimilarity,
  dollarAmounts,
  loadSourceBytes,
  normalisedTokens,
  readSourceBytes,
  readSourceManifest,
  sameDocument,
  similarity,
  SOURCE_BYTES_DIR,
} from "./source-bytes";
import { loadScenarios } from "./scenarios";

const REREAD_TIMEOUT_MS = 120_000;
const ANSWER_KEYS = [
  { label: "state", path: "src/lib/agents/knox/__fixtures__/state-answer-keys.json.gz" },
  { label: "texas", path: "src/lib/agents/knox/__fixtures__/texas-answer-keys.json.gz" },
];

function holdoutIds(): string[] {
  return ANSWER_KEYS.flatMap(({ label, path }) => {
    const { keys } = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as { keys: Array<{ tid: number; set: string }> };
    return keys.filter((key) => key.set === "holdout").map((key) => `${label}:${key.tid}`);
  });
}

describe("source-bytes similarity", () => {
  it("should_score_identical_texts_one_and_disjoint_texts_zero", () => {
    expect(diceSimilarity(["a", "b"], ["b", "a"])).toBe(1);
    expect(diceSimilarity(["a"], ["b"])).toBe(0);
    expect(diceSimilarity([], [])).toBe(1);
  });

  it("should_count_repeated_tokens_as_a_multiset", () => {
    expect(diceSimilarity(["fee", "fee"], ["fee"])).toBeCloseTo(2 / 3);
  });

  it("should_set_aside_layout_and_separators", () => {
    expect(normalisedTokens("Stop Payment | $30.00\nNSF  Fee")).toEqual(["stop", "payment", "30.00", "nsf", "fee"]);
    expect(similarity("Stop Payment | $30.00", "Stop Payment\n$30.00").tokens).toBe(1);
  });

  it("should_reject_a_document_whose_price_changed_even_when_its_words_match", () => {
    const frozen = "Overdraft fee $30.00 per item. Stop payment $25.00. Wire $15.00.";
    const score = similarity(frozen, frozen.replace("$30.00", "$35.00"));
    expect(score.dollarsEqual).toBe(false);
    expect(sameDocument(score)).toBe(false);
    expect(dollarAmounts("$ 1,000.00 and $5")).toEqual(["$1000.00", "$5"]);
  });
});

describe("source-bytes fixtures", () => {
  const manifest = readSourceManifest();

  it("should_account_for_every_holdout_document_once", () => {
    const accepted = manifest.accepted.map((entry) => entry.caseKey.replace(/^missed_fees:/, ""));
    const rejected = manifest.rejected.map((entry) => entry.caseKey.replace(/^missed_fees:/, ""));
    const notFetched = manifest.notFetched.map((entry) => entry.caseKey);
    // A case may have a rejected copy beside its accepted one (a newer schedule), never two accepted.
    expect(new Set(accepted).size).toBe(accepted.length);
    expect(new Set(rejected).size).toBe(rejected.length);
    expect(notFetched.filter((key) => accepted.includes(key) || rejected.includes(key))).toEqual([]);
    const listed = [...new Set([...accepted, ...rejected, ...notFetched])].sort();
    expect(listed).toEqual(holdoutIds().sort());
    expect(manifest.holdoutDocuments).toBe(listed.length);
  });

  it("should_commit_bytes_only_for_accepted_documents", () => {
    const files = readdirSync(join(process.cwd(), SOURCE_BYTES_DIR)).filter((name) => name.endsWith(".gz")).sort();
    expect(files).toEqual(manifest.accepted.map((entry) => entry.file).sort());
  });

  it(
    "should_reread_each_accepted_document_to_its_recorded_similarity",
    async () => {
      const frozen = new Map(loadScenarios().map((c) => [c.caseKey, c.document.text]));
      for (const entry of manifest.accepted) {
        const read = await readSourceBytes(loadSourceBytes(entry), entry.contentType, entry.finalUrl);
        expect(read.ok, entry.caseKey).toBe(true);
        if (!read.ok) continue;
        expect(read.reader, entry.caseKey).toBe(entry.reader);
        const score = similarity(frozen.get(entry.caseKey) ?? "", read.text);
        expect(score, entry.caseKey).toEqual(entry.similarity);
        expect(sameDocument(score), entry.caseKey).toBe(true);
      }
    },
    REREAD_TIMEOUT_MS,
  );

  it("should_record_why_each_rejected_document_is_not_the_frozen_one", () => {
    for (const entry of manifest.rejected) {
      expect(entry.reason, entry.caseKey).toMatch(/^(changed since frozen|not read)/);
      if (entry.similarity) expect(sameDocument(entry.similarity), entry.caseKey).toBe(false);
    }
  });
});
