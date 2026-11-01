import { describe, expect, it } from "vitest";
import { ownFeeFromRows } from "@/lib/own-fee";
import { collectFeeRefs } from "@/lib/saved-output-corrections";
import { structureFromFees } from "./research";
import { overdraftResearch } from "./test-fixtures";

// Gate G5 (Oct 30): a saved overdraft answer quoted the bank's NSF and transfer fees from the
// structure table, but its saved fee rows held only overdraft rows, so a later correction of
// either fee would not have reached it. Invented fixture banks; no live data.
function fee(category: string, amount: number, ids: number[], docs: number[]) {
  return { ...ownFeeFromRows(category, [{ fee_name: category, amount }], amount, false)!, feePublishedIds: ids, sourceDocumentIds: docs };
}

describe("structure table fee rows (gate G5)", () => {
  const fees = new Map([
    [1000, new Map([["overdraft", fee("overdraft", 35, [11], [70])], ["nsf", fee("nsf", 35, [12], [70])], ["od_protection_transfer", fee("od_protection_transfer", 10, [13], [70])]])],
    [2000, new Map([["nsf", fee("nsf", 0, [21], [80])]])],
  ]);
  const structure = structureFromFees(
    { institutionId: 1000, institutionName: "Fixture Bank" },
    { label: "local competitors", members: [{ institutionId: 2000, institutionName: "Peer Bank" }, { institutionId: 3000, institutionName: "Quiet Bank" }] },
    fees,
  );

  it("puts the published rows behind each row's values on the row", () => {
    expect(structure.rows.map((r) => [r.institutionId, r.values, r.feePublishedIds ?? null])).toEqual([
      [1000, { overdraft: 35, nsf: 35, od_protection_transfer: 10 }, [11, 12, 13]],
      [2000, { nsf: 0 }, [21]],
      [3000, {}, null],
    ]);
  });

  it("lets a saved answer record the bank's NSF and transfer rows beside its overdraft row", () => {
    const research = overdraftResearch({ institutionId: 1000, ownRows: [], structure });
    const ids = collectFeeRefs(research).map((ref) => ref.feePublishedId);
    expect(ids).toEqual(expect.arrayContaining([11, 12, 13, 21]));
    expect(collectFeeRefs(research).find((ref) => ref.feePublishedId === 12)).toMatchObject({ institutionId: 1000, sourceDocumentId: 70 });
  });
});
