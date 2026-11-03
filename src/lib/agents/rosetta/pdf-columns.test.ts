import { describe, expect, it } from "vitest";

import { PDF_COLUMN_READING_LIVE, rowStartShare } from "./pdf-columns";
import { pageGutters, positioned } from "./pdf-geometry";
import { layoutDocumentText, layoutPageResult, layoutPageText, type PdfTextItem } from "./pdf-layout";

/**
 * Near misses for independent PDF columns (#1092, class R4), on synthetic pages built from
 * positioned text runs: the pdf.js items pdf-layout reads. A run is 4 points a character wide at
 * an 8-point font, so a 30-character line is 120 points wide. The switch is held on with
 * `columnReading: true`; every refusal is checked against the switch-off reading, unchanged.
 */

const SIZE = 8;
const CHAR = 4;
const PITCH = 12;
const TOP = 700;

function run(str: string, x: number, y: number, size = SIZE): PdfTextItem {
  return { str, transform: [size, 0, 0, size, x, y], width: str.length * (size / 2), height: size };
}

/** A run drawn rotated a quarter turn (a landscape table printed on a portrait page). */
function rotated(str: string, x: number, y: number): PdfTextItem {
  return { str, transform: [0, SIZE, -SIZE, 0, x, y], width: str.length * CHAR, height: SIZE };
}

const on = (items: PdfTextItem[]) => layoutPageResult(items, { columnReading: true }).text;
const off = (items: PdfTextItem[]) => layoutPageResult(items, { columnReading: false }).text;
const linesOf = (text: string) => text.split("\n");
const y = (row: number, top = TOP, pitch = PITCH) => top - row * pitch;
/** The highest block-start share over the page's gutters (`rowStartShare`), rounded to two places. */
const topShare = (items: PdfTextItem[]) => {
  const gutters = pageGutters(positioned(items));
  const shares = gutters ? gutters.middles.map((middle) => rowStartShare(gutters.items, middle)) : [0];
  return Math.round(Math.max(...shares) * 100) / 100;
};

const LEFT_FEES = [
  ["Overdraft item", "$35.00"], ["Returned item", "$30.00"], ["Stop payment", "$25.00"],
  ["Cashier's check", "$8.00"], ["Money order", "$3.00"], ["Wire outgoing", "$25.00"],
  ["Wire incoming", "$15.00"], ["Account research", "$20.00"], ["Statement copy", "$5.00"],
  ["Check image", "$2.00"], ["Dormant account", "$5.00"], ["Account closing", "$25.00"],
  ["Garnishment", "$100.00"], ["Levy", "$100.00"], ["Notary service", "Free"], ["Coin counting", "$3.00"],
] as const;
const RIGHT_FEES = [
  ["Debit card replacement", "$10.00"], ["Rush card delivery", "$50.00"], ["PIN change", "$2.00"],
  ["Safe deposit 3 x 5", "$30.00"], ["Safe deposit 5 x 10", "$50.00"], ["Box drilling", "$200.00"],
  ["Lost key", "$25.00"], ["Fax per page", "$1.00"], ["Photocopy", "$0.25"],
  ["Bill pay expedited", "$9.95"], ["External transfer", "$3.00"], ["Foreign check", "$10.00"],
  ["Collection item", "$30.00"], ["Return mail", "$5.00"], ["Overdraft transfer", "$10.00"], ["ATM inquiry", "$1.50"],
] as const;

const leader = ([name, price]: readonly [string, string]) => `${name} ${".".repeat(24 - name.length)} ${price}`;
/** A fee line with no dot leaders (pdf-layout v4 reads dot-leader lists beside a table already). */
const feeLine = ([name, price]: readonly [string, string]) => `${name} ${price}`;

type Placed = string | readonly [string, string];
/** A line as the reader writes it: a plain line, or a label and its price in their own cells. */
const placedText = (line: Placed) => (typeof line === "string" ? line : `${line[0]} | ${line[1]}`);
/** Runs for lines down a column at `x`; a [label, price] pair puts the price `cell` points right. */
const place = (lines: readonly Placed[], x: number, offset = 0, cell = 110) =>
  lines.flatMap((line, row) => (typeof line === "string"
    ? [run(line, x, y(row) - offset)]
    : [run(line[0], x, y(row) - offset), run(line[1], x + cell, y(row) - offset)]));

/**
 * Two fee lists, one per column, on the same baselines unless `offset` moves the right one: the
 * left list "Label $X", the right one a list of its own label | price cells. (Fee lines beside fee
 * lines on shared baselines read like a table's notes column, so they keep their rows.)
 */
function twoLeaderLists(rows = 16, offset = 0, rightX = 320): { items: PdfTextItem[]; left: string[]; right: string[] } {
  const leftRows = LEFT_FEES.slice(0, rows);
  const rightRows = RIGHT_FEES.slice(0, rows);
  const items = [...place(leftRows, 40, 0, 100), ...place(rightRows, rightX, offset)];
  return { items, left: leftRows.map(placedText), right: rightRows.map(placedText) };
}

