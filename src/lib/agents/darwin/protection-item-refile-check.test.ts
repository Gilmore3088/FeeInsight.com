// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { notAdminCorrectedSql } from "@/lib/fee-correction-guard";

// The second look confirms every failing fee at once, so the live path reaches its UPDATE.
vi.mock("@/lib/agents/hamilton/second-look", () => ({
  secondLook: async (_db: unknown, options: { failing: unknown[] }) => ({ flagged: 0, waiting: 0, confirmed: options.failing }),
}));
vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: () => undefined }));
import {
  findProtectionItems,
  PROTECTION_ITEM_REFILE_LIVE,
  protectionItemVerdict,
  recheckProtectionItems,
  type ProtectionItemRow,
} from "./protection-item-refile-check";

// Live bare "Overdraft Protection" fees filed as the overdraft protection transfer, with their source
// documents' latest stored text, prod read-only 2026-11-01: the five the dry run re-files and two it
// keeps (110527 and 150857, whose schedules print their paid-overdraft fee on another line).
// [fee_published_id, fee_verified_id, institution_id, fee_name, amount, source_document_id, text].
const fixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/protection-item-live-2026-11-01.json", import.meta.url), "utf8"),
) as Array<[number, number, number, string, number, number, string]>;
const row = ([id, verified, institution, name, amount, , text]: (typeof fixture)[number]): ProtectionItemRow => ({
  fee_published_id: id,
  fee_verified_id: verified,
  institution_id: institution,
  fee_name: name,
  amount,
  canonical_fee_key: "od_protection_transfer",
  source_text: text,
});
const rows = fixture.map(row);

describe("Darwin's live re-file of bare protection lines that are the overdraft item fee (Knox v150)", () => {
  it("ships with its switch off", () => {
    expect(PROTECTION_ITEM_REFILE_LIVE).toBe(false);
  });

  it("re-files the five whose schedule prints its own transfer line and no other overdraft fee", () => {
    const found = findProtectionItems(rows);
    expect(found.checked).toBe(7);
    expect(found.outcomes).toEqual({ refile: 5, still_transfer: 2 });
    expect(found.institutions).toBe(5);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.amount])).toEqual([
      [94582, 30],
      [95703, 29.5],
      [112157, 14],
      [131024, 25],
      [140406, 30],
    ]);
  });

  it("keeps a bare protection line as the transfer where the schedule prints its overdraft fee elsewhere", () => {
    expect(protectionItemVerdict(rows.find((fee) => fee.fee_published_id === 110527)!)?.outcome).toBe("still_transfer");
    expect(protectionItemVerdict(rows.find((fee) => fee.fee_published_id === 150857)!)?.outcome).toBe("still_transfer");
  });

  it("skips a name that says transfer or period, and a fee with no stored text", () => {
    const base = { fee_published_id: 1, fee_verified_id: 2, institution_id: 3, amount: 30, canonical_fee_key: "od_protection_transfer" };
    expect(protectionItemVerdict({ ...base, fee_name: "Overdraft Protection (per transfer)", source_text: "x" })).toBeNull();
    expect(protectionItemVerdict({ ...base, fee_name: "Overdraft Protection (Annual Fee)", source_text: "x" })).toBeNull();
    expect(protectionItemVerdict({ ...base, fee_name: "Overdraft Protection", source_text: null })?.outcome).toBe("not_read");
  });

  it("never reads or re-files an admin-corrected fee, and re-files only at the name and price it read", async () => {
    const calls: string[] = [];
    const db = Object.assign(
      (strings: TemplateStringsArray) => {
        calls.push(strings.join("?"));
        return Promise.resolve(/SELECT fp\.fee_published_id/.test(strings.join("?")) ? rows : []);
      },
      { unsafe: () => Promise.resolve([]) },
    );
    await recheckProtectionItems(db as never, { runId: 1, dryRun: false, live: true });
    const read = calls.find((sql) => /SELECT fp\.fee_published_id/.test(sql)) ?? "";
    expect(read).toContain(notAdminCorrectedSql("fp"));
    const update = (calls.find((sql) => /UPDATE published_fee_records/.test(sql)) ?? "").replace(/\s+/g, " ");
    expect(update).toContain(notAdminCorrectedSql("fp"));
    expect(update).toContain("fp.amount = v.amount");
    expect(update).toContain("fp.fee_name = v.old_name");
    expect(update).toContain("fp.quarantined_at IS NULL");
  });

  it("writes nothing while the switch is off", async () => {
    const calls: string[] = [];
    const db = Object.assign(
      (strings: TemplateStringsArray) => {
        calls.push(strings.join("?"));
        return Promise.resolve(/SELECT fp\.fee_published_id/.test(strings.join("?")) ? rows : []);
      },
      { unsafe: () => Promise.resolve([]) },
    );
    const result = await recheckProtectionItems(db as never, { runId: 1, dryRun: false, live: false });
    expect(result.matched).toBe(5);
    expect(result.refiled).toEqual([]);
    expect(calls.some((sql) => /UPDATE/.test(sql))).toBe(false);
  });
});
