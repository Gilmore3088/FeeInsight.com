import { describe, expect, it, vi } from "vitest";

import { DARWIN_SCHEDULE_REFILED_FLAG, runDarwinScheduleRefile, SCHEDULE_CONTRADICTS_FLAG } from "./schedule-refile";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const dean = { fee_verified_id: 85900, fee_raw_id: 301481, institution_id: 1836, fee_name: "Returned Check Fee", amount: "7.00" };

function createDbMock() {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = templateText(strings);
    if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
    if (text.includes("SELECT fv.fee_verified_id")) return Promise.resolve([dean]);
    if (text.includes("UPDATE verified_fee_observations")) return Promise.resolve([{ fee_verified_id: values[2] }]);
    return Promise.resolve([]);
  });
}

type RefileDb = Parameters<typeof runDarwinScheduleRefile>[0]["db"];

describe("Darwin schedule re-file", () => {
  it("files a returned check Hamilton took off NSF as a return deposited item, and logs it", async () => {
    const db = createDbMock();

    const result = await runDarwinScheduleRefile({ runId: 4, db: db as unknown as RefileDb });

    expect(result).toEqual({ selected: 1, refiled: 1, dryRun: false });
    const update = db.mock.calls.find(([strings]) => templateText(strings).includes("UPDATE verified_fee_observations"));
    expect(templateText(update?.[0])).toContain("canonical_fee_key = 'deposited_item_return'");
    expect(update?.slice(1)).toEqual([SCHEDULE_CONTRADICTS_FLAG, JSON.stringify([DARWIN_SCHEDULE_REFILED_FLAG]), 85900]);
    const attempt = db.mock.calls.find(([strings]) => templateText(strings).includes("INSERT INTO pipeline_attempts"));
    expect(attempt?.slice(1)).toEqual(expect.arrayContaining(["verify.schedule_refile", "raw:301481", "ok"]));
  });

  it("writes nothing on a dry run", async () => {
    const db = createDbMock();

    const result = await runDarwinScheduleRefile({ runId: 4, db: db as unknown as RefileDb, dryRun: true });

    expect(result).toEqual({ selected: 1, refiled: 0, dryRun: true });
    expect(db.mock.calls.some(([strings]) => templateText(strings).includes("UPDATE"))).toBe(false);
  });
});

describe("schedule re-file flag", () => {
  it("matches the flag Hamilton's category guard leaves", async () => {
    const { categoryGuardFlag } = await import("@/lib/agents/hamilton/publish");
    expect(SCHEDULE_CONTRADICTS_FLAG).toBe(categoryGuardFlag("schedule_contradicts"));
  });
});
