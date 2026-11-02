// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  HEADING_LOOKBACK_LINES,
  serviceHeadingOf,
  serviceMaintenanceOf,
  serviceMaintenanceRead,
} from "@/lib/service-maintenance-heading";

const MM = "monthly_maintenance";

/** State key 5608's section as River City Bank prints it (frozen text), and as a table read pairs its rows. */
const RIVER_CITY_STACKED = [
  "$5 per automated transfer from Savings to Checking Account",
  "",
  "The Transfer Fee will not be charged if there are not enough funds in the savings account to cover the entire overdraft amount.",
  "",
  "Consumer Online Banking Services and Mobile Banking Fees",
  "",
  "Set Up Fee",
  "",
  "No charge",
  "",
  "Monthly Maintenance Fee",
  "",
  "No charge",
  "",
  "Transfer Between Accounts Using Online Service",
  "",
  "No charge per transfer between RCB Accounts",
].join("\n");
const riverCityRows = (price: string) => [
  "$5 per automated transfer from Savings to Checking Account",
  "",
  "The Transfer Fee will not be charged if there are not enough funds in the savings account to cover the entire overdraft amount.",
  "",
  "Consumer Online Banking Services and Mobile Banking Fees",
  "",
  "Set Up Fee | No charge",
  "",
  `Monthly Maintenance Fee | ${price}`,
  "",
  "Transfer Between Accounts Using Online Service | No charge per transfer between RCB Accounts",
].join("\n");

const under = (heading: string, row: string, before = "Wire Transfer - Outgoing | $25.00") => `${before}\n\n${heading}\n\n${row}`;
const of = (line: string | null, documentText: string | null, canonicalFeeKey: string | null = MM) =>
  serviceMaintenanceOf({ line, documentText, canonicalFeeKey });

