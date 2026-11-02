/**
 * Layout version 6: side-by-side fee tables keep each cell in its own table (pdf-layout.ts,
 * `tableCellColumns`). Mountain Star FCU's tri-fold fee brochure (source document 38274, text
 * 36365, live fee 159428): read across the page, "Money market" (General Fees) shared a baseline
 * with "Fax Service" (the free-services list under Electronic Funds Transfers), the row's
 * "$5.00" sat alone on the next line, and Knox published "Fax Service $5".
 *
 * The bank's PDF host was not reachable from the build session, so the Mountain Star page below
 * is rebuilt from the stored text's own reading order (each " | " a gutter, each line a
 * baseline) at a plausible tri-fold geometry, not from the PDF's own coordinates. In that order
 * the panels keep their own row grids (General and Account Fees share 13 of 36 baselines,
 * Account Fees and Electronic Funds Transfers 22 of 36), so the row-alignment rule splits it.
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

/**
 * Mountain Star's page, one entry per line of the stored text 36365 in its order (each line a
 * baseline, top to bottom), with each " | " cell placed in its panel's column: I introduction,
 * G/g General Fees name/amount, A/a Account Fees name/amount, E/e Electronic Funds Transfers
 * name/amount. Cells the stored text joined with a space (close together) are split only where a
 * name meets its amount. The coordinates are a plausible tri-fold geometry, not the PDF's own.
 */
