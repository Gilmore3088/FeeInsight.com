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
  findOdTransfers,
  OD_TRANSFER_REFILE_LIVE,
  odTransferVerdict,
  recheckOdTransfers,
  type OdTransferRow,
} from "./od-transfer-refile-check";

// Every live overdraft fee the check's SQL pre-filter selected on prod, read-only, 2026-10-30:
// [fee_published_id, fee_verified_id, institution_id, fee_name, amount, stored line].
const fixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/od-transfer-live-2026-10-30.json", import.meta.url), "utf8"),
) as Array<[number, number, number, string, number, string]>;
const row = ([id, verified, institution, name, amount, line]: (typeof fixture)[number]): OdTransferRow => ({
  fee_published_id: id,
  fee_verified_id: verified,
  institution_id: institution,
  fee_name: name,
  amount,
  canonical_fee_key: "overdraft",
  source_line: `Knox deterministic extraction from Rosetta artifact #1. canonical_hint=overdraft; excerpt="${line}"`,
});
const rows = fixture.map(row);

describe("Darwin's live re-file of overdraft fees that are the overdraft transfer (Hamilton proof run, Oct 30)", () => {
  it("ships with its switch off", () => {
    expect(OD_TRANSFER_REFILE_LIVE).toBe(false);
  });

  it("dry run: 9 of the 123 live fees the pre-filter selects are the transfer, at 7 institutions", () => {
    const found = findOdTransfers(rows);
    expect(found.checked).toBe(123);
    expect(found.outcomes).toEqual({ not_read: 112, refile: 9, per_item: 1, still_overdraft: 1 });
    expect(found.institutions).toBe(7);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.amount, fee.newName])).toEqual([
      [45105, 12, "Overdraft (O/D) Protection"],
      [46595, 5, "Overdraft Transfer from Rediline Overdraft Loan"],
      [64609, 0, "Transfer from Overdraft Loan"],
      [83142, 0, "Linked Account (Deposit Overdraft (OD) Protection) transaction fee"],
      [125311, 5, "GENERAL FEES (applicable to all accounts): Overdraft"],
      [125312, 5, "Overdraft"],
      [136182, 10, "Overdraft Fee"],
      [141330, 10, "Overdraft Fee"],
      [159833, 0, "Linked Account (Deposit Overdraft (OD) Protection) transaction fee"],
    ]);
  });

  it("keeps a paid-overdraft program priced per item, though its bare name reads as a transfer", () => {
    const verdict = odTransferVerdict(rows.find((fee) => fee.fee_published_id === 51252)!);
    expect(verdict?.outcome).toBe("per_item");
  });

  it("keeps a per-item line that names the transfer, if one is ever live as overdraft", () => {
    const verdict = odTransferVerdict({
      fee_published_id: 1, fee_verified_id: 2, institution_id: 3, fee_name: "Overdraft Protection", amount: 5,
      canonical_fee_key: "overdraft", source_line: 'excerpt="Overdrafts Covered by Courtesy Transfer | $5.00 per item"',
    });
    expect(verdict?.outcome).toBe("per_item");
  });

  it("never reads or re-files an admin-corrected fee, and re-files only at the price it read", async () => {
    const calls: string[] = [];
    const db = Object.assign(
      (strings: TemplateStringsArray) => {
        calls.push(strings.join("?"));
        return Promise.resolve(/SELECT fp\.fee_published_id/.test(strings.join("?")) ? rows.slice(0, 50) : []);
      },
      { unsafe: () => Promise.resolve([]) },
    );
    await recheckOdTransfers(db as never, { runId: 1, dryRun: false, live: true });
    const read = calls.find((sql) => /SELECT fp\.fee_published_id/.test(sql)) ?? "";
    expect(read).toContain(notAdminCorrectedSql("fp"));
    const update = (calls.find((sql) => /UPDATE published_fee_records/.test(sql)) ?? "").replace(/\s+/g, " ");
    expect(update).toContain(notAdminCorrectedSql("fp"));
    expect(update).toContain("fp.amount = v.amount");
    expect(update).toContain("fp.quarantined_at IS NULL");
  });

  it("writes nothing while the switch is off", async () => {
    const calls: string[] = [];
    const db = Object.assign(
      (strings: TemplateStringsArray) => {
        calls.push(strings.join("?"));
        return Promise.resolve(/SELECT fp\.fee_published_id/.test(strings.join("?")) ? rows.slice(0, 50) : []);
      },
      { unsafe: () => Promise.resolve([]) },
    );
    const result = await recheckOdTransfers(db as never, { runId: 1, dryRun: false, live: false });
    expect(result.matched).toBeGreaterThan(0);
    expect(result.refiled).toEqual([]);
    expect(calls.some((sql) => /UPDATE/.test(sql))).toBe(false);
  });
});
