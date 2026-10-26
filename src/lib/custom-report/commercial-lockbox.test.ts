import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bareLockboxName, commercialLockboxName, commercialLockboxOnLine } from "./commercial-lockbox";
import { CATEGORY_GUARD_VERSION, checkFeeCategory, refileCategory, refileFromLine, withCollectionSection, type CategoryGuardContext } from "@/lib/fee-category-guard";
import { COLLECTION_TEXT_PATTERN } from "@/lib/agents/hamilton/category-guard";
import { restoreGuardContext } from "@/lib/agents/hamilton/restore-guard";

// Forte Bank (institution 2078, document 29204): "Lock Box Service, per month | $225.00" in a flat fee
// table whose page says "Fees not included in this table: Safe Deposit Boxes". Live as 135270.
const FORTE = readFileSync(join(__dirname, "..", "agents", "knox", "__fixtures__", "forte-fee-schedule-29204.txt"), "utf8");

// AIM Credit Union (institution 7753, document 39872): its lock boxes are leased by size, and the late
// fee (144459) is printed with them.
const AIM = `Notary fee for non-members

$10.00

Lock Box Lease

(Debited from credit union account on January 15 each year)

Size 3x10x22”

$20.00

Size 5x10x22”

$30.00

Size 10x10x22”

$45.00

Replacement fees for lost lock box keys

$40.00

Drill box open

$150.00

Lock box past due date late fee

$10.00`;

// Raw 184905 (institution 2490, document 16480), held: a box late fee beside the bank's box rows.
const INST_2490 = `License Sticker Fee $5.00
Lock Box Late Payment Fee - per month $2.00
Lost Safe Deposit Key $15.00
Microfilm Copy per item $10.00`;

const guard = (name: string, context?: CategoryGuardContext) => checkFeeCategory("safe_deposit_box", name, context);

describe("guard v100: a commercial lockbox service is not a safe deposit box (#1912)", () => {
  it("is the version this rule ships under", () => {
    expect(CATEGORY_GUARD_VERSION).toBeGreaterThanOrEqual(100);
  });

  it("refuses 135270's name and line, and re-files it nowhere", () => {
    const name = "Lock Box Service, per month";
    expect(commercialLockboxName(name)).toBe(true);
    const verdict = guard(name, { amount: "225.00" });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? null : verdict.code).toBe("name_contradicts");
    // Its own line, read from the stored text, says the same.
    const context = withCollectionSection("safe_deposit_box", name, { amount: "225.00" } as CategoryGuardContext, FORTE);
    expect(context.commercial_lockbox).toBe(true);
    expect(guard(name, context).ok).toBe(false);
    // No type of the 50 holds a lockbox service: no re-file, so the fee comes down.
    expect(refileFromLine("safe_deposit_box", name, context)).toBeNull();
    expect(refileCategory("safe_deposit_box", name)).toBe("safe_deposit_box");
  });

  it("refuses the other commercial lockbox wordings", () => {
    for (const name of [
      "Lockbox Processing",
      "Wholesale Lockbox",
      "Retail Lockbox - per item",
      "Lock Box Remittance Processing",
      "Lockbox Services Monthly Maintenance",
      "Lock-Box Items Processed",
    ]) {
      expect(guard(name).ok, name).toBe(false);
    }
  });

  it("keeps sized lock box rentals and the box's own charges as safe deposit boxes", () => {
    for (const name of [
      "Lock Box Rental 5x5",
      "Lock Box Annual Fee 3 x 5",
      "Lock Box Annual Fee 10 x 10",
      "Lock Box Annual Fee 5 x",
      "Lock Box Replacement Key",
      "Lost Lock Box Key Replace Fee",
      "Drilled Lock Box Fee: Cost +",
      "Lock Box Drilling",
      "Replacement Lock Box Key (each)",
      "Safe Deposit Box Re-drill Lock Box",
      "Replacement fees for lost lock box keys",
      "Lock Box Lease Size 3x10x22”",
      "Lock Box Service Fee 3 x 5 box",
      "Safe Deposit Box Service Call",
    ]) {
      expect(commercialLockboxName(name), name).toBe(false);
      expect(guard(name).ok, name).toBe(true);
    }
  });

  it("keeps AIM's lock box past due date late fee (144459) a safe deposit box: its text prints it with the leased sizes", () => {
    const name = "Lock box past due date late fee";
    expect(bareLockboxName(name)).toBe(false);
    expect(commercialLockboxOnLine(AIM, name, 10)).toBe(false);
    const context = withCollectionSection("safe_deposit_box", name, { amount: 10 } as CategoryGuardContext, AIM);
    expect(guard(name, context).ok).toBe(true);
  });

  it("keeps raw 184905's lock box late payment fee a safe deposit box: it is the box's late fee", () => {
    const name = "Lock Box Late Payment Fee - per month";
    expect(commercialLockboxName(name)).toBe(false);
    expect(commercialLockboxOnLine(INST_2490, name, 2)).toBe(false);
    expect(guard(name, withCollectionSection("safe_deposit_box", name, { amount: 2 } as CategoryGuardContext, INST_2490)).ok).toBe(true);
  });

  it("reads a bare lock box name by its own line or business heading", () => {
    const priced = "Lockbox | $50.00 | plus $0.25 per item\nStop Payment | $30.00";
    expect(commercialLockboxOnLine(priced, "Lockbox", 50)).toBe(true);
    const headed = "TREASURY MANAGEMENT SERVICES\nACH Origination | $25.00\nLock Box Fee | $150.00\nPositive Pay | $50.00";
    expect(commercialLockboxOnLine(headed, "Lock Box Fee", 150)).toBe(true);
    const context = withCollectionSection("safe_deposit_box", "Lock Box Fee", { amount: 150 } as CategoryGuardContext, headed);
    const verdict = guard("Lock Box Fee", context);
    expect(verdict.ok ? null : verdict.code).toBe("schedule_contradicts");
    expect(refileFromLine("safe_deposit_box", "Lock Box Fee", context)).toBeNull();
    // The restore bar reads the same flag.
    expect(restoreGuardContext(headed, { feeName: "Lock Box Fee", amount: 150, canonicalFeeKey: "safe_deposit_box" }).commercial_lockbox).toBe(true);
  });

  it("never lends another column's words, and a box section stops the walk", () => {
    expect(commercialLockboxOnLine("Lock Box | $20.00 | Check Printing | cost", "Lock Box", 20)).toBe(false);
    const boxes = "Business Services\nSafe Deposit Boxes\nLock Box Fee | $25.00";
    expect(commercialLockboxOnLine(boxes, "Lock Box Fee", 25)).toBe(false);
    const flat = "Lock Box Fee | $25.00\nStop Payment | $30.00";
    expect(commercialLockboxOnLine(flat, "Lock Box Fee", 25)).toBe(false);
    expect(guard("Lock Box Fee", withCollectionSection("safe_deposit_box", "Lock Box Fee", { amount: 25 } as CategoryGuardContext, flat)).ok).toBe(true);
  });

  it("is read by Hamilton's live guard for a lock box text", () => {
    expect(new RegExp(COLLECTION_TEXT_PATTERN, "i").test(FORTE)).toBe(true);
  });
});