/** Each half's own page number, one line below `rows` lines: facing pages' furniture. */
const folios = (rows: number, rightX: number): PdfTextItem[] => [run("22", 40, y(rows + 1)), run("23", rightX, y(rows + 1))];

/** A label | price table: labels at `labelX`, prices at `priceX`, one row per baseline. */
function labelPriceTable(rows: ReadonlyArray<readonly [string, string]>, labelX = 40, priceX = 300, top = TOP): PdfTextItem[] {
  return rows.flatMap(([label, price], row) => [run(label, labelX, y(row, top)), run(price, priceX, y(row, top))]);
}

const PROSE = [
  "If your account is overdrawn we may charge a fee",
  "for each item we pay; the entire balance of your",
  "account may not be available for withdrawal. We",
  "may refuse any item for which there are not enough",
  "funds available at the time the item is presented.",
  "You agree to pay any fee we charge as set out in",
  "the schedule of fees and charges for this account",
  "and you agree that we may change it with notice.",
  "Dividends are paid from current income and are not",
  "guaranteed; the rate may change at any time after",
  "the account is opened. Accrual begins on the day",
  "of deposit for cash and for checks the day we get",
  "provisional credit for them from the paying bank.",
  "Transfers to another account are limited to six a",
  "month by preauthorized order, by phone or by card.",
  "Please see the rate schedule for current rates now.",
];

const prose = (x: number, rows = 16, top = TOP, offset = 0) =>
  PROSE.slice(0, rows).map((text, row) => run(text, x, y(row, top) - offset));

