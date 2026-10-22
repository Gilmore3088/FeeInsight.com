import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { hashText } from "@/lib/agents/rosetta/read";
import { gateKeyFor, type AnswerKeyDocument } from "@/lib/agents/knox/answer-key-gate";
import { W43_HOURLY_LINE_ROWS } from "@/lib/agents/darwin/hourly-frequency-check.fixtures";
import { toCents } from "./rows";
import type { FeeRef, ScenarioId, ShadowCase } from "./types";

/**
 * The six replayed failures, built only from fixtures already committed. Each case keeps where
 * it came from; nothing here is invented. Failures with no committed source text are listed in
 * `NOT_REPLAYABLE` instead of being filled in.
 */

const FIXTURES = {
  adversarial: "src/lib/agents/deming/__fixtures__/adversarial-documents.json",
  hard: "src/lib/agents/deming/__fixtures__/hard-documents.json",
  hourly: "src/lib/agents/darwin/hourly-frequency-check.fixtures.ts",
  texasKeys: "src/lib/agents/knox/__fixtures__/texas-answer-keys.json.gz",
  stateKeys: "src/lib/agents/knox/__fixtures__/state-answer-keys.json.gz",
} as const;

export const FIXTURE_PATHS: readonly string[] = Object.values(FIXTURES);

export const NOT_REPLAYABLE: readonly { issue: string; failure: string; reason: string }[] = [
  { issue: "#1908", failure: "Payroll card disclosure taken as the fee schedule", reason: "no committed source text" },
  { issue: "#1909", failure: "Spanish copies of a schedule counted twice", reason: "no committed source text" },
  { issue: "#1911", failure: "Superseded PDF read instead of the current schedule", reason: "no committed source text" },
  { issue: "#1915", failure: "Schedule that takes effect later read as current", reason: "no committed source text" },
];

/** Adversarial families that are a limit or threshold read as the fee. */
const LIMIT_FAMILIES = new Set(["source_states_limit"]);
const HOURLY_FREQUENCY = "hourly";

interface AdversarialCase {
  case_key: string;
  family: string;
  takedown: string;
  canonical_fee_key: string;
  fee_name: string;
  amount: string;
  text: string;
}

interface HardDocuments {
  same_price: Array<{ case_key: string; family: string; canonical_fee_key: string; amount: string; text: string }>;
  category: Array<{ case_key: string; canonical_fee_key: string; fee_name: string; amount: string; excerpt: string; expected: string }>;
  documents: Array<{ case_key: string; family: string; document_url: string }>;
}

function fee(canonicalFeeKey: string, feeName: string | null, amount: number | string | null, frequency?: string): FeeRef {
  return { canonicalFeeKey, feeName, amountCents: toCents(amount), ...(frequency ? { frequency } : {}) };
}

function shadowCase(
  scenario: ScenarioId,
  fixture: string,
  fixtureCaseKey: string,
  issue: string,
  document: ShadowCase["document"],
  expected: Partial<ShadowCase["expected"]>,
): ShadowCase {
  return {
    caseKey: `${scenario}:${fixtureCaseKey}`,
    scenario,
    provenance: { fixture, fixtureCaseKey, textHash: hashText(document.text ?? document.url ?? ""), issue },
    document,
    expected: { publish: [], forbid: [], ...expected },
    status: "ok",
  };
}

