import { describe, expect, it } from "vitest";
import { classifyFeeText } from "./rules";
import { bareProtectionName, ownOverdraftTransferPrices, printsOwnOverdraftTransfer, unitAfterPrice } from "./protection-item";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";

/** Every read of a text as `name:category:amount`. */
const reads = (text: string) => runFreeSpecialists(text).candidates.map((fee) => `${fee.feeName}:${fee.canonicalHint}:${fee.amount}`);

// Alcose CU's fee schedule (institution 7356, document 14159, stored text 1668), as stored. Live 51252
// is "Overdraft Protection" at $30 per item; there is no other overdraft fee on the page, and the
// transfer is its own line at $2.
const ALCOSE = "Fee Schedule\n\nFee’s as of 4/1/2024\n\nShares &amp; Share Draft Fees\n\nDormant\n$5.00 per month after 12 months\n\nOverdraft Transfers\n$2.00\n\nOverdraft Protection\n$30.00 per item\n\nDeposit Check Return\n$20.00 per item\n\nCopy of Share Draft (Check)\n$5.00 per item\n\nRedeposit Corporate Check Fee\n$5.00\n\nNSF Fee\n$30.00 per item\n\nStop payment (Check or ACH)\n$20.00 each";

// Institution 5678 (document 31461, live 140406): the transfer opens with "Auto Transfer".
const INST_5678 = "Escheat Fee | $10\nPaper Statement | $2\nUndeliverable/Returned Mail Fee | $5\nOverdraft Protection/NSF\nAuto Transfer Overdraft Per Trans. | $2\nOverdraft Protection | $30\nNSF Returned Check | $30\nCourtesy Overdraft Limit | $500\nWire Transfers Domestic\nOutgoing Non Repetitive | $30";

// Institution 7131 (document 28026, live 131024).
const INST_7131 = "Overdraft Transfer from Savings: | $2.00 per presentment\nOverdraft Protection: | $25.00 per presentment3\nReturned Check for Non-Sufficient Funds (NSF): | $25.00 per presentment\nSingle Stop Payment (check/ACH): | $15.00 per stop";

// Institution 7095 (document 24877, live 110527) and 4908 (live 150857) print their paid-overdraft fee
// on another line: the bare protection line stays the transfer.
const INST_7095 = "Nonsufficient Funds | $30.00/Item\nOverdraft Protection | $7.00/Item, transfer from savings\nStop Payment Request | $15.00/Request\nElectronic Fund Transfers\nService | Fee\nACH/ATM Overdraft | $30.00/Item\nATM Transaction | $1.00/Transaction at ATM not owned by CHCU\nATM/Debit Overdraft Transfer | $7.00/Transfer";
const INST_4908 = "Non-sufficient Funds (NSF) | $25.00/Item\nOne-time Debit Overdraft | $25.00/Item\nOverdraft Advance Courtesy Pay | $25.00/Item\nOverdraft Protection | $5.00/Occurrence\nPhotocopy | $1.00/Page\nReturned Item | $20.00/Item";