describe("Rosetta pdf-columns: independent columns (PDF_COLUMN_READING_LIVE)", () => {
  describe("reads a page set in independent columns column by column", () => {
    it("should_read_two_dot_leader_fee_lists_column_by_column", () => {
      const { items, left, right } = twoLeaderLists();
      expect(linesOf(off(items))[0]).toBe(`${left[0]} | ${right[0]}`);
      expect(linesOf(on(items))).toEqual([...left, ...right]);
    });

    it("should_read_two_fee_lists_whose_baselines_do_not_line_up", () => {
      const { items, left, right } = twoLeaderLists(16, 5);
      expect(linesOf(on(items))).toEqual([...left, ...right]);
    });

    it("should_read_two_label_price_tables_set_side_by_side", () => {
      const items = [
        ...labelPriceTable(LEFT_FEES, 40, 160),
        ...labelPriceTable(RIGHT_FEES, 330, 450),
      ];
      const lines = linesOf(on(items));
      expect(lines.slice(0, 16)).toEqual(LEFT_FEES.map(([label, price]) => `${label} | ${price}`));
      expect(lines.slice(16)).toEqual(RIGHT_FEES.map(([label, price]) => `${label} | ${price}`));
      expect(linesOf(off(items))[14]).toBe("Notary service | Free | Overdraft transfer | $10.00");
    });

    it("should_read_prose_beside_a_fee_table_on_facing_pages_column_by_column", () => {
      const items = [...prose(40), ...labelPriceTable(LEFT_FEES, 280, 380, TOP - 4), ...folios(16, 280)];
      const lines = linesOf(on(items));
      expect(lines.slice(0, 17)).toEqual([...PROSE, "22"]);
      expect(lines.slice(17)).toEqual([...LEFT_FEES.map(([label, price]) => `${label} | ${price}`), "23"]);
    });

    it("should_keep_prose_beside_a_fee_table_without_evidence_the_two_are_independent", () => {
      const items = [...prose(40), ...labelPriceTable(LEFT_FEES, 260, 360, TOP - 4)];
      expect(on(items)).toBe(off(items));
    });


    it("should_read_two_columns_of_account_terms_that_state_prices_in_their_sentences", () => {
      const terms = (name: string, amount: number) => [
        `${name} CHECKING`,
        "Minimum to open account $100",
        "Maintenance Fee: No maintenance fee with a",
        `minimum daily balance of $${amount},000. If the`,
        `balance falls below it, $${amount}5 will be charged`,
        "per monthly statement cycle.",
      ];
      const left = [...terms("BASIC", 1), ...terms("PREMIER", 2), ...terms("SENIOR", 3)];
      const right = [...terms("BUSINESS", 4), ...terms("ANALYSIS", 5), ...terms("NONPROFIT", 6)];
      const items = [...left.map((text, row) => run(text, 40, y(row))), ...right.map((text, row) => run(text, 320, y(row))), ...folios(18, 320)];
      expect(linesOf(on(items))).toEqual([...left, "22", ...right, "23"]);
    });

    it("should_read_a_full_width_title_first_then_each_column", () => {
      const { items, left, right } = twoLeaderLists(16, 0);
      const title = run("SCHEDULE OF FEES AND SERVICE CHARGES FOR PERSONAL ACCOUNTS", 60, TOP + 20);
      expect(linesOf(on([title, ...items]))).toEqual([title.str, ...left, ...right]);
    });

    it("should_close_the_columns_above_a_full_width_heading_in_the_middle", () => {
      const top = twoLeaderLists(16, 0);
      const heading = run("FEES FOR BUSINESS ACCOUNTS AND TREASURY MANAGEMENT SERVICES", 60, y(16) - 4);
      const lower = [
        ...LEFT_FEES.slice(0, 8).map((fee, row) => run(feeLine(fee), 40, y(row, y(17) - 8))),
        ...RIGHT_FEES.slice(0, 8).map((fee, row) => run(feeLine(fee), 320, y(row, y(17) - 8))),
      ];
      const lines = linesOf(on([...top.items, heading, ...lower]));
      expect(lines.slice(0, 32)).toEqual([...top.left, ...top.right]);
      expect(lines[32]).toBe(heading.str);
      expect(lines.slice(33)).toEqual([...LEFT_FEES.slice(0, 8).map(feeLine), ...RIGHT_FEES.slice(0, 8).map(feeLine)]);
    });

    it("should_find_the_columns_above_footnotes_that_span_the_page", () => {
      const { items, left, right } = twoLeaderLists(16, 0);
      // More footnote lines than a page-wide gutter may be crossed by: the region above them splits.
      const notes = Array.from({ length: 4 }, (_, index) =>
        run(`${index + 1}. This fee is waived for accounts opened under the student program, see terms.`, 40, y(17 + index)));
      expect(linesOf(off([...items, ...notes]))[0]).toBe(`${left[0]} | ${right[0]}`);
      expect(linesOf(on([...items, ...notes]))).toEqual([...left, ...right, ...notes.map((note) => note.str)]);
    });

    it("should_read_columns_between_a_title_and_footnotes", () => {
      const { items, left, right } = twoLeaderLists(16, 0);
      const title = run("CONSUMER ACCOUNT FEES AND SERVICE CHARGES  EFFECTIVE 2026", 40, TOP + 24);
      const notes = Array.from({ length: 3 }, (_, index) =>
        run(`${index + 1}. Applies to consumer checking and savings accounts only, see your agreement.`, 40, y(17 + index)));
      expect(linesOf(on([title, ...items, ...notes]))).toEqual([title.str, ...left, ...right, ...notes.map((note) => note.str)]);
    });

    it("should_keep_a_strip_of_bullets_with_the_column_it_marks", () => {
      const left = PROSE.map((text, row) => run(text, 40, y(row)));
      const bullets = PROSE.map((_, row) => run("•", 300, y(row)));
      const right = [...RIGHT_FEES.map((fee, row) => run(feeLine(fee), 316, y(row))), ...folios(16, 316)];
      const lines = linesOf(on([...left, ...bullets, ...right]));
      expect(lines.slice(0, 17)).toEqual([...PROSE, "22"]);
      expect(lines.slice(17)).toEqual([...RIGHT_FEES.map((fee) => `• ${feeLine(fee)}`), "23"]);
    });

    it("should_read_a_booklet_spread_of_two_pages_printed_on_one_sheet", () => {
      const left = [...LEFT_FEES.slice(0, 8).map(feeLine), ...PROSE.slice(0, 8)];
      const right: Placed[] = [...RIGHT_FEES.slice(0, 8), ...PROSE.slice(8)];
      const items = [...place(left, 40), ...place(right, 330), ...folios(16, 330)];
      expect(linesOf(on(items))).toEqual([...left, "22", ...right.map(placedText), "23"]);
    });

    it("should_read_a_landscape_page_with_two_fee_tables", () => {
      const items = [...labelPriceTable(LEFT_FEES, 40, 260, 560), ...labelPriceTable(RIGHT_FEES, 420, 680, 560)];
      const lines = linesOf(on(items));
      expect(lines[0]).toBe("Overdraft item | $35.00");
      expect(lines[16]).toBe("Debit card replacement | $10.00");
    });

    it("should_read_three_independent_fee_lists_as_three_columns", () => {
      const a = LEFT_FEES.slice(0, 12);
      const b = RIGHT_FEES.slice(0, 12);
      const c = [...LEFT_FEES.slice(4, 12)];
      const items = [...place(a, 20, 0, 85), ...place(b, 170, 0, 95), ...place(c, 320, 0, 80)]
        .map((item) => ({ ...item, width: item.width * 0.9 }));
      expect(linesOf(on(items))).toEqual([...a.map(placedText), ...b.map(placedText), ...c.map(placedText)]);
    });

    it("should_keep_a_heading_inside_a_column_above_its_own_rows", () => {
      const left = ["Photocopies", "Per statement ......... $5.00", "Per check ............. $1.00", "Wire transfers",
        "Customer incoming ..... no charge", "Customer outgoing ..... $25.00", ...LEFT_FEES.slice(0, 10).map(feeLine)];
      const right: Placed[] = ["WEST BRANCH", "2300 HWY 190 WEST", "LIVINGSTON, TEXAS", "(936) 327-5211", "Member FDIC",
        ...RIGHT_FEES.slice(0, 11)];
      const items = [...place(left, 40), ...place(right, 330), ...folios(16, 330)];
      const lines = linesOf(on(items));
      expect(lines.slice(0, 6)).toEqual(left.slice(0, 6));
      expect(linesOf(off(items))[3]).toBe("Wire transfers | (936) 327-5211");
    });

    it("should_keep_a_wrapped_label_with_its_price_line_inside_its_column", () => {
      const left = ["ATM services at non-Credit Union", "and non-network locations $ .25 per inquiry",
        ...LEFT_FEES.slice(0, 14).map(feeLine)];
      const items = [...place(left, 40), ...place(RIGHT_FEES, 330), ...folios(16, 330)];
      expect(linesOf(on(items)).slice(0, 2)).toEqual(left.slice(0, 2));
    });

    it("should_read_columns_whose_right_rows_open_with_a_box_size", () => {
      const sizes = ["2 x 5", "3 x 5", "3 x 10", "5 x 5", "5 x 10", "7 x 10", "10 x 10", "13 x 10", "18 x 11", "36 x 11",
        "Late fee", "Lost key", "Drilling", "Key deposit", "Box rent", "Box transfer"];
      const right = sizes.flatMap((size, row) => [run(size, 330, y(row)), run(`$ ${45 + row}.00`, 470, y(row))]);
      const lines = linesOf(on([...labelPriceTable(LEFT_FEES, 40, 200), ...right]));
      expect(lines[16]).toBe("2 x 5 | $ 45.00");
      expect(lines[21]).toBe("7 x 10 | $ 50.00");
    });

    it("should_split_table_rows_from_a_label_price_table_on_the_same_baselines", () => {
      const items = [...labelPriceTable(LEFT_FEES, 40, 180), ...labelPriceTable(RIGHT_FEES, 300, 450)];
      expect(linesOf(on(items))[0]).toBe("Overdraft item | $35.00");
      expect(linesOf(on(items))[16]).toBe("Debit card replacement | $10.00");
    });
  });

  describe("keeps a fee table row by row", () => {
    it("should_keep_a_label_and_price_table_row_by_row", () => {
      const items = labelPriceTable(LEFT_FEES).concat(labelPriceTable(RIGHT_FEES, 40, 300, y(16)));
      expect(on(items)).toBe(off(items));
      expect(linesOf(on(items))[0]).toBe("Overdraft item | $35.00");
    });

    it("should_keep_a_table_whose_prices_are_words", () => {
      const rows = LEFT_FEES.map(([label], row) => [label, ["Free", "No charge", "N/A", "Waived"][row % 4]] as const);
      const items = [...labelPriceTable(rows), ...labelPriceTable(rows, 40, 300, y(16))];
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_table_whose_price_cells_carry_terms", () => {
      const rows = LEFT_FEES.map(([label, price]) => [label, `${price} per item, each presentment`] as const);
      const items = [...labelPriceTable(rows), ...labelPriceTable(rows, 40, 300, y(16))];
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_label_table_with_two_price_columns", () => {
      const items = LEFT_FEES.flatMap(([label, price], row) => [
        run(`${label} for personal accounts`, 40, y(row)), run(price, 250, y(row)), run(`$${row + 10}.00`, 400, y(row)),
      ]);
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_tier_table_with_five_close_price_columns", () => {
      const items = LEFT_FEES.flatMap(([label], row) => [
        run(label, 52, y(row)),
        ...[241, 291, 335, 378, 422].map((x, column) => run(column === 0 ? "FREE" : `$${row + column}`, x, y(row))),
      ]);
      const header = [run("PLATINUM", 222, TOP + 30), run("Combined loan and deposit balance of $50,000 or more", 277, TOP + 30)];
      const notes = Array.from({ length: 6 }, (_, row) =>
        run(`Tier ${row} requires a combined balance of $${row}0,000 or more`, 277, TOP + 40 + row * PITCH));
      expect(on([...header, ...notes, ...items])).toBe(off([...header, ...notes, ...items]));
    });

    it("should_keep_a_service_description_and_fee_table", () => {
      const items = LEFT_FEES.flatMap(([label, price], row) => [
        run(label, 40, y(row)), run("Charged when the service is requested", 140, y(row)), run(price, 330, y(row)),
      ]);
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_price_first_table", () => {
      const items = LEFT_FEES.flatMap(([label, price], row) => [run(price, 40, y(row)), run(`${label} fee charged`, 200, y(row))]);
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_table_with_right_aligned_prices", () => {
      const items = LEFT_FEES.flatMap(([label, price], row) => [
        run(label, 40, y(row)), run(price, 360 - price.length * CHAR, y(row)),
      ]);
      expect(on([...items, ...items.map((item) => ({ ...item, transform: [...item.transform.slice(0, 5), item.transform[5] - 200] }))]))
        .toBe(off([...items, ...items.map((item) => ({ ...item, transform: [...item.transform.slice(0, 5), item.transform[5] - 200] }))]));
    });

    it("should_keep_a_table_under_a_full_width_heading", () => {
      const heading = run("SCHEDULE OF FEES AND CHARGES FOR ALL CONSUMER DEPOSIT ACCOUNTS", 40, TOP + 20);
      const items = [heading, ...labelPriceTable(LEFT_FEES), ...labelPriceTable(RIGHT_FEES, 40, 300, y(16))];
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_table_with_wide_labels_and_a_price_column_at_the_edge", () => {
      const rows = LEFT_FEES.map(([label, price]) => [`${label} charged on consumer and business accounts`, price] as const);
      const items = [...labelPriceTable(rows, 40, 420), ...labelPriceTable(rows, 40, 420, y(16))];
      expect(on(items)).toBe(off(items));
    });

    it("should_refuse_when_one_row_reaches_across_with_its_price_at_the_right_edge", () => {
      const { items } = twoLeaderLists(16, 0);
      const row = [run("Returned deposit item", 40, y(16)), run("$12.00", 320, y(16))];
      expect(on([...items, ...row])).toBe(off([...items, ...row]));
    });

    it("should_refuse_when_a_bare_price_on_the_left_faces_its_label", () => {
      const { items } = twoLeaderLists(16, 0);
      const row = [run("$12.00", 40, y(16)), run("Returned deposit item", 320, y(16))];
      expect(on([...items, ...row])).toBe(off([...items, ...row]));
    });

    it("should_refuse_when_a_label_runs_into_the_gutter_with_its_price_just_past_it", () => {
      const { items } = twoLeaderLists(16, 0);
      const row = [run("Overdraft protection transfer from", 40, y(16)), run("$10.00", 320, y(16))];
      expect(on([...items, ...row])).toBe(off([...items, ...row]));
    });

    it("should_refuse_when_the_right_side_is_a_column_of_tier_prices_set_in_from_its_edge", () => {
      const left = LEFT_FEES.map((fee, row) => run(feeLine(fee), 40, y(row)));
      const right = LEFT_FEES.flatMap((_, row) => [run(`$${row}`, 300, y(row)), run(`$${row + 1}`, 340, y(row))]);
      const descriptions = PROSE.slice(0, 3).map((text, row) => run(text, 280, TOP + 40 + row * PITCH));
      expect(on([...left, ...right, ...descriptions])).toBe(off([...left, ...right, ...descriptions]));
    });

    // Review of #2965: a third column of notes is the table's own cell, though no note opens with a
    // price and the notes, read alone, look like a list of their own ("Daily maximum $150").
    const NOTED_ROWS = [
      ["Overdraft fee (per item)", "$30.00", "Daily maximum $150"], ["Returned item (NSF)", "$30.00", "Daily maximum $150"],
      ["Outgoing domestic wire", "$25.00", "International wire $45"], ["Incoming wire", "$10.00", "International incoming $15"],
      ["Stop payment", "$25.00", "Online request $15"], ["Account research", "$25.00", "Minimum charge $10"],
      ["Cashier's check", "$8.00", "Members only"], ["Money order", "$3.00", "Limit 5 per day"],
      ["Statement copy", "$5.00", "Online statements free"], ["Debit card replacement", "$10.00", "Rush delivery $50"],
      ["Dormant account", "$5.00", "After 12 months"], ["Account closing", "$25.00", "Within 90 days"],
      ["Garnishment / levy", "$100.00", "Per order"], ["Coin counting", "$3.00", "Non-members 5% of total"],
      ["Safe deposit box 3x5", "$30.00", "Late payment $10"], ["Check printing", "Varies", "Depends on style"],
    ] as const;

    it("should_keep_a_service_fee_and_notes_table_row_by_row", () => {
      const items = [run("Service", 40, y(0)), run("Fee", 180, y(0)), run("Notes", 270, y(0)),
        ...NOTED_ROWS.flatMap(([label, price, note], row) => [run(label, 40, y(row + 1)), run(price, 180, y(row + 1)), run(note, 270, y(row + 1))])];
      expect(on(items)).toBe(off(items));
      expect(linesOf(on(items))[1]).toBe("Overdraft fee (per item) | $30.00 | Daily maximum $150");
    });

    it("should_keep_table_rows_beside_single_cell_fee_lines_that_could_be_its_notes", () => {
      // "Debit card replacement $10.00" beside "Overdraft item | $35.00" reads like a notes cell.
      const items = [...labelPriceTable(LEFT_FEES, 40, 180), ...RIGHT_FEES.map((fee, row) => run(feeLine(fee), 300, y(row)))];
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_notes_column_whose_notes_are_long_lines", () => {
      const note = (text: string) => `${text}; ask a banker for the full details today`.slice(0, 40);
      const items = NOTED_ROWS.flatMap(([label, price, text], row) => [run(label, 40, y(row)), run(price, 180, y(row)), run(note(text), 240, y(row))]);
      expect(on(items)).toBe(off(items));
    });

    // Second review of #2965: block starts, not line counts. A wrapped description is one block,
    // and every block of a table's notes or descriptions starts on its row.
    const tableRows = (rows: ReadonlyArray<readonly [string, string, ...unknown[]]>, step = 1) =>
      rows.flatMap(([label, price], row) => [run(label, 40, y(row * step)), run(price, 180, y(row * step))]);

    it("should_keep_a_table_whose_descriptions_wrap_onto_three_lines", () => {
      const described = [
        ["Overdraft fee (per item)", "$30.00", ["Daily maximum $150; charged for each", "item we pay into a negative balance", "on your checking account"]],
        ["Returned item (NSF)", "$30.00", ["Daily maximum $150; charged for each", "item we return unpaid for lack of", "available funds"]],
        ["Outgoing domestic wire", "$25.00", ["International wire $45; submit the", "request before 2 p.m. for same day", "processing"]],
        ["Account research", "$25.00", ["Minimum charge $10; billed per hour", "of research with a one hour minimum", "for each request"]],
        ["Debit card replacement", "$10.00", ["Rush delivery $50; standard delivery", "takes seven to ten business days", "by mail"]],
        ["Safe deposit box 3x5", "$30.00", ["Late payment $10; rent is due each", "year on the anniversary of the lease", "date"]],
        ["Stop payment", "$25.00", ["Online request $15; each stop lasts", "six months and may be renewed for", "another fee"]],
      ] as const;
      const items = [...tableRows(described, 3),
        ...described.flatMap(([, , lines], row) => lines.map((text, k) => run(text, 270, y(row * 3 + k))))];
      expect(on(items)).toBe(off(items));
      expect(linesOf(on(items))[0]).toBe("Overdraft fee (per item) | $30.00 | Daily maximum $150; charged for each");
    });

    it("should_keep_a_notes_column_of_near_equal_mixed_case_notes", () => {
      const note = (text: string, row: number) =>
        (`${row % 3 === 0 ? `plus ${text.toLowerCase()}` : text} for all accounts at this bank`).slice(0, 34 + (row % 4) * 2);
      const items = [...tableRows(NOTED_ROWS), ...NOTED_ROWS.map(([, , text], row) => run(note(text, row), 270, y(row)))];
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_notes_column_whose_notes_all_start_in_lower_case", () => {
      const note = (text: string, row: number) => (`plus ${text.toLowerCase()} for all accounts at this bank`).slice(0, 34 + (row % 4) * 2);
      const items = [...tableRows(NOTED_ROWS), ...NOTED_ROWS.map(([, , text], row) => run(note(text, row), 270, y(row)))];
      expect(on(items)).toBe(off(items));
      expect(linesOf(on(items))[14]).toContain("Safe deposit box 3x5 | $30.00 | plus late payment $10");
    });

    it("should_keep_prose_set_on_a_fee_tables_own_baselines_as_its_description_column", () => {
      const items = [...labelPriceTable(LEFT_FEES, 40, 140), ...prose(250)];
      expect(on(items)).toBe(off(items));
    });

    // Third review of #2965: a priced row is any left line ending in an amount, cell or not; left
    // lines are grouped into blocks too; a right line faces the nearest left line within half a pitch.
    const notesBeside = (left: (label: string, price: string, row: number) => PdfTextItem[], dy = 0) =>
      NOTED_ROWS.flatMap(([label, price, note], row) => [...left(label, price, row), run(note, 270, y(row) - dy)]);

    it("should_keep_notes_beside_dot_leader_fee_rows", () => {
      const items = notesBeside((label, price, row) => [run(`${label} ${".".repeat(28 - label.length)} ${price}`, 40, y(row))]);
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_notes_beside_fee_rows_joined_by_one_space", () => {
      const items = notesBeside((label, price, row) => [run(`${label} ${price}`, 40, y(row))]);
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_notes_beside_a_price_column_with_dollar_signs_on_some_rows", () => {
      const items = notesBeside((label, price, row) => [run(label, 40, y(row)), run(row % 4 ? price.replace("$", "") : price, 180, y(row))]);
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_descriptions_beside_labels_that_wrap_onto_unpriced_lines", () => {
      const items = NOTED_ROWS.slice(0, 7).flatMap(([label, price, note], row) => [
        run(label, 40, y(row * 3)), run(price, 180, y(row * 3)),
        run("(continued label)", 40, y(row * 3 + 1)), run("see terms", 40, y(row * 3 + 2)),
        run(`${note}; Charged For Each`, 270, y(row * 3)), run("Item We Pay Into A Negative Balance", 270, y(row * 3 + 1)),
        run("On Your Checking Account", 270, y(row * 3 + 2)),
      ]);
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_notes_set_a_little_below_their_rows", () => {
      for (const dy of [4.5, 6]) {
        const items = notesBeside((label, price, row) => [run(label, 40, y(row)), run(price, 180, y(row))], dy);
        expect(on(items), `${dy} pt below`).toBe(off(items));
      }
    });

    it("should_keep_prose_beside_a_fee_table_as_its_description_column", () => {
      const items = [...labelPriceTable(LEFT_FEES, 40, 140), ...PROSE.map((text, row) => run(text, 250, TOP - 6 - row * PITCH))];
      expect(on(items)).toBe(off(items));
    });

    // The threshold sits midway (0.42) between the real splits' highest share (0.34) and the
    // narrowest fee-table shapes the reviews found (0.50); both sides are pinned here.
    it("should_refuse_the_fee_table_shapes_that_score_one_half", () => {
      const headed = NOTED_ROWS.flatMap(([label, price, note], row) => (row % 2
        ? [run(label, 40, y(row)), run(price, 180, y(row)), run(note, 270, y(row))]
        : [run(label.toUpperCase(), 40, y(row)), run(note, 270, y(row)), run(`  ${label}`, 40, y(row + 0.5)), run(price, 180, y(row + 0.5))]));
      const fourColumns = NOTED_ROWS.flatMap(([label, price, note], row) => {
        const split = /^(.*?) (\$[\d.]+)$/.exec(note);
        return [run(label, 40, y(row)), run(price, 180, y(row)),
          ...(split ? [run(split[1], 270, y(row)), run(split[2], 400, y(row))] : [run(note, 270, y(row))])];
      });
      for (const [name, items] of [["sections headed by unpriced rows", headed], ["a four-column table", fourColumns]] as const) {
        expect(topShare(items), name).toBe(0.5);
        expect(on(items), name).toBe(off(items));
      }
    });

    it("should_split_a_page_whose_right_blocks_start_on_priced_rows_a_third_of_the_time", () => {
      // Every third right line is a single cell beside a priced row; the others are fee rows of their own.
      const items = NOTED_ROWS.slice(0, 15).flatMap(([label, price, note], row) => [
        run(label, 40, y(row)), run(price, 180, y(row)),
        ...(row % 3 === 0 ? [run(note, 300, y(row))] : [run(RIGHT_FEES[row][0], 300, y(row)), run(RIGHT_FEES[row][1], 410, y(row))]),
      ]);
      expect(topShare(items)).toBe(0.33);
      expect(on(items)).not.toBe(off(items));
      expect(linesOf(on(items))[0]).toBe("Overdraft fee (per item) | $30.00");
    });

    // Fourth review of #2965: price cells with text after the amount, and notes under a header row.
    // From here a split needs positive evidence (own baselines, facing pages or two tables).
    const notesTable = (price: (p: string, row: number) => string, note: (n: string) => string = (n) => n, header = false) => [
      ...(header ? [run("Service", 40, y(-1)), run("Fee", 180, y(-1)), run("Notes", 270, y(-1))] : []),
      ...NOTED_ROWS.flatMap(([label, p, n], row) => [run(label, 40, y(row)), run(price(p, row), 180, y(row)), run(note(n), 270, y(row))]),
    ];

    it("should_keep_notes_beside_price_cells_with_text_after_the_amount", () => {
      const shapes: Array<[string, (p: string, row: number) => string]> = [
        ["per item paid", (p) => `${p} per item paid`], ["/month", (p) => `${p}/month`], ["footnote digit", (p, row) => `${p} ${row % 3 + 1}`],
        ["(each)", (p) => `${p} (each)`], ["(max 4/day)", (p) => `${p} (max 4/day)`],
      ];
      for (const [name, price] of shapes) {
        const items = notesTable(price);
        expect(on(items), name).toBe(off(items));
      }
    });

    it("should_keep_lower_case_or_parenthesised_notes_under_a_header_row", () => {
      for (const [name, note] of [["parenthesised", (n: string) => `(${n})`], ["lower case", (n: string) => n.toLowerCase()]] as const) {
        const items = notesTable((p) => p, note, true);
        expect(on(items), name).toBe(off(items));
      }
    });

    it("should_keep_a_member_and_non_member_table_whose_second_price_opens_with_words", () => {
      const second = (price: string, row: number) => [`Not available`, `Non-members ${price}`, "Plus surcharge $5"][row % 3];
      const items = [run("Service", 40, y(0)), run("Member", 180, y(0)), run("Non-member", 300, y(0)),
        ...NOTED_ROWS.flatMap(([label, price], row) => [run(label, 40, y(row + 1)), run(price, 180, y(row + 1)), run(second(price, row), 300, y(row + 1))])];
      expect(on(items)).toBe(off(items));
      expect(linesOf(on(items))[2]).toBe("Returned item (NSF) | $30.00 | Non-members $30.00");
    });
  });

  describe("keeps the reading on pages without positive evidence", () => {
    it("should_keep_a_narrow_sidebar_beside_prose", () => {
      const sidebar = ["Call us", "24/7", "Branches", "Online", "Mobile", "ATMs", "Rates", "Fees", "Help", "Hours",
        "Contact", "Careers", "News", "Privacy", "Terms", "Map"].map((text, row) => run(text, 440, y(row)));
      const items = [...prose(40), ...sidebar];
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_narrow_sidebar_of_prices_beside_a_fee_table", () => {
      const sidebar = LEFT_FEES.map(([, price], row) => run(`${price} ea`, 470, y(row)));
      const items = [...labelPriceTable(LEFT_FEES), ...sidebar];
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_column_of_footnote_marks_beside_a_table", () => {
      const marks = LEFT_FEES.map((_, row) => run(`${(row % 6) + 1}`, 340, y(row)));
      const items = [...labelPriceTable(LEFT_FEES), ...marks, ...labelPriceTable(RIGHT_FEES, 40, 300, y(16))];
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_footnotes_set_in_two_columns_under_a_table_row_by_row", () => {
      const table = labelPriceTable(LEFT_FEES, 40, 360);
      const notesLeft = PROSE.slice(0, 4).map((text, row) => run(text, 40, y(17 + row)));
      const notesRight = PROSE.slice(4, 8).map((text, row) => run(text, 300, y(17 + row)));
      const lines = linesOf(on([...table, ...notesLeft, ...notesRight]));
      expect(lines.slice(0, 16)).toEqual(LEFT_FEES.map(([label, price]) => `${label} | ${price}`));
    });

    it("should_keep_a_rotated_page_as_it_reads", () => {
      const items = [...LEFT_FEES.map((fee, row) => rotated(feeLine(fee), 40, y(row))),
        ...RIGHT_FEES.map((fee, row) => rotated(feeLine(fee), 320, y(row)))];
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_wide_landscape_table_row_by_row", () => {
      const items = [...labelPriceTable(LEFT_FEES, 40, 640, 560), ...labelPriceTable(RIGHT_FEES, 40, 640, 560 - 16 * PITCH)];
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_page_with_too_few_text_runs", () => {
      const { items } = twoLeaderLists(7, 0);
      expect(items.length).toBeLessThan(30);
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_columns_too_short_to_tell", () => {
      const { items } = twoLeaderLists(4, 0);
      const filler = PROSE.flatMap((text, row) => [run(text.slice(0, 20), 40, y(5 + row)), run(text.slice(20), 120, y(5 + row))]);
      expect(on([...items, ...filler])).toBe(off([...items, ...filler]));
    });

    it("should_keep_a_column_of_labels_beside_a_column_of_descriptions_with_prices", () => {
      const items = LEFT_FEES.flatMap(([label, price], row) => [
        run(label, 40, y(row)), run(`Charged ${price} each time the service is used`, 200, y(row)),
      ]);
      expect(on(items)).toBe(off(items));
    });

    it("should_keep_a_mixed_page_whose_table_rows_reach_across_the_gutter", () => {
      const table = labelPriceTable(LEFT_FEES.slice(0, 6), 40, 320);
      const below = twoLeaderLists(16, 0);
      const shifted = below.items.map((item) => ({ ...item, transform: [...item.transform.slice(0, 5), item.transform[5] - 6 * PITCH] }));
      expect(on([...table, ...shifted])).toBe(off([...table, ...shifted]));
    });

    it("should_split_only_the_region_below_a_heading_on_a_mixed_page", () => {
      const table = labelPriceTable(LEFT_FEES.slice(0, 6), 40, 320, TOP + 120);
      const heading = run("ADDITIONAL SERVICES AND FEES FOR CHECKING AND SAVINGS ACCOUNTS", 40, TOP + 30);
      const { items, left, right } = twoLeaderLists(16, 0);
      const lines = linesOf(on([...table, heading, ...items]));
      expect(lines.slice(0, 6)).toEqual(LEFT_FEES.slice(0, 6).map(([label, price]) => `${label} | ${price}`));
      expect(lines[6]).toBe(heading.str);
      expect(lines.slice(7)).toEqual([...left, ...right]);
    });

    it("should_leave_prose_columns_to_the_earlier_prose_reading", () => {
      const items = [...prose(40), ...prose(300, 16, TOP, 4)];
      expect(on(items)).toBe(off(items));
      expect(linesOf(off(items)).slice(0, 16)).toEqual(PROSE);
    });

    it("should_leave_a_leader_list_beside_a_table_to_the_earlier_list_reading", () => {
      const table = LEFT_FEES.flatMap(([label], row) => [run(label, 40, y(row)), run("Personal", 130, y(row)), run("Business", 200, y(row))]);
      const list = RIGHT_FEES.map((fee, row) => run(leader(fee), 320, y(row)));
      expect(on([...table, ...list])).toBe(off([...table, ...list]));
    });
  });

  describe("the switch", () => {
    it("should_ship_off", () => {
      expect(PDF_COLUMN_READING_LIVE).toBe(false);
    });

    it("should_read_as_main_by_default", () => {
      const { items } = twoLeaderLists();
      expect(layoutPageResult(items).text).toBe(off(items));
      expect(layoutPageText(items)).toBe(off(items));
      expect(layoutDocumentText([items, items])).toBe(`${off(items)}\n\n${off(items)}`);
    });

    it("should_not_mark_a_column_page_as_a_stacked_list_page", () => {
      const { items } = twoLeaderLists();
      expect(layoutPageResult(items, { columnReading: true }).stackedColumns).toBe(false);
    });
  });
});
