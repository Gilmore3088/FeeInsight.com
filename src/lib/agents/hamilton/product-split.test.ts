import { describe, expect, it } from "vitest";
import {
  PRODUCT_SPLIT_MERGE_LIVE,
  headingNamesProduct,
  lineFold,
  linePrintCount,
  namesBothProducts,
  zeroPriceCount,
  pricedOnce,
  productDistance,
  productSplitWinner,
  readsOneLineTwoProducts,
  selectProductSplitTwin,
  type ProductSplitSide,
} from "./product-split";

/** Lines from re-read backlog dry runs 3 and 4 (Nov 3), each as the bank's stored text prints it. */
const POLISH = [
  "Savings/Checking Accounts", "", "Monthly Fee | $0.00", "", "Minimum Balance Fee | $0.00", "",
  "Plus Business Checking (monthly, if average daily balance below $10,000) | $10.00", "",
  "Plus Business Checking (average daily balance $10,000+) | $0.00",
].join("\n");
const CVPH = ["Fees", "Monthly Fee for Draft Checking Accounts…..$1.00", "Skip a Loan Payment Fee…..$35.00", "", "Demand Deposit Account Rates"].join("\n");
const MUTUALONE = ["Commercial Checking", "", "Monthly Service Charge | $12.00", "", "Free Business Checking Plus", "", "Account Fee Description | Account Fee Cost", "", "Monthly Service Charge | None"].join("\n");
const CAMBRIDGE = [
  "CHECKING ACCOUNTS PERFORMANCE PLUS CHECKING1", "Monthly Maintenance Service Charge | $20", "PERFORMANCE CHECKING1",
  "Monthly Maintenance Service Charge | $10", "RELATIONSHIP HIGH-YIELD MONEY MARKET3", "Monthly Maintenance Service Charge | $10",
].join("\n");

const URL = "https://www.bank.example/fee-schedule";
const read = (product: string | null, excerpt: string, extra: Partial<ProductSplitSide> = {}): ProductSplitSide => ({
  product_name: product, frequency: "monthly", source_document_id: 41770, document_url: URL, document_crawled_at: "2026-11-01T00:00:00Z", excerpt, ...extra,
});
const live = (product: string | null, excerpt: string, extra: Partial<ProductSplitSide> = {}): ProductSplitSide => ({
  product_name: product, frequency: "monthly", source_document_id: 16124, document_url: `${URL}?v=2`, document_crawled_at: "2026-05-01T00:00:00Z", excerpt, ...extra,
});

