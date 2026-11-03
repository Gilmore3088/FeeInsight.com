import { describe, expect, it, vi } from "vitest";
import {
  findOldLabelledDocuments,
  OLD_LABELLED_DOCUMENT_CHECK,
  OLD_LABELLED_DOCUMENT_TAKEDOWN_LIVE,
  oldLabelledDocumentVerdict,
  oldLabelledPageKey,
  recheckOldLabelledDocuments,
  type OldLabelledDocumentRow,
} from "./old-labelled-document-check";

const CURRENT_TEXT = [
  "Regular Checking",
  "Account Features | Fee",
  "Monthly Service Fee (No monthly service fee if minimum daily balance of $600.00 is maintained) | $7.00",
  "NOW Checking",
  "Monthly Service Fee (Monthly service fee is waived if minimum daily balance of $1,000.00 is maintained) | $8.50",
].join("\n\n");

const base = {
  documentUrl: "https://www.clackamascountybank.com/archive-2021/personal-checking.php",
  currentLink: "https://www.clackamascountybank.com/personal-checking.php",
  linkText: CURRENT_TEXT,
  feeName: "Regular Checking monthly service fee",
  amount: 7,
  canonicalFeeKey: "monthly_maintenance",
};

describe("oldLabelledDocumentVerdict", () => {
  it("passes a document whose address is not old-labelled", () => {
    expect(oldLabelledDocumentVerdict({ ...base, documentUrl: "https://www.oldnational.com/fees.pdf" })).toBe("not_old_labelled");
    expect(oldLabelledDocumentVerdict({ ...base, documentUrl: "https://bank.example/older-adults-checking" })).toBe("not_old_labelled");
  });

  it("keeps a fee when nothing proves a newer schedule exists", () => {
    expect(oldLabelledDocumentVerdict({ ...base, currentLink: null })).toBe("no_current_link");
    // WinSouth, Central Jersey Police & Fire, Citizens Bank & Trust: the bank's link is the old document itself.
    expect(oldLabelledDocumentVerdict({
      ...base,
      documentUrl: "https://www.cbt-co.com/deposit-accounts/schedule-of-fees-old",
      currentLink: "http://cbt-co.com/deposit-accounts/schedule-of-fees-old/",
    })).toBe("current_link_is_this_page");
    expect(oldLabelledDocumentVerdict({ ...base, currentLink: "https://www.clackamascountybank.com/archive-2022/fees.php" })).toBe("current_link_old_labelled");
    // Westreet: a current link that was never captured proves nothing.
    expect(oldLabelledDocumentVerdict({
      ...base,
      documentUrl: "https://westreet.org/wp-content/uploads/2021/06/Fee-Schedule-Old.pdf",
      currentLink: "http://www.westreet.org/documents/fee-schedule",
      linkText: null,
    })).toBe("current_link_not_captured");
  });

  it("keeps a fee the bank's current page still states at its amount (Clackamas, Nov 3)", () => {
    expect(oldLabelledDocumentVerdict(base)).toBe("stated_on_current_link");
  });

  it("takes down a fee the captured current schedule does not state", () => {
    expect(oldLabelledDocumentVerdict({ ...base, feeName: "Regular Checking monthly service fee", amount: 6 })).toBe("takedown");
    expect(oldLabelledDocumentVerdict({ ...base, feeName: "Stop payment fee", amount: 25, canonicalFeeKey: "stop_payment" })).toBe("takedown");
  });
});

describe("oldLabelledPageKey", () => {
  it("reads one page however it is spelled", () => {
    expect(oldLabelledPageKey("http://www.westreet.org/documents/fee-schedule/")).toBe(oldLabelledPageKey("https://westreet.org/documents/fee-schedule"));
    expect(oldLabelledPageKey("https://westreet.org/documents/fee-schedule")).not.toBe(oldLabelledPageKey("https://westreet.org/wp-content/uploads/2021/06/Fee-Schedule-Old.pdf"));
  });
});

const row = (overrides: Partial<OldLabelledDocumentRow>): OldLabelledDocumentRow => ({
  fee_published_id: 1,
  fee_verified_id: 11,
  institution_id: 2619,
  fee_name: "Regular Checking monthly service fee",
  amount: "7.00",
  canonical_fee_key: "monthly_maintenance",
  source_document_id: 20233,
  document_url: base.documentUrl,
  current_link: base.currentLink,
  link_document_id: 16917,
  link_text: CURRENT_TEXT,
  ...overrides,
});

describe("findOldLabelledDocuments", () => {
  it("counts every verdict and lists only the takedowns as matches", () => {
    const found = findOldLabelledDocuments([
      row({ fee_published_id: 1 }),
      row({ fee_published_id: 2, fee_name: "Stop payment fee", amount: "25.00", canonical_fee_key: "stop_payment" }),
      row({ fee_published_id: 3, document_url: "https://www.clackamascountybank.com/personal-savings.php" }),
      row({ fee_published_id: 4, institution_id: 6933, source_document_id: 2229, document_url: "https://westreet.org/wp-content/uploads/2021/06/Fee-Schedule-Old.pdf", current_link: "http://www.westreet.org/documents/fee-schedule", link_document_id: null, link_text: null }),
      row({ fee_published_id: 2, fee_name: "Stop payment fee", amount: "25.00" }),
    ]);
    expect(found.read).toBe(3);
    expect(found.matched).toBe(1);
    expect(found.verdicts).toMatchObject({ takedown: 1, stated_on_current_link: 1, not_old_labelled: 1, current_link_not_captured: 1 });
    expect(found.samples[0]).toMatchObject({ feePublishedId: 2, oldWord: "archive", reason: "old_labelled_document: #20233 (current link #16917)" });
    expect(found.kept.map((fee) => fee.feePublishedId)).toEqual([1, 4]);
  });
});

describe("recheckOldLabelledDocuments", () => {
  it("is off by default", () => {
    expect(OLD_LABELLED_DOCUMENT_TAKEDOWN_LIVE).toBe(false);
  });

  it("with the switch off, reads and reports but writes no takedown", async () => {
    const statements: string[] = [];
    const db = vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      statements.push(text);
      if (text.includes("WITH live AS")) return [row({ fee_published_id: 2, fee_name: "Stop payment fee", amount: "25.00", canonical_fee_key: "stop_payment" })];
      return [];
    }) as unknown as Parameters<typeof recheckOldLabelledDocuments>[0];
    Object.assign(db, { savepoint: async (fn: (scope: unknown) => unknown) => fn(db) });
    const result = await recheckOldLabelledDocuments(db, { runId: 9, dryRun: false, institutionId: 2619 });
    expect(result).toMatchObject({ live: false, matched: 1, takenDown: [] });
    expect(statements.some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
    expect(statements.some((text) => text.includes("INSERT INTO agent_run_events"))).toBe(true);
    expect(OLD_LABELLED_DOCUMENT_CHECK).toBe("darwin.old_labelled_document");
  });
});
