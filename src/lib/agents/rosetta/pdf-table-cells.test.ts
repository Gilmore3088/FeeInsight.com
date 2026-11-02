/**
 * Layout version 6: side-by-side fee tables keep each cell in its own table (pdf-layout.ts,
 * `tableCellColumns`). Mountain Star FCU's tri-fold fee brochure (source document 38274, text
 * 36365, live fee 159428): read across the page, "Money market" (General Fees) shared a baseline
 * with "Fax Service" (the free-services list under Electronic Funds Transfers), the row's
 * "$5.00" sat alone on the next line, and Knox published "Fax Service $5".
 *
 * The bank's PDF host was not reachable from the build session, so the Mountain Star page below
 * is rebuilt from the stored text's own reading order (each " | " a gutter, each line a
 * baseline) at a plausible tri-fold geometry, not from the PDF's own coordinates.
 */
import { describe, expect, it } from "vitest";

import { runFreeSpecialists } from "../knox/specialists";
import { layoutPageResult, layoutPageText, type PdfTextItem } from "./pdf-layout";

const SIZE = 8;
const CHAR = 3.6;
function item(str: string, x: number, y: number, size = SIZE): PdfTextItem {
  return { str, transform: [size, 0, 0, size, x, y], width: str.length * CHAR * (size / SIZE), height: size };
}
/** One table row: a label and, when given, its amount in the table's amount column. */
const row = (labelX: number, amountX: number) => (y: number, label: string, amount?: string) =>
  amount == null ? [item(label, labelX, y)] : [item(label, labelX, y), item(amount, amountX, y)];

function mountainStarPage(): PdfTextItem[] {
  const intro = row(36, 0);
  const general = row(170, 300);
  const account = row(370, 490);
  const eft = row(560, 690);
  return [
    // Introduction panel: prose, no prices.
    ...intro(545, "The fee structure at"),
    ...intro(533, "Mountain Star Federal"),
    ...intro(521, "Credit Union ensures that"),
    ...intro(509, "only members using our"),
    ...intro(497, "special services will be"),
    ...intro(485, "charged accordingly - not"),
    ...intro(473, "the entire membership."),
    ...intro(461, "These fees are necessary to"),
    ...intro(449, "recover the costs of"),
    ...intro(437, "providing such special"),
    ...intro(425, "services, while maintaining"),
    ...intro(413, "members."),
    ...intro(379, "Main Office:"),
    ...intro(367, "2229 E. Yandell"),
    ...intro(355, "El Paso, TX 79903"),
    // General Fees.
    ...general(560, "General Fees", "Amount"),
    ...general(545, "Address Correction", "$5.00"),
    ...general(537, "Fee"),
    ...general(525, "Account Research", "$10.00"),
    item("Per hour", 300, 517),
    ...general(505, "Cashier's Check", "$5.00 ea."),
    ...general(493, "Checkbook Balancing", "$20.00/ hr."),
    ...general(481, "Coin Deposit", "5% of"),
    item("total", 300, 473),
    ...general(461, "CU Check", "$1.00 ea."),
    ...general(449, "Daily Transaction Copies", "$1.00/ pg."),
    ...general(437, "Mailed paper statement", "$1.00"),
    ...general(425, "Membership Fee", "$3.00"),
    // The row the reader broke: a two-line label with its amount centred between the lines.
    ...general(413, "Money market"),
    item("$5.00", 300, 408),
    ...general(403, "excess check"),
    ...general(391, "Money Orders", "$.75 ea."),
    ...general(379, "NSF Check", "$30.00"),
    ...general(367, "Phone Transfer", "NO FEE"),
    ...general(355, "NSF ACH", "$30.00"),
    ...general(343, "Stop Payment", "$20.00"),
    // Account Fees.
    ...account(560, "Account Fees", "Amount"),
    ...account(545, "Check cashing fee", "$10.00"),
    ...account(537, "(non-member check)"),
    ...account(525, "Club Acct. withdrawals", "$10.00"),
    ...account(505, "Debit/ATM Card Replacement", "$5.00"),
    ...account(485, "Dormant Account fee", "$15.00"),
    ...account(465, "*Inactive account fee", "$10.00"),
    ...account(445, "Instant Issue Debit Card", "$10.00"),
    ...account(425, "Overdraft Privilege", "$30.00"),
    ...account(391, "Overdraft Protection", "$3.00"),
    ...account(379, "Reprint Monthly Statements", "$5.00"),
    ...account(367, "Returned Deposited Check", "$20.00"),
    ...account(355, "Second Chance Checking", "$10.00"),
    // Electronic Funds Transfers, then the free services the bank lists in prose.
    ...eft(560, "Electronic Funds Transfers", "Amount"),
    ...eft(545, "Check Cashing", "3.00"),
    ...eft(533, "Foreign ATM Transactions", "$1.50 ea."),
    ...eft(521, "International Transaction Fee", "1% of amount"),
    ...eft(509, "NSF Debit Card", "$10.00"),
    ...eft(497, "Wires Incoming", "$5.00"),
    ...eft(485, "Wires International", "$35.00"),
    ...eft(473, "Wires Outgoing", "$20.00"),
    ...eft(449, "Other Free Services: Anytime, Notary"),
    ...eft(437, "Service, Signature Guarantee, Unlimited"),
    ...eft(425, "Check Writing, Balance Inquiries,"),
    ...eft(413, "Fax Service"),
    ...eft(391, "*Note: All check copies can be"),
    ...eft(379, "retrieved free of charge online at"),
    ...eft(367, "www.mountainstarfcu.org"),
  ];
}