const MOUNTAIN_STAR_LINES: Array<Array<[string, string]>> = [
  [["G", "General Fees"], ["g", "Amount"], ["A", "Account Fees"], ["a", "Amount"], ["E", "Electronic Funds"], ["e", "Amount"]],
  [["I", "The fee structure at"], ["E", "Transfers"]],
  [["I", "Mountain Star Federal"], ["G", "Address Correction"], ["g", "$5.00"], ["E", "Check Cashing"]],
  [["e", "3.00"]],
  [["I", "Credit Union ensures that"], ["G", "Fee"], ["E", "Foreign"], ["e", "$1.50 ea."]],
  [["A", "Check cashing fee"], ["E", "ATM Transactions"]],
  [["I", "only members using our"], ["G", "Account Research"], ["g", "$10.00"]],
  [["A", "(non-member"], ["a", "$10.00"]],
  [["I", "special services will be"], ["g", "Per hour"], ["A", "Mountain Star"], ["a", "Per item"], ["E", "International"]],
  [["e", "1% of"]],
  [["I", "charged accordingly - not"], ["A", "check)"], ["E", "Transaction Fee"], ["e", "amount"]],
  [["G", "Cashier's Check"], ["g", "$5.00 ea."]],
  [["I", "the entire membership."], ["A", "Club Acct."]],
  [["a", "$10.00"]],
  [["I", "These fees are necessary to"], ["G", "Checkbook"], ["g", "$20.00/ hr."], ["A", "withdrawals"], ["E", "NSF Debit Card"], ["e", "$10.00"]],
  [["I", "recover the costs of"], ["G", "Balancing"], ["A", "Debit /ATM"]],
  [["A", "Card"], ["a", "$5.00"], ["E", "Wires"]],
  [["I", "providing such special"], ["G", "Coin Deposit"], ["g", "5% of"]],
  [["I", "services, while maintaining"], ["A", "Replacement"], ["E", "Incoming"], ["e", "$5.00"]],
  [["g", "total"], ["A", "Dormant"]],
  [["I", "competitive rates for loans"], ["A", "Account fee at"]],
  [["G", "CU Check"], ["g", "$1.00 ea."], ["a", "$15.00"], ["E", "International"], ["e", "$35.00"]],
  [["I", "and dividends for all of our"], ["A", "time of"]],
  [["I", "members."], ["G", "Daily Transaction"], ["g", "$1.00/ pg."], ["A", "escheatment"], ["E", "Outgoing"], ["e", "$20.00"]],
  [["G", "Copies"], ["A", "*Inactive"]],
  [["a", "$10.00"]],
  [["A", "account fee"]],
  [["G", "Mailed paper"], ["g", "$1.00"]],
  [["G", "statement"], ["A", "Instant Issue"], ["E", "Other Free Services: Anytime, Notary"]],
  [["a", "$10.00"], ["E", "Service, Signature Guarantee, Unlimited"]],
  [["A", "Debit Card"]],
  [["G", "Membership Fee"], ["g", "$3.00"], ["E", "Check Writing, Balance Inquiries,"]],
  [["G", "Money market"], ["E", "Fax Service"]],
  [["g", "$5.00"]],
  [["G", "excess check"]],
  [["G", "Money Orders"], ["g", "$.75 ea."]],
  [["G", "NSF Check"], ["g", "$30.00"]],
  [["G", "Phone Transfer"], ["g", "NO FEE"], ["E", "*Note: All check copies can be"]],
  [["G", "NSF ACH"], ["g", "$30.00"], ["E", "retrieved free of charge online at"]],
  [["I", "Main Office:"], ["G", "Gift Card"], ["g", "$4.00"], ["A", "Overdraft"], ["E", "www.mountainstarfcu.org"]],
  [["I", "2229 E. Yandell"], ["A", "Privilege"], ["a", "$30.00"], ["E", "*Inactive account is more than"]],
  [["I", "El Paso, TX 79903"], ["A", "Protection"], ["E", "one year without activity."]],
  [["G", "Skip-a-payment"], ["g", "$25.00"]],
  [["A", "Overdraft"], ["E", "Regulation D Regarding"]],
  [["a", "$3.00"]],
  [["A", "Protection"], ["E", "Overdraft"]],
  [["G", "Temporary Checks"], ["g", "$5.00"]],
  [["G", "(4checks)"], ["A", "Reprint Monthly"]],
  [["a", "$5.00"], ["E", "Under Federal Regulation, only 6"]],
  [["A", "Statements"]],
  [["E", "(six) unsigned and/or automatic"]],
  [["G", "Verification of"], ["g", "$15.00"], ["A", "Returned"], ["E", "transfers may be made from a"]],
  [["G", "Deposit"], ["A", "Deposited"], ["a", "$20.00"], ["E", "savings account each month. This"]],
  [["A", "Check"], ["E", "includes telephone transfers,"]],
  [["g", "$2.00 each"], ["E", "automatic overdrafts from savings"]],
  [["G", "Savings"]],
  [["g", "after 4 with-"], ["E", "or line of credit, audio response"]],
  [["G", "Withdrawal Fee"], ["g", "drawals"]],
  [["E", "transfers, and internet transfers."]],
  [["A", "Second Chance"], ["a", "$10.00"], ["E", "Keep this in mind when depositing"]],
  [["I", "Las Cruces:"], ["A", "Checking"], ["a", "monthly"], ["E", "to checking or savings. If you are"]],
  [["I", "210 E. Idaho Ave."], ["E", "over the 6 (six) transfer maximum,"]],
  [["G", "Share Draft"], ["E", "your check(s) may be returned NDF"]],
  [["I", "Las Cruces, NM 88005"], ["g", "$2.00"], ["E", "even if you have funds available in"]],
  [["G", "Copy"]],
  [["E", "your savings or your line of credit."]],
  [["I", "Phone: 915-544-2215"], ["G", "Stop Payment"], ["g", "$20.00"]],
  [["I", "Fax: 915-533-1862"]],
  [["I", "www.mountainstarfcu.org"], ["E", "Effective January 1, 2026"]],
];
const MOUNTAIN_STAR_X: Record<string, number> = { I: 36, G: 170, g: 290, A: 370, a: 470, E: 560, e: 700 };
/** Stored lines sit 7 points apart: farther than the 4-point baseline tolerance at 8-point type. */
const MOUNTAIN_STAR_PITCH = 7;

