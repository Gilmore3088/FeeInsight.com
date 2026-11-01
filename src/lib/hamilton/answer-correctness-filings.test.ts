import { describe, expect, it } from "vitest";
import type { FilingRereadKey } from "@/lib/data-store/filing-reread";
import { reconcileWrittenText, supportedFilingClaims, type FilingReader } from "./answer-correctness";
import { filingFactId } from "./claim-evidence";
import { HAMILTON_EVIDENCE_CONTRACT_VERSION, type HamiltonDerivedFact, type HamiltonEvidenceBundle, type HamiltonEvidenceFact, type HamiltonPeriodBasis } from "./evidence-contract";
import { bindNarrative } from "./narrative-bound";
import { buildAskResponse, parseAsk } from "./workspace/ask";
import { overdraftResearch } from "./workspace/test-fixtures";

// Synthetic institutions only: Bank A 9001, Bank B 9002 (evidence-regression-set.ts). No figure here is live data.
const BANK_A = 9001;
const BANK_B = 9002;
const names = new Map([[BANK_A, "Bank A"], [BANK_B, "Bank B"]]);

function filing(institutionId: number, reportDate: string, metric: string, basis: HamiltonPeriodBasis, value: number, source: "fdic" | "ncua" = "fdic"): HamiltonEvidenceFact {
  const id = filingFactId(source, institutionId, reportDate, metric, basis);
  return {
    id, kind: "observed",
    scope: { institutionId, feeCategory: null, product: null, reportingDate: reportDate, effectiveDate: null, accountApplicability: "unknown", metric, periodBasis: basis, cohortKey: null },
    value, unit: "usd", currency: "USD", frequency: null, conditions: null, status: "published",
    source: { label: "Call report", table: "institution_financial_records", recordId: null, recordKey: id, evidenceClass: "filing", sourceDocumentIds: [], urls: [], asOf: reportDate, verificationEventId: null },
  };
}

const bundle = (facts: HamiltonEvidenceFact[], derivations: HamiltonDerivedFact[] = []): HamiltonEvidenceBundle =>
  ({ version: HAMILTON_EVIDENCE_CONTRACT_VERSION, generatedAt: new Date(0).toISOString(), facts, derivations, limitations: [] });

const A_Q2 = filing(BANK_A, "2026-06-30", "service_charge_income", "standalone_quarter", 1_100_000);
const B_Q2 = filing(BANK_B, "2026-06-30", "service_charge_income", "standalone_quarter", 2_300_000);
const A_YTD_Q1 = filing(BANK_A, "2026-03-31", "service_charge_income", "ytd", 1_200_000, "ncua");
const A_YTD_Q2 = filing(BANK_A, "2026-06-30", "service_charge_income", "ytd", 2_600_000, "ncua");
const A_QUARTER: HamiltonDerivedFact = {
  id: `derived:${A_YTD_Q2.id}`, kind: "derived", scope: { ...A_YTD_Q2.scope, periodBasis: "standalone_quarter" },
  value: 1_400_000, unit: "usd", currency: "USD", status: "derived",
  derivation: { kind: "ytd_to_quarter", inputFactIds: [A_YTD_Q2.id, A_YTD_Q1.id], denominatorFactId: null, formula: "current - prior", rounding: "none" },
};

const question = "How does our overdraft fee compare?";
const research = overdraftResearch({ institutionId: BANK_A });
const response = buildAskResponse({ question, intent: parseAsk(question), research, memory: [] });
/** The catalog side says what the research says, so only the filing step can fail. */
const liveCatalog = {
  rows: [
    { institution_id: BANK_A, amount: research.current, fee_category: research.feeCategory },
    ...[...new Map([...research.peers, ...(research.localCompetitors ?? []), ...research.layers.flatMap((l) => l.members)]
      .filter((m) => m.institutionId !== BANK_A).map((m) => [m.institutionId, m.amount])).entries()]
      .map(([institution_id, amount]) => ({ institution_id, amount, fee_category: research.feeCategory })),
  ],
};

/** A fake reader: the live value for each key from `values`, or no row; counts its calls. */
function reader(values: Record<string, number | null>): FilingReader & { calls: FilingRereadKey[][] } {
  const calls: FilingRereadKey[][] = [];
  const read = Object.assign(async (keys: FilingRereadKey[]) => {
    calls.push(keys);
    return new Map(keys.map((k) => [k.id, Object.hasOwn(values, k.id) ? values[k.id] : null]));
  }, { calls });
  return read;
}