const lines = (text: string) => text.split("\n");
const leftRow = row(40, 220);
const rightRow = row(320, 520);
const leftNames = ["Overdraft fee", "Returned item fee", "Stop payment", "Account closing fee", "Paper statement", "Dormant account", "Research per hour", "Statement copy"];
const rightNames = ["Wire transfer outgoing", "Wire transfer incoming", "Cashier's check", "Money order", "Coin counting", "Notary service", "Night deposit bag", "Safe deposit drill"];

describe("layout v6: side-by-side fee tables keep their own cells", () => {
  it("never pairs Mountain Star's Fax Service with the money market row's $5.00", () => {
    const result = layoutPageResult(mountainStarPage());
    expect(result.tableColumns).toBe(true);
    const text = lines(result.text);
    const fax = text.findIndex((line) => line.includes("Fax Service"));
    expect(fax).toBeGreaterThanOrEqual(0);
    expect(text[fax]).toBe("Fax Service");
    // Neither the line itself nor the lines around it carry the money market row's amount.
    expect(text[fax - 1]).not.toMatch(/\$5\.00/);
    expect(text[fax + 1]).not.toMatch(/\$5\.00/);
    // The money market excess check row carries its own $5.00.
    expect(text).toContain("Money market excess check | $5.00");
    expect(text.some((line) => /Money market/.test(line) && /Fax/.test(line))).toBe(false);
  });

  it("reads each Mountain Star table top to bottom with its rows paired, introduction first", () => {
    const text = lines(layoutPageText(mountainStarPage()));
    expect(text[0]).toBe("The fee structure at");
    const at = (line: string) => text.indexOf(line);
    expect(at("Address Correction | $5.00")).toBeGreaterThan(at("El Paso, TX 79903"));
    expect(at("Check cashing fee | $10.00")).toBeGreaterThan(at("Stop Payment | $20.00"));
    expect(at("Wires Outgoing | $20.00")).toBeGreaterThan(at("Second Chance Checking | $10.00"));
    for (const pair of ["NSF Check | $30.00", "Overdraft Privilege | $30.00", "Wires International | $35.00", "Account Research | $10.00"]) {
      expect(text).toContain(pair);
    }
    // No line joins two tables.
    expect(text.some((line) => /Money Orders|NSF Check/.test(line) && /Overdraft|Reprint/.test(line))).toBe(false);
  });

  it("gives Knox's free reader no $5 fax fee from the Mountain Star page", () => {
    const { candidates } = runFreeSpecialists(layoutPageText(mountainStarPage()), { institutionName: "Mountain Star FCU" });
    expect(candidates.some((fee) => /fax/i.test(fee.feeName) && fee.amount === 5)).toBe(false);
  });

  it("reads two staggered fee tables side by side as two tables (unseen layout)", () => {
    const items = [
      ...leftRow(700, "Checking Fees", "Fee"),
      ...rightRow(700, "Services", "Fee"),
      // The right table's rows sit 2 points lower than the left table's, as two tables set by
      // hand often do; read across, each right label would ride a left row's baseline.
      ...leftNames.flatMap((name, index) => leftRow(680 - index * 14, name, `$${30 + index}.00`)),
      ...rightNames.flatMap((name, index) => rightRow(678 - index * 14, name, index === 5 ? "Free" : `$${10 + index}.00`)),
    ];
    const result = layoutPageResult(items);
    expect(result.tableColumns).toBe(true);
    const text = lines(result.text);
    leftNames.forEach((name, index) => expect(text).toContain(`${name} | $${30 + index}.00`));
    rightNames.forEach((name, index) => expect(text).toContain(`${name} | ${index === 5 ? "Free" : `$${10 + index}.00`}`));
    expect(text.some((line) => leftNames.some((name) => line.includes(name)) && rightNames.some((name) => line.includes(name)))).toBe(false);
    expect(text.indexOf("Statement copy | $37.00")).toBeLessThan(text.indexOf("Services | Fee"));
  });

  it("keeps a label column with two price columns as one table, row by row (unseen layout)", () => {
    const names = ["Monthly service fee", "Overdraft fee", "Stop payment", "Wire outgoing", "Paper statement", "Card replacement"];
    const items = [
      item("Service", 40, 700), item("Personal", 260, 700), item("Business", 400, 700),
      ...names.flatMap((name, index) => [
        item(name, 40, 684 - index * 14),
        item(`$${5 + index}.00`, 260, 684 - index * 14),
        item(index === 4 ? "No charge" : `$${15 + index}.00`, 400, 684 - index * 14),
      ]),
    ];
    const result = layoutPageResult(items);
    expect(result.tableColumns).toBe(false);
    const text = lines(result.text);
    expect(text[0]).toBe("Service | Personal | Business");
    names.forEach((name, index) => expect(text).toContain(`${name} | $${5 + index}.00 | ${index === 4 ? "No charge" : `$${15 + index}.00`}`));
  });

  it("keeps a Service | Description | Fee table row by row: its label column is not a table", () => {
    const names = ["Overdraft", "Returned item", "Stop payment", "Wire outgoing", "Paper statement", "Dormant account", "Research"];
    const items = names.flatMap((name, index) => [
      item(name, 40, 700 - index * 14),
      item(`Charged each time we ${index % 2 ? "return" : "pay"} it`, 180, 700 - index * 14),
      item(`$${20 + index}.00`, 420, 700 - index * 14),
    ]);
    const result = layoutPageResult(items);
    expect(result.tableColumns).toBe(false);
    names.forEach((name, index) => expect(lines(result.text)).toContain(`${name} | Charged each time we ${index % 2 ? "return" : "pay"} it | $${20 + index}.00`));
  });

  it("keeps a Service | Fee | Conditions table row by row: a priced conditions column is not a table", () => {
    // Review of #2948: short conditions that quote prices are not a second fee table; split off,
    // each row lost its waiver, cap or courier note and Knox got loose priced lines.
    const rows: Array<[string, string, string]> = [
      ["Monthly maintenance", "$8.00", "Under $500 balance"],
      ["ATM withdrawal", "$2.50", "Max 4 a day, $140"],
      ["Cashier's check", "$10.00", "Plus $15 courier"],
      ["Wire outgoing", "$30.00", "Rush $25 extra"],
      ["Stop payment", "$32.00", "Online $20 each"],
      ["Overdraft", "$35.00", "Over $5 only"],
      ["Paper statement", "$3.00", "Waived at $1,000"],
      ["Card replacement", "$7.00", "Rush $35 extra"],
      ["Account research", "$25.00", "Min $10 per hour"],
      ["Dormant account", "$5.00", "After $0 balance"],
      ["Coin counting", "$4.00", "Over $100 coin"],
      ["Notary", "$6.00", "Free for $10K+"],
    ];
    const items = rows.flatMap(([name, amount, note], index) => [
      item(name, 40, 700 - index * 14), item(amount, 200, 700 - index * 14), item(note, 300, 700 - index * 14),
    ]);
    const result = layoutPageResult(items);
    expect(result.tableColumns).toBe(false);
    for (const [name, amount, note] of rows) expect(lines(result.text)).toContain(`${name} | ${amount} | ${note}`);
  });

  it("does not glue a heading onto its first row, or two labels of one merged cell", () => {
    const amounts = (x: number) => leftNames.flatMap((name, index) => [item(name, 40, 700 - index * 14), item(`$${30 + index}.00`, x, 700 - index * 14)]);
    const items = [
      ...amounts(220),
      ...rightNames.flatMap((name, index) => rightRow(700 - index * 14, name, `$${10 + index}.00`)),
      // A heading with no row of its own, and the amount of the row below set midway.
      item("Electronic Services", 40, 580), item("$3.00", 220, 575), item("Bill pay", 40, 570),
      // One amount cell merged across two labelled rows.
      item("Overdraft (paid)", 320, 580), item("$30.00", 520, 575), item("NSF (returned)", 320, 570),
    ];
    const result = layoutPageResult(items);
    expect(result.tableColumns).toBe(true);
    const text = lines(result.text);
    expect(text).not.toContain("Electronic Services Bill pay | $3.00");
    expect(text).not.toContain("Overdraft (paid) NSF (returned) | $30.00");
    expect(text.some((line) => line.includes("Electronic Services") && line.includes("$"))).toBe(false);
  });

  it("joins a wrapped label that ends mid-phrase with its centred amount", () => {
    const items = [
      ...leftNames.flatMap((name, index) => leftRow(700 - index * 14, name, `$${30 + index}.00`)),
      ...rightNames.flatMap((name, index) => rightRow(700 - index * 14, name, `$${10 + index}.00`)),
      item("Returned deposited item and", 40, 580), item("$12.00", 220, 575), item("Chargeback", 40, 570),
    ];
    expect(lines(layoutPageText(items))).toContain("Returned deposited item and Chargeback | $12.00");
  });

  it("keeps a one-table page as it was", () => {
    const names = ["Overdraft fee", "Returned item", "Stop payment", "Wire outgoing", "Paper statement", "Dormant account"];
    const items = names.flatMap((name, index) => [item(name, 40, 700 - index * 14), item(`$${20 + index}.00`, 300, 700 - index * 14)]);
    expect(layoutPageResult(items)).toMatchObject({
      tableColumns: false,
      text: names.map((name, index) => `${name} | $${20 + index}.00`).join("\n"),
    });
  });

  it("leaves a label followed a full line later by its amount where it is", () => {
    // One cell per line: an amount a whole line pitch below its label is not a centred amount.
    const items = [
      ...leftNames.flatMap((name, index) => leftRow(700 - index * 14, name, `$${30 + index}.00`)),
      ...rightNames.flatMap((name, index) => rightRow(700 - index * 14, name, `$${5 + index}.00`)),
      item("Statement copy", 40, 580), item("$4.00", 220, 570), item("Research", 40, 560),
    ];
    const result = layoutPageResult(items);
    expect(result.tableColumns).toBe(true);
    const text = lines(result.text);
    expect(text).not.toContain("Statement copy Research | $4.00");
    expect(text).toContain("$4.00");
  });

  it("writes a priced item that crosses a table's edge on its own line, paired with no cell", () => {
    const items = [
      ...leftRow(720, "Checking Fees", "Fee"),
      ...rightRow(720, "Services", "Fee"),
      ...leftNames.flatMap((name, index) => leftRow(700 - index * 14, name, `$${30 + index}.00`)),
      ...rightNames.flatMap((name, index) => rightRow(700 - index * 14, name, `$${10 + index}.00`)),
      // A note that starts in the left table and runs past its edge, on the baseline of a
      // right-table label that has no amount of its own.
      item("* Statement printing $2.00 per page when mailed to any address outside the United States", 40, 570, 8),
      item("Photocopies", 380, 570),
    ];
    const result = layoutPageResult(items);
    expect(result.tableColumns).toBe(true);
    expect(result.ambiguousLines).toBe(1);
    const text = lines(result.text);
    expect(text).toContain("* Statement printing $2.00 per page when mailed to any address outside the United States");
    expect(text).toContain("Photocopies");
    expect(text.some((line) => line.includes("Photocopies") && line.includes("$2.00"))).toBe(false);
  });
});
