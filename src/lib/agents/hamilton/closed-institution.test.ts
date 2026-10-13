import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));
vi.mock("@/lib/agents/savepoint", () => ({ inSavepoint: (db: unknown, fn: (scope: unknown) => unknown) => fn(db) }));

import { closedInstitutionReason, closedInstitutionSql, retireClosedInstitutionFees } from "./closed-institution";

type Db = Parameters<typeof retireClosedInstitutionFees>[0];
const rows = [
  { fee_published_id: 11, institution_id: 179, institution_name: "Flushing Bank", status: "inactive", closed_date: "2026-06-02" },
  { fee_published_id: 12, institution_id: 179, institution_name: "Flushing Bank", status: "inactive", closed_date: "2026-06-02" },
  { fee_published_id: 21, institution_id: 5248, institution_name: "Mac Federal Credit Union", status: "inactive", closed_date: null },
];

function createDb() {
  const calls: string[] = [];
  const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("UPDATE published_fee_records")) {
      return Promise.resolve((values.find((value) => Array.isArray(value)) as number[]).map((id) => ({ fee_published_id: id })));
    }
    return Promise.resolve([]);
  }) as unknown as Db & { unsafe: ReturnType<typeof vi.fn> };
  const unsafe = vi.fn((text: string) => {
    calls.push(text);
    return Promise.resolve(rows);
  });
  Object.assign(tag, { unsafe });
  return { db: tag as unknown as Db, calls, unsafe };
}

describe("closed institutions keep no live fee (#1200)", () => {
  it("names the state and the closing date in the reason", () => {
    expect(closedInstitutionReason("inactive", "2026-06-02")).toBe("closed_institution: inactive, closed 2026-06-02");
    expect(closedInstitutionReason("inactive", null)).toBe("closed_institution: inactive");
  });

  it("treats inactive or dated institutions as closed, and leaves dormant ones alone", () => {
    expect(closedInstitutionSql("inst")).toBe("(inst.status = 'inactive' OR inst.closed_date IS NOT NULL)");
    expect(closedInstitutionSql("inst")).not.toContain("dormant");
  });

  it("archives each live fee once, logs one event per run with each institution, and deletes nothing", async () => {
    const { db, calls } = createDb();
    const result = await retireClosedInstitutionFees(db, { runId: 7, batchId: "agentic-run-7", dryRun: false });
    expect(result).toMatchObject({ liveFees: 3, institutions: 2 });
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([
      [11, "closed_institution: inactive, closed 2026-06-02"],
      [12, "closed_institution: inactive, closed 2026-06-02"],
      [21, "closed_institution: inactive"],
    ]);
    expect(calls.some((text) => text.includes("rolled_back_at = NOW()"))).toBe(true);
    expect(calls.some((text) => text.includes("hamilton.closed_institution_rolled_back"))).toBe(true);
    expect(calls.some((text) => /DELETE|verified_fee_observations/.test(text))).toBe(false);
  });

  it("writes nothing on a dry run", async () => {
    const { db, calls } = createDb();
    const result = await retireClosedInstitutionFees(db, { runId: 7, batchId: "agentic-run-7", dryRun: true });
    expect(result.rolledBack).toHaveLength(3);
    expect(calls.some((text) => text.includes("UPDATE"))).toBe(false);
  });
});