async function score(text: string, evidence: HamiltonEvidenceBundle, read: FilingReader) {
  const binding = bindNarrative({ text, evidence, names });
  const claims = supportedFilingClaims(binding, evidence);
  const live = claims.length ? await read(claims.map((c) => c.key)) : null;
  return {
    claims,
    // The tools read the filing (and the profile's quarter), so those figures are other-source money the text may state (`extra`).
    result: reconcileWrittenText({ question, response, research, live: liveCatalog, text,
      extra: [...evidence.facts, ...evidence.derivations].map((f) => Number(f.value)),
      ...(claims.length ? { filings: { claims, live } } : {}) }),
  };
}

describe("a written answer's supported filing claims tie to a live re-read of the filing row (#1077 step 7)", () => {
  const text = "Bank A's service charge income was $1.1 million in Q2 2026.";

  it("passes a supported filing claim whose live row still holds the stated value", async () => {
    const read = reader({ [A_Q2.id]: 1_100_000 });
    const { claims, result } = await score(text, bundle([A_Q2, B_Q2]), read);
    expect(claims.map((c) => c.key)).toEqual([{ id: A_Q2.id, table: "institution_financial_records", source: "fdic", institutionId: BANK_A,
      reportDate: "2026-06-30", metric: "service_charge_income", basis: "standalone_quarter" }]);
    expect(read.calls).toEqual([[claims[0].key]]);
    expect(result).toMatchObject({ checked: true, filings: 1, failures: [] });
  });

  it("fails a supported filing claim whose live value has changed since the answer read it", async () => {
    const { result } = await score(text, bundle([A_Q2, B_Q2]), reader({ [A_Q2.id]: 1_250_000 }));
    expect(result.checked).toBe(true);
    expect(result.failures).toEqual([
      `filing claim "Bank A's service charge income was $1.1 million in Q2 2026.": the answer uses $1,100,000 for service_charge_income for 2026-06-30 (standalone quarter), the live filing has $1,250,000`,
    ]);
  });

  it("fails a supported filing claim whose row is no longer on file", async () => {
    const { result } = await score(text, bundle([A_Q2, B_Q2]), reader({}));
    expect(result.checked).toBe(true);
    expect(result.failures).toEqual([expect.stringMatching(/the live filing has no row for it$/)]);
  });

  it("leaves the answer unchecked when the re-read cannot run, rather than calling it right or wrong", async () => {
    const { result } = await score(text, bundle([A_Q2, B_Q2]), async () => null);
    expect(result).toEqual({ checked: false, figures: 0, failures: [] });
  });

  it("re-reads the input filings of a derived quarter the sentence states", async () => {
    const evidence = bundle([A_YTD_Q1, A_YTD_Q2], [A_QUARTER]);
    const quarterText = "Bank A earned $1.4 million in fee income in Q2 2026.";
    const unchanged = await score(quarterText, evidence, reader({ [A_YTD_Q2.id]: 2_600_000, [A_YTD_Q1.id]: 1_200_000 }));
    expect(unchanged.claims.map((c) => c.key.id)).toEqual([A_YTD_Q2.id, A_YTD_Q1.id]);
    expect(unchanged.result).toMatchObject({ checked: true, filings: 2, failures: [] });
    // The first quarter was refiled: the stated quarter no longer follows from the live rows.
    const refiled = await score(quarterText, evidence, reader({ [A_YTD_Q2.id]: 2_600_000, [A_YTD_Q1.id]: 1_300_000 }));
    expect(refiled.result.failures).toEqual([expect.stringContaining("the live filing has $1,300,000")]);
  });

  it("re-reads nothing for a sentence the binding leaves out or has no filing figure", async () => {
    const evidence = bundle([A_Q2, B_Q2]);
    const read = reader({});
    // Bank B's figure stated as Bank A's: left out, so it is not a supported claim.
    const swapped = await score("Bank A's service charge income was $2.3 million in Q2 2026.", evidence, read);
    expect(swapped.claims).toEqual([]);
    expect(read.calls).toEqual([]);
    expect(swapped.result.filings).toBeUndefined();
    expect(supportedFilingClaims(null, evidence)).toEqual([]);
  });
});