describe("one printed line under two products", () => {
  it("ships switched off", () => {
    expect(PRODUCT_SPLIT_MERGE_LIVE).toBe(false);
  });

  it("folds dot leaders and pipes away, so a re-read and an older read of one line meet", () => {
    expect(lineFold("Monthly Fee for Draft Checking Accounts…..$1.00")).toBe(lineFold("Monthly Fee for Draft Checking Accounts $1.00"));
    expect(linePrintCount(CVPH, "Monthly Fee for Draft Checking Accounts $1.00")).toBe(1);
    expect(linePrintCount(CAMBRIDGE, "Monthly Maintenance Service Charge | $10")).toBe(2);
  });

  it("prices the line once; a $0 line may print no figure", () => {
    expect(pricedOnce("Monthly Service Charge | None", 0)).toBe(true);
    expect(pricedOnce("Monthly Fee | $0.00", 0)).toBe(true);
    expect(pricedOnce("Monthly Service Charge | None", 12)).toBe(false);
    expect(pricedOnce("$2 | $2 | $2", 2)).toBe(false);
  });

  it("Polish & Slavic, Cvph and MutualOne: one line, two products, read from an older and a current copy", () => {
    expect(readsOneLineTwoProducts(read("Savings/Checking Accounts", "Monthly Fee | $0.00"), live(null, "Monthly Fee | $0.00"), POLISH, 0)).toBe(true);
    const plus = "Plus Business Checking (monthly, if average daily balance below $10,000) | $10.00";
    expect(readsOneLineTwoProducts(read("Plus Business Checking", plus), live(null, plus), POLISH, 10)).toBe(true);
    expect(readsOneLineTwoProducts(read(null, "Monthly Fee for Draft Checking Accounts…..$1.00"),
      live("Demand Deposit Account", "Monthly Fee for Draft Checking Accounts $1.00"), CVPH, 1)).toBe(true);
    expect(readsOneLineTwoProducts(read("Free Business Checking Plus", "Monthly Service Charge | None"), live(null, "Monthly Service Charge | None"), MUTUALONE, 0)).toBe(true);
  });

  it("keeps a real per-product price two rows: a line printed once per account (Cambridge Savings, $10 twice)", () => {
    const line = "Monthly Maintenance Service Charge | $10";
    expect(readsOneLineTwoProducts(read(null, line), live("CHECKING ACCOUNTS PERFORMANCE PLUS CHECKING1", line), CAMBRIDGE, 10)).toBe(false);
  });

  it("needs the same product-blind line, page and frequency", () => {
    const line = "Monthly Fee | $0.00";
    expect(readsOneLineTwoProducts(read("A", line), live("A", line), POLISH, 0)).toBe(false);
    expect(readsOneLineTwoProducts(read("A", line), live(null, "Minimum Balance Fee | $0.00"), POLISH, 0)).toBe(false);
    expect(readsOneLineTwoProducts(read("A", line), live(null, line, { document_url: "https://www.bank.example/business-fees" }), POLISH, 0)).toBe(false);
    expect(readsOneLineTwoProducts(read("A", line), live(null, line, { frequency: "annual" }), POLISH, 0)).toBe(false);
    expect(readsOneLineTwoProducts(read("A", line), live(null, line), null, 0)).toBe(false);
  });

  it("the product the page heads nearest the line wins; a product named nowhere above it counts as none", () => {
    // Polish: the re-read names the line's own heading; the live row none.
    expect(productSplitWinner(read("Savings/Checking Accounts", "Monthly Fee | $0.00"), live(null, "Monthly Fee | $0.00"), POLISH)).toBe("read");
    // Cvph: "Demand Deposit Account" is a rates heading below the fee; a tie goes to the newer read.
    expect(productDistance("Demand Deposit Account", CVPH, "Monthly Fee for Draft Checking Accounts…..$1.00")).toBe(Infinity);
    expect(productSplitWinner(read(null, "Monthly Fee for Draft Checking Accounts…..$1.00"), live("Demand Deposit Account", "x"), CVPH)).toBe("read");
    // A re-read that lost the heading right above the line loses to the live row that has it.
    expect(productSplitWinner(read(null, "Monthly Service Charge | None"), live("Free Business Checking Plus", "x"), MUTUALONE)).toBe("live");
    // The nearer of two headings wins.
    expect(productDistance("Free Business Checking Plus", MUTUALONE, "Monthly Service Charge | None")).toBe(2);
    expect(productDistance("Commercial Checking", MUTUALONE, "Monthly Service Charge | None")).toBe(4);
    // An older copy's read never replaces the live row of a newer copy.
    expect(productSplitWinner(read("Savings/Checking Accounts", "Monthly Fee | $0.00", { document_crawled_at: "2026-01-01T00:00:00Z" }),
      live(null, "Monthly Fee | $0.00"), POLISH)).toBe("live");
  });

  it("a heading is a short line with no price or table cell", () => {
    expect(headingNamesProduct("Account Research", "Account Research** | |")).toBe(false);
    expect(headingNamesProduct("Infinity Checking", "Our Infinity Checking account is designed for our customers that want all of the benefits")).toBe(false);
    expect(headingNamesProduct("CHECKING ACCOUNTS PERFORMANCE PLUS CHECKING1", "CHECKING ACCOUNTS PERFORMANCE PLUS CHECKING1")).toBe(true);
  });

  it("an unavailable read stays unavailable, naming no data", async () => {
    const db = { savepoint: () => Promise.reject(new Error("secret")) } as unknown as Parameters<typeof selectProductSplitTwin>[0];
    const row = { feeRawId: 1, institutionId: 1, canonicalFeeKey: "monthly_maintenance", variantType: null, amount: 0, productName: null,
      frequency: null, sourceDocumentId: 1, documentUrl: URL, sourceUrl: URL, documentStream: null, documentCrawledAt: null };
    expect(await selectProductSplitTwin(db, row)).toEqual({ state: "unavailable", check: "product_split" });
  });

  it("review of #2964: a $0 table row printing one zero word per account column is two products' prices", () => {
    expect(pricedOnce("| Monthly Service Charge | None | None |", 0)).toBe(false);
    expect(pricedOnce("| Monthly Fee | Free | Free |", 0)).toBe(false);
    expect(pricedOnce("Monthly Fee | No Charge | N/C", 0)).toBe(false);
    expect(pricedOnce("| Monthly Fee | Free |", 0)).toBe(true);
    const line = "| Monthly Fee | Free | Free |";
    const text = ["Basic Checking | Student Checking", line].join("\n");
    expect(readsOneLineTwoProducts(read("Basic Checking", line), live(null, line), text, 0)).toBe(false);
  });

  it("review of #2964: one line naming two products, on the line or in a heading above it, stays two rows", () => {
    const shared = "Checking and Savings Accounts: Paper statement fee $2.00";
    const both = ["Statements", shared].join("\n");
    expect(namesBothProducts("Checking", "Savings", both, shared)).toBe(true);
    expect(readsOneLineTwoProducts(read("Checking", shared), live("Savings", shared), both, 2)).toBe(false);
    const under = "Paper statement fee | $2.00";
    const headed = ["Basic Checking & Student Checking", "", under].join("\n");
    expect(readsOneLineTwoProducts(read("Basic Checking", under), live("Student Checking", under), headed, 2)).toBe(false);
  });

  it("review of #2964: a product name that is part of the other's is still one line read twice (live pair 113)", () => {
    const line = "Monthly Service Charge | $5.00";
    const text = ["Fresh Start Checking", "", line].join("\n");
    expect(namesBothProducts("Fresh Start Checking", "Checking", text, line)).toBe(false);
    expect(readsOneLineTwoProducts(read("Fresh Start Checking", line), live("Checking", line), text, 5)).toBe(true);
    expect(productSplitWinner(read("Fresh Start Checking", line), live("Checking", line), text)).toBe("read");
  });

  it("review of #2964: a short fee label is not an account heading", () => {
    expect(headingNamesProduct("Account Reconciliation", "Account Reconciliation Fee")).toBe(false);
    expect(headingNamesProduct("Account Reconciliation Fee", "Account Reconciliation Fee")).toBe(false);
    expect(headingNamesProduct("Fee Free Checking", "Fee Free Checking")).toBe(true);
    expect(headingNamesProduct("No Fee Savings", "No Fee Savings")).toBe(true);
  });

  it("second review of #2964: mixed zero words, zero figures and dashes per column are two prices", () => {
    for (const line of ["| Monthly Fee | Free | None |", "| Monthly Fee | None | No charge |", "| Monthly Fee | Waived | N/C |", "| Monthly Fee | 0 | 0 |", "| Monthly Fee | - | - |", "| Monthly Fee | $0.00 | Free |"]) {
      expect(zeroPriceCount(line)).toBe(2);
      expect(pricedOnce(line, 0)).toBe(false);
    }
    expect(pricedOnce("| Monthly Fee | $0.00 |", 0)).toBe(true);
    expect(pricedOnce("Co-Op ATM Fee: | None – machine fees may apply", 0)).toBe(true);
    expect(pricedOnce("Monthly Service Charge: Free", 0)).toBe(true);
    const text = ["| | Basic Checking | Student Checking |", "| Monthly Fee | Free | None |"].join("\n");
    expect(readsOneLineTwoProducts(read("Basic Checking", "| Monthly Fee | Free | None |"), live("Student Checking", "| Monthly Fee | Free | None |"), text, 0)).toBe(false);
  });

  it("second review of #2964: fee-word headings, long account lists and table header rows name both products", () => {
    const line = "Paper statement | $2.00";
    for (const heading of ["Checking and Savings Account Fees", "Checking & Savings Service Charges"]) {
      expect(namesBothProducts("Checking", "Savings", [heading, line].join("\n"), line)).toBe(true);
      expect(readsOneLineTwoProducts(read("Checking", line), live("Savings", line), [heading, line].join("\n"), 2)).toBe(false);
    }
    expect(namesBothProducts("Regular Savings", "Youth Savings", ["Regular Savings, Holiday Club & Youth Savings Accounts", line].join("\n"), line)).toBe(true);
    expect(namesBothProducts("Basic Checking", "Senior Checking", ["Basic Checking, Student Checking and Senior Checking", line].join("\n"), line)).toBe(true);
    expect(namesBothProducts("Basic Checking", "Student Checking", ["Basic Checking | Student Checking", line].join("\n"), line)).toBe(true);
    // The nearer heading names one product only: it heads the line.
    expect(namesBothProducts("Basic Checking", "Student Checking", ["Basic Checking & Student Checking", "Student Checking Fees", line].join("\n"), line)).toBe(false);
  });

  it("third review of #2964: a $0 table row with two filled value cells is two prices, whatever the cells say", () => {
    for (const line of ["| Monthly Fee | -0- | -0- |", "| Monthly Fee | Included | Included |", "| Monthly Fee | No monthly fee | No monthly fee |",
      "| Monthly Fee | (none) | (none) |", "| Monthly Fee | No Cost | No Cost |", "| | Free | Free |", "Monthly Fee 0 0"]) {
      expect(pricedOnce(line, 0)).toBe(false);
    }
    expect(pricedOnce("Monthly Fee | $0.00", 0)).toBe(true);
    expect(pricedOnce("| Monthly Fee | None |", 0)).toBe(true);
    expect(pricedOnce("Monthly Fee $0 on balances over $10,000", 0)).toBe(true);
    const text = ["| Fee | Basic | Student |", "| Monthly Fee | Included | Included |"].join("\n");
    expect(readsOneLineTwoProducts(read("Basic Checking", "| Monthly Fee | Included | Included |"), live("Student Checking", "| Monthly Fee | Included | Included |"), text, 0)).toBe(false);
  });

  it("third review of #2964: a description line under a shared heading does not hide it", () => {
    const zero = "Monthly Maintenance Fee | None";
    expect(namesBothProducts("Basic Checking", "Student Checking", ["Basic Checking & Student Checking", "Student Checking is available to customers under 24.", zero].join("\n"), zero)).toBe(true);
    const five = "Monthly fee | $5.00";
    expect(namesBothProducts("Basic Checking", "Student Checking", ["Basic Checking & Student Checking", "Basic Checking: no minimum balance", five].join("\n"), five)).toBe(true);
  });
});
