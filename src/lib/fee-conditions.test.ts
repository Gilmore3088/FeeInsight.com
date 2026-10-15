import { describe, expect, it } from "vitest";
import { PIPELINE_NOTE_MARKERS, readerFeeConditions } from "./fee-conditions";

// Shapes copied from live published_fee_catalog rows (#1234), hashes shortened.
const DETERMINISTIC =
  'Knox deterministic extraction from Rosetta artifact #2437. canonical_hint=account_verification; text_hash=20489e; calibrated_confidence=0.99; excerpt="Verification of Deposit | $15"';
const PAID =
  'Knox paid extraction (model-x-1.5) from Rosetta artifact #20257. canonical_hint=overdraft; text_hash=1f6e05; excerpt="debit card payments) ......... $25.00 per Occurrence"';
const REREAD =
  'Knox extract.rules v65 read this line again in Rosetta artifact #2817. Knox deterministic extraction from Rosetta artifact #2817. canonical_hint=continuous_od; text_hash=dcdfc0; calibrated_confidence=0.98; excerpt="Maximum daily OD fees | $25 per day"';
const PROMOTED =
  'Knox extract.rules v19 categorized a line held for review from Rosetta artifact #3099. canonical_hint=nsf; text_hash=ab12; excerpt="Returned item (NSF) $30"';
const TRACED =
  'Knox extract.rules v20 traced a line held for review from Rosetta artifact #3133. canonical_hint=wire; text_hash=ab12; excerpt="Wire out $25"';
const FREE = 'Knox read a free fee from Rosetta artifact #12. canonical_hint=atm; text_hash=unknown; excerpt="ATM | Free"';
const RATE =
  'Knox read a percentage fee from Rosetta artifact #77. canonical_hint=card_foreign_txn; text_hash=ff; excerpt="Foreign transaction 1.1% of the transaction"';
const HELD = "Knox held for review (range) from Rosetta artifact #6540. canonical_hint=none";

describe("readerFeeConditions", () => {
  it("returns null when the field holds only Knox's note", () => {
    for (const note of [DETERMINISTIC, PAID, REREAD, PROMOTED, TRACED, FREE, RATE, HELD]) {
      expect(readerFeeConditions(note)).toBeNull();
      expect(readerFeeConditions(`  ${note}  `)).toBeNull();
    }
  });

  it("drops an excerpt that itself holds quotes or runs to the 180-character cut", () => {
    expect(
      readerFeeConditions(
        'Knox deterministic extraction from Rosetta artifact #9. canonical_hint=nsf; text_hash=aa; excerpt="Item marked "paid" | $30"',
      ),
    ).toBeNull();
    // Live shapes: box sizes in inches, and a quote the 180-character cut left open.
    expect(
      readerFeeConditions(
        'Knox deterministic extraction from Rosetta artifact #2049. canonical_hint=safe_deposit_box; text_hash=8a8e; excerpt="3 x 10" / $35.00"',
      ),
    ).toBeNull();
    expect(
      readerFeeConditions(
        'Knox read a free fee from Rosetta artifact #17864. canonical_hint=card_foreign_txn; text_hash=79ad; excerpt="Foreign Transaction Fee | $0.00 | See Section "Card T"',
      ),
    ).toBeNull();
    const longExcerpt = "x".repeat(180);
    expect(
      readerFeeConditions(`Knox deterministic extraction from Rosetta artifact #9. canonical_hint=nsf; text_hash=aa; excerpt="${longExcerpt}"`),
    ).toBeNull();
  });

  it("keeps real condition text as it is", () => {
    expect(readerFeeConditions("Waived with $500 minimum balance")).toBe("Waived with $500 minimum balance");
    expect(readerFeeConditions("Per page (4 checks per page)")).toBe("Per page (4 checks per page)");
    expect(readerFeeConditions("  per item  ")).toBe("per item");
    expect(readerFeeConditions("- per item.")).toBe("- per item.");
    expect(readerFeeConditions("")).toBeNull();
    expect(readerFeeConditions("   ")).toBeNull();
    expect(readerFeeConditions(null)).toBeNull();
    expect(readerFeeConditions(undefined)).toBeNull();
  });

  it("returns the bank's text when it is mixed with the note", () => {
    expect(readerFeeConditions(`Waived for members 65 and older. ${DETERMINISTIC}`)).toBe(
      "Waived for members 65 and older",
    );
    expect(readerFeeConditions(`${DETERMINISTIC}; Waived with direct deposit`)).toBe("Waived with direct deposit");
    expect(readerFeeConditions(`${DETERMINISTIC} Waived with direct deposit`)).toBe("Waived with direct deposit");
    expect(readerFeeConditions(`Per item. ${REREAD} Maximum 5 per day`)).toBe("Per item; Maximum 5 per day");
    expect(readerFeeConditions(`Knox County residents only. ${PAID}`)).toBe("Knox County residents only");
  });

  it("keeps near-miss strings that only look like the note", () => {
    for (const real of [
      "Knox County residents only",
      "Waived for Knox FCU members. Applies from January 1",
      "Free for members of the Knox Bar Association; $5 for others",
      "Artifact recovery fee per item",
      "Fee #2 applies per item",
      "Excerpt of statement: $2 per page",
      "Hash-marked checks returned",
      "Confidence plus account only",
      "Rosetta Stone language course discount",
      "canonical form required",
    ]) {
      expect(readerFeeConditions(real)).toBe(real);
    }
  });

  it("never returns a pipeline marker for any note shape, alone or mixed", () => {
    const notes = [DETERMINISTIC, PAID, REREAD, PROMOTED, TRACED, FREE, RATE, HELD];
    const reals = ["", "Per item", "Waived with $1,000 balance."];
    for (const note of notes) {
      for (const before of reals) {
        for (const after of reals) {
          const out = readerFeeConditions([before, note, after].filter(Boolean).join(" "));
          expect(out === null || !PIPELINE_NOTE_MARKERS.test(out)).toBe(true);
        }
      }
    }
    // Leftover fields without the opening sentence go too.
    expect(readerFeeConditions("Per item. text_hash=abc; calibrated_confidence=0.9;")).toBe("Per item");
  });
});