describe("a monthly maintenance read under a service's heading (#1092, state key 5608)", () => {
  describe("holds the service's own monthly fee", () => {
    it("River City's $0 row, read as a table row", () => {
      expect(of("Monthly Maintenance Fee | No charge", riverCityRows("No charge"))).toEqual({
        heading: "Consumer Online Banking Services and Mobile Banking Fees",
        services: ["online_banking", "mobile_banking"],
      });
    });

    it("the same row priced", () => {
      expect(of("Monthly Maintenance Fee | $4.95", riverCityRows("$4.95"))?.services).toEqual(["online_banking", "mobile_banking"]);
    });

    it("River City's frozen text, label and value stacked", () => {
      expect(of("Monthly Maintenance Fee", RIVER_CITY_STACKED)?.heading).toBe("Consumer Online Banking Services and Mobile Banking Fees");
    });

    it.each([
      ["Online Banking", "online_banking"],
      ["Internet Banking Services", "internet_banking"],
      ["Mobile Banking", "mobile_banking"],
      ["Bill Pay", "bill_pay"],
      ["Bill Payment Services", "bill_pay"],
      ["E-Statements", "estatements"],
      ["Remote Deposit Capture", "remote_deposit"],
      ["Text Banking", "text_banking"],
      ["Zelle®", "zelle"],
      ["Treasury Management Services", "treasury"],
      ["Business Online Banking", "online_banking"],
      ["Online Banking Fees1", "online_banking"],
    ])("under %s", (heading, kind) => {
      expect(of("Monthly Maintenance Fee | $5.00", under(heading, "Monthly Maintenance Fee | $5.00"))?.services).toEqual([kind]);
    });

    it("under a heading that shares one word between two services (Online & Mobile Banking)", () => {
      expect(of("Monthly Fee | $0.00", under("Online & Mobile Banking", "Monthly Fee | $0.00"))?.services).toEqual(["mobile_banking"]);
    });

    it("past sibling rows and a note, under a heading that opens the document", () => {
      const text = "Online Banking\n\nSet Up Fee | $0.00\n(Fee shown as OLB Fee)\nMonthly Maintenance Fee | $3.00";
      expect(of("Monthly Maintenance Fee | $3.00", text)?.heading).toBe("Online Banking");
    });

    it("a row matched with another spacing", () => {
      expect(of("Monthly  Maintenance Fee |  $5.00", under("Bill Pay", "Monthly Maintenance Fee | $5.00"))).not.toBeNull();
    });
  });

  describe("near misses: the account's own fee, or a heading in doubt, is never one", () => {
    it("an account heading whose description says online banking is included", () => {
      const text = "Basic Checking\n\nFree online banking included with every account.\n\nMonthly Maintenance Fee | $5.00";
      expect(of("Monthly Maintenance Fee | $5.00", text)).toBeNull();
    });

    it("an account heading over a title-case \"Online Banking Included\" line", () => {
      const text = "Basic Checking\n\nOnline Banking Included\n\nMonthly Maintenance Fee | $5.00";
      expect(of("Monthly Maintenance Fee | $5.00", text)).toBeNull();
    });

    it("\"Checking with Online Banking\" is an account's name", () => {
      expect(of("Monthly Maintenance Fee | $5.00", under("Checking with Online Banking", "Monthly Maintenance Fee | $5.00"))).toBeNull();
    });

    it("a maintenance row under an account heading, followed by an online banking section", () => {
      const text = "Personal Checking\n\nMonthly Maintenance Fee | $8.00\n\nOnline Banking\n\nBill Pay | Free\n\nMobile Deposit | Free";
      expect(of("Monthly Maintenance Fee | $8.00", text)).toBeNull();
    });

    it("\"Business Online Banking\" below a maintenance row that sits under Business Checking", () => {
      const text = "Business Checking\n\nMonthly Maintenance Fee | $10.00\n\nMinimum Balance to Open | $100.00\n\nBusiness Online Banking\n\nACH Origination | $15.00";
      expect(of("Monthly Maintenance Fee | $10.00", text)).toBeNull();
    });

    it("an account's list of features printed as short lines", () => {
      const text = "Premier Checking\n\nFree Online Banking\n\nMobile Banking\n\nMonthly Maintenance Fee | $10.00";
      expect(of("Monthly Maintenance Fee | $10.00", text)).toBeNull();
    });

    it("an account's list of features printed as bullets", () => {
      const text = "Premier Checking\n• Online Banking\n• Mobile Banking\n• Bill Pay\nMonthly Maintenance Fee | $10.00";
      expect(of("Monthly Maintenance Fee | $10.00", text)).toBeNull();
    });

    it("a service line under an account's lead that ends in a colon", () => {
      const text = "Premier Checking includes:\n\nOnline Banking\n\nMonthly Maintenance Fee | $10.00";
      expect(of("Monthly Maintenance Fee | $10.00", text)).toBeNull();
    });

    it("a feature line inside an account's table, under its opening-deposit row (review of #2953)", () => {
      const text = "Minimum to open | $100.00\nOnline Banking and Mobile Banking\nMonthly Maintenance Fee | $5.00";
      expect(of("Monthly Maintenance Fee | $5.00", text)).toBeNull();
      expect(of("Monthly Maintenance Fee | $5.00", `Basic Checking\n${text}`)).toBeNull();
    });

    it("a feature line inside an account comparison table, its row priced per account (review of #2953)", () => {
      const text = "Fee | Basic Checking | Premier Checking\nOnline & Mobile Banking\nMonthly Maintenance Fee | $5.00 | $10.00";
      expect(of("Monthly Maintenance Fee | $5.00 | $10.00", text)).toBeNull();
      expect(of("Monthly Maintenance Fee | $5.00", text)).toBeNull();
    });

    it("a row that carries more than one price cell, even under a service heading", () => {
      expect(of("Monthly Maintenance Fee | $5.00 | $10.00", under("Online Banking", "Monthly Maintenance Fee | $5.00 | $10.00"))).toBeNull();
    });

    it("a service line under a sentence about what an account includes", () => {
      const text = "Every checking account includes the following\n\nOnline Banking\n\nMonthly Maintenance Fee | $10.00";
      expect(of("Monthly Maintenance Fee | $10.00", text)).toBeNull();
    });

    it("a service heading right under an account heading", () => {
      const text = "Personal Checking\n\nOnline Banking Fees\n\nMonthly Maintenance Fee | $0.00";
      expect(of("Monthly Maintenance Fee | $0.00", text)).toBeNull();
    });

    it("a note naming an account between the service heading and the row", () => {
      const text = "Online Banking\n\nThis fee applies to each linked checking account, charged monthly.\n\nMonthly Maintenance Fee | $2.00";
      expect(of("Monthly Maintenance Fee | $2.00", text)).toBeNull();
    });

    it("a bracketed account note between the service heading and the row", () => {
      const text = "Online Banking\n\n(for Business Checking accounts)\n\nMonthly Maintenance Fee | $2.00";
      expect(of("Monthly Maintenance Fee | $2.00", text)).toBeNull();
    });

    it("a row whose own label names the account", () => {
      expect(of("Checking Monthly Maintenance Fee | $5.00", under("Online Banking", "Checking Monthly Maintenance Fee | $5.00"))).toBeNull();
    });

    it("another category under a service heading is not this rule's", () => {
      expect(of("Monthly Fee | $3.00", under("Bill Pay", "Monthly Fee | $3.00"), "bill_pay")).toBeNull();
    });

    it.each([
      "Electronic Banking",
      "Digital Banking Services",
      "Mobile Deposit",
      "Online Statements",
      "Online Banking Account Fees",
      "Free Online Banking",
      "Online Banking Required",
      "Mobile Banking App Features",
      "Treasury Bills",
      "Overdraft Services",
      "Savings Accounts",
      "Money Market",
      "Consumer Checking Accounts",
      "Totally Free Checking",
      "Health Savings Account",
      "Certificates of Deposit",
      "Kasasa Cash Checking",
      "Club Accounts",
    ])("under %s", (heading) => {
      expect(of("Monthly Maintenance Fee | $5.00", under(heading, "Monthly Maintenance Fee | $5.00"))).toBeNull();
    });

    it("a service named in a sentence, not a heading", () => {
      const text = "Basic Checking\n\nEnroll in online banking and e-statements to avoid the monthly fee.\n\nMonthly Maintenance Fee | $6.00";
      expect(of("Monthly Maintenance Fee | $6.00", text)).toBeNull();
    });

    it("a service's own table row above the account's row", () => {
      const text = "Basic Checking\n\nOnline Banking | Free\n\nMonthly Maintenance Fee | $6.00";
      expect(of("Monthly Maintenance Fee | $6.00", text)).toBeNull();
    });

    it("a service label stacked over its own value above the account's row", () => {
      const text = "Basic Checking\n\nOnline Banking\n\nFree\n\nMonthly Maintenance Fee | $6.00";
      expect(of("Monthly Maintenance Fee | $6.00", text)).toBeNull();
    });

    it("a service heading ending like a sentence", () => {
      expect(of("Monthly Maintenance Fee | $5.00", under("Online banking.", "Monthly Maintenance Fee | $5.00"))).toBeNull();
    });

    it("an account comparison table with an online banking row", () => {
      const text = "Checking Comparison\n\nOnline Banking | Free | Free | Free\n\nMonthly Maintenance Fee | $0 | $10 | $15";
      expect(of("Monthly Maintenance Fee | $0 | $10 | $15", text)).toBeNull();
    });

    it("a row printed twice, once under an account heading", () => {
      const text = `${under("Online Banking", "Monthly Maintenance Fee | No charge")}\n\nFree Checking\n\nMonthly Maintenance Fee | No charge`;
      expect(of("Monthly Maintenance Fee | No charge", text)).toBeNull();
    });

    it("a heading more lines above than the lookback reads", () => {
      const rows = Array.from({ length: HEADING_LOOKBACK_LINES }, (_, at) => `Service ${at + 1} | $1.00`);
      const text = ["Online Banking", ...rows, "Monthly Maintenance Fee | $5.00"].join("\n");
      expect(of("Monthly Maintenance Fee | $5.00", text)).toBeNull();
    });

    it("no heading at all above the row", () => {
      expect(of("Monthly Maintenance Fee | $5.00", "Our fees are listed below.\nMonthly Maintenance Fee | $5.00")).toBeNull();
    });

    it("a row the text does not print, no text, or no line", () => {
      expect(of("Monthly Maintenance Fee | $5.00", under("Online Banking", "Monthly Fee | $5.00"))).toBeNull();
      expect(of("Monthly Maintenance Fee | $5.00", null)).toBeNull();
      expect(of(null, under("Online Banking", "Monthly Maintenance Fee | $5.00"))).toBeNull();
      expect(of("Monthly Maintenance Fee | $5.00", under("Online Banking", "Monthly Maintenance Fee | $5.00"), null)).toBeNull();
    });
  });

  describe("serviceHeadingOf", () => {
    it("names only services with audience and schedule words beside them", () => {
      expect(serviceHeadingOf("Consumer Online Banking Services and Mobile Banking Fees")).toEqual(["online_banking", "mobile_banking"]);
      expect(serviceHeadingOf("Personal Bill Pay & Zelle® Fees")).toEqual(["bill_pay", "zelle"]);
      expect(serviceHeadingOf("Checking with Online Banking")).toBeNull();
      expect(serviceHeadingOf("Online Banking Included")).toBeNull();
      expect(serviceHeadingOf("")).toBeNull();
    });
  });

  describe("Darwin's reading: Knox's row and the shared check's traced line both", () => {
    const text = `${under("Online Banking", "Monthly Maintenance Fee | No charge")}\n\nFree Checking\n\nMonthly Service Charge | No charge`;

    it("holds when the traced line is the same row, or there is none", () => {
      const read = { excerpt: "Monthly Maintenance Fee | No charge", canonicalFeeKey: MM, documentText: text };
      expect(serviceMaintenanceRead({ ...read, tracedLine: "Monthly Maintenance Fee | No charge" })?.services).toEqual(["online_banking"]);
      expect(serviceMaintenanceRead({ ...read, tracedLine: null })?.services).toEqual(["online_banking"]);
    });

    it("keeps a fee the shared check traces to an account's row", () => {
      expect(serviceMaintenanceRead({
        excerpt: "Monthly Maintenance Fee | No charge", tracedLine: "Monthly Service Charge | No charge", canonicalFeeKey: MM, documentText: text,
      })).toBeNull();
    });

    it("keeps a fee whose own row is the account's", () => {
      expect(serviceMaintenanceRead({
        excerpt: "Monthly Service Charge | No charge", tracedLine: null, canonicalFeeKey: MM, documentText: text,
      })).toBeNull();
    });
  });
});
