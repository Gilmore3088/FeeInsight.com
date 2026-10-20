import { describe, expect, it, vi } from "vitest";
import { HAND_LINK_REPAIRS, handLinkRepairDetail, runHandLinkRepair, summarizeHandLinkRepair } from "./hand-link-repair";

type Row = Record<string, unknown>;

function mockDb(due: Row[], written: Row[]) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    if (text.includes("UPDATE institution_sources")) return Promise.resolve(written);
    if (text.includes("UPDATE institution_source_profiles")) return Promise.resolve([]);
    return Promise.resolve(due);
  });
  return { db: db as unknown as NonNullable<Parameters<typeof runHandLinkRepair>[0]>["db"], calls };
}

describe("runHandLinkRepair (#2022)", () => {
  it("lists Natbank's own U.S. pages and sets the Canadian ones aside", () => {
    expect(HAND_LINK_REPAIRS.map((entry) => [entry.institutionId, entry.feeUrl, entry.websiteUrl])).toEqual([
      [2675, "https://www.nbc.ca/en/natbank/personal/accounts.html", "https://www.nbc.ca/en/natbank/personal.html"],
    ]);
    const natbank = HAND_LINK_REPAIRS[0];
    expect(natbank.rejectUrls).toContain(natbank.oldFeeUrl);
    expect(natbank.rejectUrls).not.toContain(natbank.feeUrl);
    expect(natbank.rejectUrls.every((url) => !url.includes("/natbank/"))).toBe(true);
  });

  it("writes only while the fee link is still the old one, then updates the profile", async () => {
    const { db, calls } = mockDb([{ id: 2675 }], [{ id: 2675 }]);
    const result = await runHandLinkRepair({ db, now: new Date("2026-10-19T03:00:00Z") });
    expect(result.repaired.map((c) => c.institutionId)).toEqual([2675]);
    const update = calls.find((c) => c.text.includes("UPDATE institution_sources"))!;
    expect(update.text).toContain("btrim(COALESCE(fee_schedule_url, '')) =");
    expect(update.values).toContain("https://www.nbc.ca/business/accounts.html");
    const profile = calls.find((c) => c.text.includes("UPDATE institution_source_profiles"))!;
    expect(profile.text).toContain("locked_by_correction IS TRUE THEN canonical_source_url");
    const added = JSON.parse(profile.values.find((v) => typeof v === "string" && v.startsWith("[")) as string) as Row[];
    expect(added.map((entry) => entry.url)).toEqual(HAND_LINK_REPAIRS[0].rejectUrls);
    expect(summarizeHandLinkRepair(result)).toBe("Atlas pointed 1 of 1 institution(s) at their own fee pages, as checked by hand.");
    expect(handLinkRepairDetail(result)).toMatchObject({ candidates: 1, repaired: 1 });
  });

  it("changes nothing once the link moved, while it changed meanwhile, in a dry run or switched off", async () => {
    const moved = mockDb([], []);
    expect((await runHandLinkRepair({ db: moved.db })).candidates).toEqual([]);
    expect(moved.calls.some((c) => c.text.includes("UPDATE"))).toBe(false);

    const raced = mockDb([{ id: 2675 }], []);
    const racedResult = await runHandLinkRepair({ db: raced.db });
    expect(racedResult.repaired).toEqual([]);
    expect(raced.calls.some((c) => c.text.includes("UPDATE institution_source_profiles"))).toBe(false);

    for (const options of [{ dryRun: true }, { live: false }]) {
      const quiet = mockDb([{ id: 2675 }], [{ id: 2675 }]);
      const result = await runHandLinkRepair({ db: quiet.db, ...options });
      expect(result.candidates).toHaveLength(1);
      expect(result.repaired).toEqual([]);
      expect(quiet.calls.some((c) => c.text.includes("UPDATE"))).toBe(false);
    }
  });
});
