// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { networkColumnReads, networkHeaderColumn, withoutNetworkTableRows } from "@/lib/custom-report/network-column-rows";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { namesLateChargeBound } from "@/lib/late-charge-bound";

// #1905: the fee sections of Navy Federal's stored page (doc 39026, text 37160, read Oct 21), its
// prepaid and gift card section left out (#1908 reads those).
const navy = readFileSync(new URL("./__fixtures__/navy-federal-fee-page-39026.txt", import.meta.url), "utf8");
const NON_NETWORK = "Non-Navy Federal/Non-CO-OP Network ATM";
// R-G FCU's ATM table (doc 35833), as stored.
const rg = ["Item/Service | Non-Owned ATM Fee | Owned ATM Fee", "", "Withdrawal | $1.00 | FREE", "", "Balance Inquiry or Transfer (each) | $0.60 | FREE"].join("\n");

const reads = (text: string) => runFreeSpecialists(text).candidates;

describe("Knox v114 reads an ATM network table by its columns (#1905)", () => {
  it("reads each machine use at the non-network column's price, named by the row and the column", () => {
    const atm = reads(navy).filter((read) => read.canonicalHint === "atm_non_network" && read.excerpt.includes("| None |"));
    expect(atm.map((read) => [read.feeName, read.amount])).toEqual([
      [`Share withdrawal at ${NON_NETWORK}`, 1],
      [`Transfer at ${NON_NETWORK}`, 1],
      [`Inquiry at ${NON_NETWORK}`, 1],
    ]);
  });

  it("reads no other column's price and no other reader's take on the table's rows", () => {
    const all = reads(navy);
    // The CO-OP column's $0.50 for a credit card's cash advance, read before as a deposit cash advance.
    expect(all.some((read) => read.canonicalHint === "cash_advance" || read.amount === 0.5)).toBe(false);
    // The heading-composed read of the transfer row and the CO-OP cell's returned deposit.
    expect(all.some((read) => read.feeName === "ATM fees: Transfer" || read.feeName === "Returned Check Deposits")).toBe(false);
    const tableRows = navy.split("\n").filter((line) => line.includes("| None |") || line.startsWith("Purchase |"));
    expect(all.filter((read) => tableRows.includes(read.excerpt) && !read.feeName.endsWith(` at ${NON_NETWORK}`))).toEqual([]);
  });

  it("reads R-G FCU's two-column network table the same way", () => {
    expect(reads(rg).map((read) => [read.feeName, read.amount, read.canonicalHint])).toEqual([
      ["Withdrawal at Non-Owned ATM", 1, "atm_non_network"],
      ["Balance Inquiry or Transfer (each) at Non-Owned ATM", 0.6, "atm_non_network"],
    ]);
  });

  it("the shared check traces the composed name at that column's price only", () => {
    const name = `Share withdrawal at ${NON_NETWORK}`;
    expect(checkFeeAgainstSource(navy, name, 1, ".", "atm_non_network").ok).toBe(true);
    expect(checkFeeAgainstSource(navy, name, 0.5, ".", "atm_non_network").ok).toBe(false);
    expect(checkFeeAgainstSource(navy, name, 1, ".", "cash_advance").ok).toBe(false);
    // A credit card's cash advance is no read of the table's.
    expect(networkColumnReads(navy).some((read) => /cash advance/i.test(read.feeName))).toBe(false);
  });

  it("arms only on a network table's header", () => {
    expect(networkHeaderColumn("Transaction Type | Navy Federal ATM | CO-OP ATM Network® | Non-Navy Federal/Non-CO-OP Network ATM | MAESTRO | INTERLINK Point-of-Sale")).toBe(3);
    expect(networkHeaderColumn("Item/Service | Non-Owned ATM Fee | Owned ATM Fee")).toBe(1);
    // An outsider's column at the bank's own ATMs is not another network's.
    expect(networkHeaderColumn("Transaction | Member ATM Fee | Non-Member ATM Fee")).toBeNull();
    // Prose flattened into cells, a price in the header, a first cell that names the ATM itself.
    expect(networkHeaderColumn("Fees | Other than a Bank of Hawaii ATM++ | at international ATMs (outside the U.S., American Samoa, Guam,")).toBeNull();
    expect(networkHeaderColumn("ATM/Debit Card | Out-of-Network ATM Transaction | Determined by ATM owner")).toBeNull();
    expect(networkHeaderColumn("Withdrawal | Our ATM | Other ATM $2.00")).toBeNull();
    // A header over a single row is a note, not a table: nothing is blanked or read.
    const one = "Transaction | Our ATMs | Other Bank ATMs\nWithdrawal | Free | $2.00\nStop Payment | $30.00";
    expect(withoutNetworkTableRows(one)).toBe(one);
    expect(networkColumnReads(one)).toEqual([]);
  });

  it("a product column named with a network word does not arm the reader (review note 1)", () => {
    expect(networkHeaderColumn("Feature | Classic Checking | Star Checking | Other Bank ATM Fees")).toBeNull();
    expect(networkHeaderColumn("Service | Plus Savings | Network Checking | Non-Bank ATMs")).toBeNull();
  });

  it("hides only the machine rows from the other readers; a stop payment row under the header is still read (review note 1)", () => {
    const table = [
      "Service | Our ATMs | Non-Bank ATMs | Notes",
      "Withdrawal | Free | $2.00 | each",
      "Balance Inquiry | Free | $1.00 | each",
      "Stop Payment | $30.00 | $30.00 | per item",
    ].join("\n");
    const blanked = withoutNetworkTableRows(table).split("\n");
    expect(blanked[1]).toBe("");
    expect(blanked[3]).toBe("Stop Payment | $30.00 | $30.00 | per item");
    const all = reads(table);
    expect(all.some((read) => /stop payment/i.test(read.feeName) && read.amount === 30)).toBe(true);
    expect(all.filter((read) => read.canonicalHint === "atm_non_network").map((read) => [read.feeName, read.amount])).toEqual([
      ["Withdrawal at Non-Bank ATMs", 2],
      ["Balance Inquiry at Non-Bank ATMs", 1],
    ]);
  });

  it("a conditional price is no flat read (review note 2)", () => {
    const table = ["Service | Our ATMs | Other ATMs", "Withdrawal | Free | $2.00", "Transfer | $0 | $3.00 per transfer after 4"].join("\n");
    expect(networkColumnReads(table).map((read) => [read.feeName, read.amount])).toEqual([["Withdrawal at Other ATMs", 2]]);
    expect(reads(table).some((read) => read.amount === 3)).toBe(false);
  });

  it("guard v91: a share withdrawal at another network's ATM is the network fee; the savings limit is not", () => {
    expect(checkFeeCategory("atm_non_network", `Share withdrawal at ${NON_NETWORK}`).ok).toBe(true);
    expect(checkFeeCategory("atm_non_network", "ATM Share Savings Withdrawal (over 3x per month)").ok).toBe(false);
    expect(checkFeeCategory("atm_non_network", "Share withdrawal").ok).toBe(false);
  });
});

describe("Knox v114: a late charge's cap or floor is no late fee (#1905)", () => {
  it("reads no late fee from the mortgage late-charge sentence, and keeps the real late fees", () => {
    const late = reads(navy).filter((read) => read.canonicalHint === "late_payment");
    expect(late.map((read) => [read.feeName, read.amount])).toEqual([
      ["Consumer loan late fee", 29],
      ["Late payment fee", 20],
    ]);
  });

  it("names the bound only when the name's last clause is the bound itself", () => {
    for (const name of [
      "Maximum late charge",
      "Minimum late charge",
      "Minimum Late Fee",
      "Minimum Late Charge",
      "Generally 5% of the principal and interest for conventional loans; maximum late charge of",
      "2% in NY, 3% in MA, 5% for equity loans in MO Generally a maximum late charge of",
      "Max. late payment fee",
    ]) expect(namesLateChargeBound(name)).toBe(true);
    for (const name of ["Late Fee", "Consumer loan late fee", "Late Fee (maximum $25)", "Maximum Daily OD Fee", "Minimum balance fee", "Late charge minimum balance"]) {
      expect(namesLateChargeBound(name)).toBe(false);
    }
  });
});
