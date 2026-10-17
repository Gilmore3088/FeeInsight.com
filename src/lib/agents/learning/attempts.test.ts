import { describe, expect, it } from "vitest";

import { recordAttempt } from "./attempts";

type Call = { text: string; values: unknown[] };

function captureDb() {
  const calls: Call[] = [];
  const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("$?").replace(/\s+/g, " "), values });
    return Promise.resolve([]);
  }) as never;
  return { db, calls };
}

const specialist = {
  institutionId: 7,
  sourceDocumentId: 70,
  stage: "extract",
  strategy: "extract.family.wires",
  version: 3,
  fingerprint: "text-hash",
  outcome: "no_candidates",
  yieldCount: 0,
  costMicrousd: 0,
  foldIntoPlaybook: false,
  detail: { pass: 2, found: 0, added: 0 },
} as const;

describe("recordAttempt (#1808)", () => {
  it("writes a repeat-guarded row only when asked, matched on the whole attempt", async () => {
    const { db, calls } = captureDb();
    await recordAttempt(db, { ...specialist, skipRepeat: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("WHERE NOT EXISTS");
    for (const column of ["input_fingerprint", "strategy", "strategy_version", "stage", "institution_id", "source_document_id", "outcome", "yield_count", "cost_microusd", "detail"]) {
      expect(calls[0].text).toContain(`pa.${column}`);
    }
    expect(calls[0].values).toContain(JSON.stringify(specialist.detail));
  });

  it("keeps the plain insert for every other attempt", async () => {
    const { db, calls } = captureDb();
    await recordAttempt(db, specialist);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("VALUES");
    expect(calls[0].text).not.toContain("NOT EXISTS");
  });
});