describe("Knox v149: a protection programme's per-item line is the overdraft fee when its schedule says so", () => {
  it("is the version these reads ship under", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(149);
  });

  it("reads Alcose's protection line as the overdraft fee and its transfer line as the transfer", () => {
    const found = reads(ALCOSE);
    expect(found).toContain("Overdraft Protection:overdraft:30");
    expect(found).toContain("Overdraft Transfers:od_protection_transfer:2");
    expect(found).not.toContain("Overdraft Protection:od_protection_transfer:30");
  });

  it.each([
    [INST_5678, "Overdraft Protection:overdraft:30", "Auto Transfer Overdraft Per Trans:od_protection_transfer:2"],
    [INST_7131, "Overdraft Protection:overdraft:25", "Overdraft Transfer from Savings:od_protection_transfer:2"],
  ])("reads the protection line as the overdraft fee beside its own transfer line", (text, item, transfer) => {
    const found = reads(text);
    expect(found).toContain(item);
    expect(found).toContain(transfer);
  });

  it.each([
    [INST_7095, "Overdraft Protection:od_protection_transfer:7"],
    [INST_4908, "Overdraft Protection:od_protection_transfer:5"],
  ])("keeps the protection line the transfer where the schedule prints its overdraft fee on another line", (text, read) => {
    expect(reads(text)).toContain(read);
  });

  it("keeps a per-transfer, per-use or periodic protection line where it was, whatever its price", () => {
    expect(reads("Overdraft Transfers\n$2.00\n\nOverdraft Protection\n$25.00 per transfer")).not.toContain("Overdraft Protection:overdraft:25");
    expect(reads("Overdraft Transfer | $3.00\nOverdraft Protection | $25.00 | per year")).not.toContain("Overdraft Protection:overdraft:25");
    expect(reads("Overdraft Transfer | $3.00\nOverdraft Protection | $30.00 per use")).not.toContain("Overdraft Protection:overdraft:30");
    // A bare protection line with no transfer line of its own is still the transfer, as v143 reads it.
    expect(reads("Overdraft Protection\n$30.00 per item")).toContain("Overdraft Protection:od_protection_transfer:30");
  });

  it("files a plural or transfer-first overdraft transfer name as the transfer", () => {
    expect(classifyFeeText("Overdraft Transfers")).toBe("od_protection_transfer");
    expect(classifyFeeText("Auto Transfer Overdraft Per Trans.")).toBe("od_protection_transfer");
    expect(classifyFeeText("Transfer Overdraft- Line of Credit")).toBe("od_protection_transfer");
  });

  // Review of PR #2857: an overdraft fee that only mentions transfers, and a limit, are not the transfer.
  it.each([
    ["Overdraft Fee - ATM/transfers", "overdraft"],
    ["Overdraft Item - checks/transfers", "overdraft"],
    ["Overdraft fee for ACH transfers", "overdraft"],
    ["Overdraft Fee Paid Transfers", "overdraft"],
    ["Transfer OD Fee", "overdraft"],
    ["Transfer Overdraft Fee", "overdraft"],
    ["Overdraft Transfers Limit", "overdraft"],
    ["OD Transfers per day max", null],
    ["OD - ACH/Transfers", null],
  ])("does not file %j as the transfer (as on main)", (name, category) => {
    expect(classifyFeeText(name)).toBe(category);
  });

  it("does not count a limit as the page's own transfer line", () => {
    expect(printsOwnOverdraftTransfer("Overdraft Transfers Limit | $500\nOverdraft Protection | $30.00 per item")).toBe(false);
    expect(reads("Overdraft Transfers Limit | $500\nOverdraft Protection | $30.00 per item")).not.toContain("Overdraft Protection:overdraft:30");
  });

  it("keeps a unitless protection line at the transfer line's own price as the transfer", () => {
    expect(ownOverdraftTransferPrices("Overdraft Transfer | $5.00\nOverdraft Protection | $5.00")).toEqual([5]);
    expect(reads("Overdraft Transfer | $5.00\nOverdraft Protection | $5.00")).toContain("Overdraft Protection:od_protection_transfer:5");
    // Per item at the same price is still the item fee: the line says so.
    expect(reads("Overdraft Transfer | $5.00\nOverdraft Protection | $5.00 per item")).toContain("Overdraft Protection:overdraft:5");
  });

  it("reads the protection line's own name and unit", () => {
    expect(bareProtectionName("Overdraft Protection")).toBe(true);
    expect(bareProtectionName("Overdraft Protection (6)")).toBe(true);
    expect(bareProtectionName("Overdraft Protection (Per Item Presentment)")).toBe(true);
    expect(bareProtectionName("Overdraft Protection (per transfer)")).toBe(false);
    expect(bareProtectionName("Overdraft Protection (Annual Fee)")).toBe(false);
    expect(bareProtectionName("Overdraft Protection (Per Transaction Per Day)")).toBe(false);
    expect(unitAfterPrice("Overdraft Protection $30.00 per item", 30)).toBe("item");
    expect(unitAfterPrice("Overdraft Protection: | $25.00 per presentment3", 25)).toBe("item");
    expect(unitAfterPrice("Overdraft Protection (6) | $ 30 $ 30 | Monthly or Quarterly Statement Reproduction $", 30)).toBe("none");
    expect(unitAfterPrice("Overdraft Protection | $25.00 | per year", 25)).toBe("other");
    expect(unitAfterPrice("Overdraft Protection | $7.00/Item, transfer from savings", 7)).toBe("other");
    expect(unitAfterPrice("Overdraft Protection | $15.00 per use", 15)).toBe("other");
  });

  it("finds a transfer line only where one is printed with a price", () => {
    expect(printsOwnOverdraftTransfer(ALCOSE)).toBe(true);
    expect(printsOwnOverdraftTransfer("Unlike Overdraft Protection Transfer Service, Courtesy Pay carries a small fee.")).toBe(false);
    expect(printsOwnOverdraftTransfer("Overdraft Protection\n$30.00 per item")).toBe(false);
  });
});