function mountainStarPage(): PdfTextItem[] {
  return MOUNTAIN_STAR_LINES.flatMap((cells, index) =>
    cells.map(([column, text]) => item(text, MOUNTAIN_STAR_X[column], 600 - index * MOUNTAIN_STAR_PITCH)));
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
    expect(at("Address Correction | $5.00")).toBeGreaterThan(at("www.mountainstarfcu.org"));
    expect(at("Account Fees | Amount")).toBeGreaterThan(at("Stop Payment | $20.00"));
    expect(at("Electronic Funds | Amount")).toBeGreaterThan(at("Second Chance | $10.00"));
    for (const pair of ["NSF Check | $30.00", "Privilege | $30.00", "International | $35.00", "Account Research | $10.00",
      "Account fee at time of | $15.00", "Outgoing | $20.00"]) {
      expect(text).toContain(pair);
    }
    // No line joins two tables.
    expect(text.some((line) => /Money Orders|NSF Check|Gift Card/.test(line) && /Overdraft|Reprint|Regulation|www/.test(line))).toBe(false);
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

  // Review of #2948: a wide table's right-hand columns form a block with an amount strip of its
  // own (Conditions | Cap), but every one of its lines sits on a row of the left block. One row
  // grid is one table: no split, every row whole.
  const conditions = ["Under $500 balance", "Max 4 a day", "Plus courier", "Rush extra", "Online only", "Over 5 items",
    "Waived for seniors", "Rush extra", "Per hour", "After 12 months", "Over 100 coins", "Members only"];
  const services = ["Monthly maintenance", "ATM withdrawal", "Cashier's check", "Wire outgoing", "Stop payment", "Overdraft",
    "Paper statement", "Card replacement", "Account research", "Dormant account", "Coin counting", "Notary"];

  it("keeps a Service | Fee | Conditions | Cap table whole: its columns share one row grid", () => {
    const items = services.flatMap((name, index) => [
      item(name, 40, 700 - index * 14), item(`$${5 + index}.00`, 200, 700 - index * 14),
      item(conditions[index], 300, 700 - index * 14), item(`$${100 + index * 10}.00`, 460, 700 - index * 14),
    ]);
    const result = layoutPageResult(items);
    expect(result.tableColumns).toBe(false);
    services.forEach((name, index) => expect(lines(result.text))
      .toContain(`${name} | $${5 + index}.00 | ${conditions[index]} | $${100 + index * 10}.00`));
    expect(lines(result.text).some((line) => line.startsWith(conditions[0]))).toBe(false);
  });

  it("keeps a five-column table whole, with a wrapped condition and an empty cap", () => {
    const items = services.flatMap((name, index) => {
      const y = 700 - index * 20;
      return [
        item(name, 40, y), item(`$${5 + index}.00`, 180, y), item(conditions[index], 260, y),
        ...(index % 4 === 3 ? [] : [item(`$${100 + index * 10}.00`, 400, y)]),
        item(index % 2 ? "Monthly" : "Each", 480, y),
        // A long condition wraps onto a line of its own between rows.
        ...(index % 3 === 0 ? [item("see disclosure", 260, y - 9)] : []),
      ];
    });
    const result = layoutPageResult(items);
    expect(result.tableColumns).toBe(false);
    expect(lines(result.text)).toContain(`${services[1]} | $6.00 | ${conditions[1]} | $110.00 | Monthly`);
    expect(lines(result.text)).toContain(`${services[3]} | $8.00 | ${conditions[3]} | Monthly`);
  });

  it("keeps two side-by-side tables on one row grid in the row reading, each pair intact", () => {
    // Aligned panels read across still give each name its own amount; only independent grids,
    // where a label meets another table's lone amount, need the split.
    const items = [
      ...leftNames.flatMap((name, index) => leftRow(700 - index * 14, name, `$${30 + index}.00`)),
      ...rightNames.flatMap((name, index) => rightRow(700 - index * 14, name, `$${10 + index}.00`)),
    ];
    const result = layoutPageResult(items);
    expect(result.tableColumns).toBe(false);
    leftNames.forEach((name, index) => expect(result.text).toContain(`${name} | $${30 + index}.00 | ${rightNames[index]} | $${10 + index}.00`));
  });

  it("does not join a row that states its own price word to the label above it", () => {
    const items = [
      ...leftNames.flatMap((name, index) => leftRow(700 - index * 14, name, `$${30 + index}.00`)),
      ...rightNames.flatMap((name, index) => rightRow(700 - index * 17, name, `$${10 + index}.00`)),
      item("Bill pay", 40, 580), item("$3.00", 220, 575), item("eStatements (free)", 40, 570),
    ];
    const text = lines(layoutPageText(items));
    expect(text).not.toContain("Bill pay eStatements (free) | $3.00");
    expect(text).toContain("eStatements (free)");
  });

  it("does not glue a heading onto its first row, or two labels of one merged cell", () => {
    const amounts = (x: number) => leftNames.flatMap((name, index) => [item(name, 40, 700 - index * 14), item(`$${30 + index}.00`, x, 700 - index * 14)]);
    const items = [
      ...amounts(220),
      ...rightNames.flatMap((name, index) => rightRow(700 - index * 17, name, `$${10 + index}.00`)),
      // A heading with no row of its own, and the amount of the row below set midway.
      item("Electronic Services", 40, 580), item("$3.00", 220, 575), item("Bill pay", 40, 570),
      // One amount cell merged across two labelled rows.
      item("Overdraft (paid)", 320, 540), item("$30.00", 520, 535), item("NSF (returned)", 320, 530),
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
      ...rightNames.flatMap((name, index) => rightRow(700 - index * 17, name, `$${10 + index}.00`)),
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
      ...rightNames.flatMap((name, index) => rightRow(700 - index * 17, name, `$${5 + index}.00`)),
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
      ...rightNames.flatMap((name, index) => rightRow(700 - index * 17, name, `$${10 + index}.00`)),
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