function readJson<T>(root: string, path: string): T {
  const raw = readFileSync(join(root, path));
  return JSON.parse(path.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8")) as T;
}

function adversarialCases(root: string): ShadowCase[] {
  const fixture = readJson<{ cases: AdversarialCase[]; known_misses: AdversarialCase[] }>(root, FIXTURES.adversarial);
  return [...fixture.cases, ...fixture.known_misses].map((item) => {
    const limit = LIMIT_FAMILIES.has(item.family) || item.takedown === "limit_as_fee";
    return shadowCase(
      limit ? "limit_as_fee" : "not_a_fee",
      FIXTURES.adversarial,
      item.case_key,
      `takedown:${item.takedown}/${item.family}`,
      { url: null, text: item.text },
      { forbid: [fee(item.canonical_fee_key, item.fee_name, item.amount)] },
    );
  });
}

function hardDocumentCases(root: string): ShadowCase[] {
  const hard = readJson<HardDocuments>(root, FIXTURES.hard);
  const category = hard.category.map((item) => {
    const ref = fee(item.canonical_fee_key, item.fee_name, item.amount);
    return shadowCase(
      "wrong_category",
      FIXTURES.hard,
      item.case_key,
      `category:${item.expected}`,
      { url: null, text: item.excerpt },
      item.expected === "ok" ? { publish: [ref] } : { forbid: [ref] },
    );
  });
  const duplicates = hard.same_price.map((item) =>
    shadowCase("duplicate_lines", FIXTURES.hard, item.case_key, `same_price:${item.family}`, { url: null, text: item.text }, {
      publishCount: {
        canonicalFeeKey: item.canonical_fee_key,
        amountCents: toCents(item.amount) ?? 0,
        count: item.family === "true_duplicate" ? 1 : 2,
      },
    }),
  );
  const documents = hard.documents.map((item) =>
    shadowCase("wrong_document", FIXTURES.hard, item.case_key, `document:${item.family}`, { url: item.document_url, text: null }, {
      documentIsSchedule: item.family === "fee_schedule",
    }),
  );
  return [...category, ...duplicates, ...documents];
}

function hourlyCases(): ShadowCase[] {
  return W43_HOURLY_LINE_ROWS.filter((row) => row.source_line && row.canonical_fee_key).map((row) =>
    shadowCase("hourly_as_flat", FIXTURES.hourly, `hourly:${row.fee_published_id}`, "#1456", { url: null, text: row.source_line ?? null }, {
      forbid: [fee(row.canonical_fee_key ?? "", row.fee_name, row.amount, `!${HOURLY_FREQUENCY}`)],
    }),
  );
}

function answerKeyCases(root: string): ShadowCase[] {
  const sources = [
    { path: FIXTURES.texasKeys, label: "texas" },
    { path: FIXTURES.stateKeys, label: "state" },
  ];
  return sources.flatMap(({ path, label }) => {
    const { keys } = readJson<{ keys: Array<AnswerKeyDocument & { is_fee_schedule?: boolean }> }>(root, path);
    // Holdout keys only: tuning keys were used while writing the rules.
    return keys
      .filter((doc) => doc.set === "holdout" && doc.is_fee_schedule !== false)
      .map((doc) => {
        const scored = new Set(doc.fees.map((item) => gateKeyFor(item, doc.text)).filter((key): key is string => key != null));
        const publish = [...scored].sort().map((key) => {
          const split = key.lastIndexOf(":");
          return { canonicalFeeKey: key.slice(0, split), feeName: null, amountCents: Number(key.slice(split + 1)) };
        });
        return shadowCase("missed_fees", path, `${label}:${doc.tid}`, "missing fees", { url: null, text: doc.text }, { publish });
      });
  });
}

export function loadScenarios(root: string = process.cwd()): ShadowCase[] {
  return [...adversarialCases(root), ...hardDocumentCases(root), ...hourlyCases(), ...answerKeyCases(root)].sort((a, b) =>
    a.caseKey < b.caseKey ? -1 : a.caseKey > b.caseKey ? 1 : 0,
  );
}

/** The frozen-input manifest: each case's input hash, so a later run replays the same inputs. */
export function freezeManifest(cases: ShadowCase[]): Record<string, string> {
  return Object.fromEntries(cases.map((c) => [c.caseKey, c.provenance.textHash ?? ""]));
}

export function applyManifest(cases: ShadowCase[], manifest: Readonly<Record<string, string>>): ShadowCase[] {
  return cases.map((c) => {
    const frozen = manifest[c.caseKey];
    const actual = hashText(c.document.text ?? c.document.url ?? "");
    if (frozen === undefined) {
      return { ...c, status: "corrupt", statusReason: "not in the frozen-input manifest; refreeze with SHADOW_LAB_FREEZE=1" };
    }
    if (frozen !== actual) return { ...c, status: "corrupt", statusReason: "input differs from the frozen-input manifest" };
    return c;
  });
}
