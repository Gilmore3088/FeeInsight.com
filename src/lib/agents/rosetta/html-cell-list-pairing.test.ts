import { describe, expect, it } from "vitest";

import { extractHtmlDomText } from "./html-dom";
import { HTML_CELL_LIST_PAIRING_LIVE, MAX_ITEMS } from "./html-cell-list-pairing";

/**
 * Near misses for `HTML_CELL_LIST_PAIRING_LIVE` (#1092, class R3): a table row's label list and
 * price list pair item for item only when the markup lists both the same way. Each case is
 * synthetic HTML shaped like St. Cloud FCU's fee table (answer key state:9308). A refused row must
 * read byte for byte as it does with the switch off.
 */

function read(html: string, cellListPairing: boolean, rowPairing = false) {
  return extractHtmlDomText(html, { cellListPairing, rowPairing });
}

function lines(html: string, cellListPairing = true): string[] {
  return read(html, cellListPairing)
    .text.split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** The switch refuses: text, row count and stored rows are exactly the switch-off read. */
function expectUnchanged(html: string): void {
  expect(read(html, true)).toEqual(read(html, false));
}

const HEAD = `<thead><tr><th>Service</th><th>Fee</th></tr></thead>`;
const table = (...rows: string[]) => `<main><table>${HEAD}<tbody>${rows.join("")}</tbody></table></main>`;
const ul = (items: string[], tag = "ul") => `<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`;
const listRow = (heading: string, labels: string[], prices: string[]) =>
  `<tr><td><b>${heading}</b><br />${ul(labels)}</td><td><br />${ul(prices)}</td></tr>`;

const SAFE_DEPOSIT = listRow(
  "Safe Deposit Boxes",
  ["3 x 5", "3 x 10", "5 x 10", "10 x 10", "Lost Key", "Drilled Box"],
  ["$18.00 a year", "$30.00 a year", "$40.00 a year", "$80.00 a year", "$25.00", "$250.00"],
);

describe("HTML_CELL_LIST_PAIRING_LIVE switch", () => {
  it("should_ship_off", () => {
    expect(HTML_CELL_LIST_PAIRING_LIVE).toBe(false);
  });

  it("should_leave_the_default_read_unchanged_while_off", () => {
    const html = table(SAFE_DEPOSIT);
    expect(extractHtmlDomText(html)).toEqual(read(html, false));
    expect(lines(html, false)).toContain(
      "Safe Deposit Boxes 3 x 5 3 x 10 5 x 10 10 x 10 Lost Key Drilled Box | $18.00 a year $30.00 a year $40.00 a year $80.00 a year $25.00 $250.00",
    );
  });

  it("should_leave_row_pairing_reads_unchanged_while_off", () => {
    const html = `<div class="row"><div class="col-md-6">Stop payment</div><div class="col-md-6">$30.00</div></div>${table(SAFE_DEPOSIT)}`;
    expect(extractHtmlDomText(html, { rowPairing: true })).toEqual(read(html, false, true));
  });
});

describe("rows whose two cells list the same items", () => {
  it("should_pair_each_item_with_its_price_under_the_heading", () => {
    expect(lines(table(SAFE_DEPOSIT))).toEqual([
      "Service | Fee",
      "Safe Deposit Boxes 3 x 5 | $18.00 a year",
      "Safe Deposit Boxes 3 x 10 | $30.00 a year",
      "Safe Deposit Boxes 5 x 10 | $40.00 a year",
      "Safe Deposit Boxes 10 x 10 | $80.00 a year",
      "Safe Deposit Boxes Lost Key | $25.00",
      "Safe Deposit Boxes Drilled Box | $250.00",
    ]);
  });

  it("should_store_one_table_row_per_item", () => {
    const result = read(table(listRow("Cashier’s Check", ["For Paying Bills", "Stop Payment"], ["$2.00", "$10.00"])), true);
    expect(result.tableRows).toBe(3);
    expect(result.rows.slice(1)).toEqual([
      { table: 0, page: null, cells: ["Cashier’s Check For Paying Bills", "$2.00"], columns: ["Cashier’s Check For Paying Bills", "$2.00"], header: false, origin: "html_table" },
      { table: 0, page: null, cells: ["Cashier’s Check Stop Payment", "$10.00"], columns: ["Cashier’s Check Stop Payment", "$10.00"], header: false, origin: "html_table" },
    ]);
  });

  it("should_pair_without_a_heading", () => {
    const html = table(`<tr><td>${ul(["Outgoing", "Incoming"])}</td><td>${ul(["$20.00", "$10.00"])}</td></tr>`);
    expect(lines(html).slice(1)).toEqual(["Outgoing | $20.00", "Incoming | $10.00"]);
  });

  it("should_pair_ordered_lists", () => {
    const html = table(`<tr><td>Wire ${ul(["Outgoing", "Incoming"], "ol")}</td><td>${ul(["$20.00", "$10.00"], "ol")}</td></tr>`);
    expect(lines(html).slice(1)).toEqual(["Wire Outgoing | $20.00", "Wire Incoming | $10.00"]);
  });

  it("should_keep_a_parenthetical_heading_with_each_item", () => {
    const html = table(listRow("NSF Items </b>(checks and automatic withdrawals)<b>", ["Return Item", "Courtesy Pay Item"], ["$35.00", "$35.00"]));
    expect(lines(html).slice(1)).toEqual([
      "NSF Items (checks and automatic withdrawals) Return Item | $35.00",
      "NSF Items (checks and automatic withdrawals) Courtesy Pay Item | $35.00",
    ]);
  });

  it("should_take_free_words_as_prices", () => {
    const html = table(listRow("Transfers", ["Online", "By phone"], ["FREE", "No Fee"]));
    expect(lines(html).slice(1)).toEqual(["Transfers Online | FREE", "Transfers By phone | No Fee"]);
  });

  it("should_ignore_a_stray_br_between_price_items", () => {
    const html = table(`<tr><td><b>Wire (International)</b>${ul(["Wire out", "Proof of payment"])}</td><td><br/><ul><br><li>$50.00</li><li>$30.00</li></ul></td></tr>`);
    expect(lines(html).slice(1)).toEqual(["Wire (International) Wire out | $50.00", "Wire (International) Proof of payment | $30.00"]);
  });

  it("should_read_a_row_whose_label_cell_is_left_unclosed", () => {
    // St. Cloud's debit card row omits </td>; the parser closes it at the next <td>.
    const html = table(`<tr><td><b>Debit Card</b><br><ul><li>Rush Order – Overnight</li><li>Rush Order – 2 day</li></ul><td><br><ul><li>$50.00</li><li>$35.00</li></ul></td></tr>`);
    expect(lines(html).slice(1)).toEqual(["Debit Card Rush Order – Overnight | $50.00", "Debit Card Rush Order – 2 day | $35.00"]);
  });

  it("should_pair_the_br_form_and_drop_typed_bullets", () => {
    const html = table(`<tr><td>• Debit Card <br>• Online Banking</td><td>• FREE<br>• $2.00 per month</td></tr>`);
    expect(lines(html).slice(1)).toEqual(["Debit Card | FREE", "Online Banking | $2.00 per month"]);
  });

  it("should_pair_a_br_form_with_one_trailing_br", () => {
    const html = table(`<tr><td>Copy<br>Fax<br></td><td>$1.00<br>$2.00</td></tr>`);
    expect(lines(html).slice(1)).toEqual(["Copy | $1.00", "Fax | $2.00"]);
  });

  it("should_pair_up_to_the_item_cap", () => {
    const items = Array.from({ length: MAX_ITEMS }, (_, index) => `Box ${index + 1}`);
    const prices = items.map((_, index) => `$${index + 1}.00`);
    expect(lines(table(listRow("Boxes", items, prices)))).toHaveLength(MAX_ITEMS + 1);
  });
});

describe("near misses that must read as the switch-off read", () => {
  it("should_refuse_a_count_mismatch", () => {
    expectUnchanged(table(listRow("ATM Fees - International Machines", ["Mastercard fee", "Our fee", "ATM owner fee"], ["$1.00", "$1.50 per transaction"])));
  });

  it("should_refuse_a_nested_list_on_the_label_side", () => {
    expectUnchanged(table(`<tr><td><b>Check Cashing</b><ul><li>Members</li><li>Non-Members<ul><li>Up to 100</li><li>100 and over</li></ul></li></ul></td><td><br/><ul><li>$5.00</li><li>$10.00</li></ul></td></tr>`));
  });

  it("should_refuse_a_nested_list_on_the_price_side", () => {
    expectUnchanged(table(`<tr><td><b>Check Cashing</b>${ul(["Members", "Non-Members"])}</td><td><ul><li>$5.00</li><li>$10.00<ul><li>$1.00</li></ul></li></ul></td></tr>`));
  });

  it("should_refuse_a_list_directly_inside_a_list", () => {
    expectUnchanged(table(`<tr><td>${ul(["Members", "Non-Members"])}</td><td><ul><li>$5.00</li><ul><li>$10.00</li></ul></ul></td></tr>`));
  });

  it("should_refuse_a_list_only_on_the_label_side", () => {
    expectUnchanged(table(`<tr><td><b>Visa Gift Card</b>${ul(["Over-the-Counter", "Online"])}</td><td>$3.95</td></tr>`));
  });

  it("should_refuse_a_list_only_on_the_price_side", () => {
    expectUnchanged(table(`<tr><td><b>Vault Fee</b></td><td>${ul(["Minimum Fee: $5.00 per month", "Maximum Fee: $20.00 per month"])}</td></tr>`));
  });

  it("should_refuse_an_empty_label_item", () => {
    expectUnchanged(table(listRow("Wire", ["Outgoing", " "], ["$20.00", "$10.00"])));
  });

  it("should_refuse_an_empty_price_item", () => {
    expectUnchanged(table(listRow("Wire", ["Outgoing", "Incoming"], ["$20.00", ""])));
  });

  it("should_refuse_two_prices_in_one_price_item", () => {
    expectUnchanged(table(`<tr><td>• Debit Card <br>• Notary Service</td><td>• FREE<br>• FREE for members, $5 fee for non-members</td></tr>`));
  });

  it("should_refuse_two_dollar_amounts_in_one_list_item", () => {
    expectUnchanged(table(listRow("Wire", ["Outgoing", "Incoming"], ["$20.00 or $25.00 after 3 pm", "$10.00"])));
  });

  it("should_refuse_a_percentage_beside_a_price", () => {
    expectUnchanged(table(listRow("Foreign transactions", ["Purchase", "Withdrawal"], ["1% of transaction", "$1.50 plus 1%"])));
  });

  it("should_refuse_a_colspan", () => {
    expectUnchanged(`<table><tr><td colspan="2"><b>Wire</b>${ul(["Outgoing", "Incoming"])}</td><td>${ul(["$20.00", "$10.00"])}</td></tr><tr><td>A</td><td>B</td><td>C</td></tr></table>`);
  });

  it("should_refuse_a_rowspan", () => {
    expectUnchanged(table(`<tr><td rowspan="2"><b>Wire</b>${ul(["Outgoing", "Incoming"])}</td><td>${ul(["$20.00", "$10.00"])}</td></tr><tr><td>$5.00</td></tr>`));
  });

  it("should_refuse_a_row_under_a_rowspan_from_above", () => {
    expectUnchanged(`<table><tr><td rowspan="2">Wire</td><td>${ul(["Outgoing", "Incoming"])}</td><td>${ul(["$20.00", "$10.00"])}</td></tr><tr><td>${ul(["Fax", "Copy"])}</td><td>${ul(["$1.00", "$2.00"])}</td></tr></table>`);
  });

  it("should_refuse_three_cells", () => {
    expectUnchanged(table(`<tr><td><b>Wire</b>${ul(["Outgoing", "Incoming"])}</td><td>${ul(["$20.00", "$10.00"])}</td><td>${ul(["$25.00", "$15.00"])}</td></tr>`));
  });

  it("should_refuse_a_header_cell_row", () => {
    expectUnchanged(`<table><tr><th>Wire ${ul(["Outgoing", "Incoming"])}</th><td>${ul(["$20.00", "$10.00"])}</td></tr><tr><td>A</td><td>B</td></tr></table>`);
  });

  it("should_refuse_a_hidden_label_item", () => {
    expectUnchanged(table(`<tr><td><b>Wire</b><ul><li>Outgoing</li><li style="display: none">Incoming</li></ul></td><td>${ul(["$20.00", "$10.00"])}</td></tr>`));
  });

  it("should_refuse_a_hidden_price_item", () => {
    expectUnchanged(table(`<tr><td><b>Wire</b>${ul(["Outgoing", "Incoming"])}</td><td><ul><li>$20.00</li><li class="d-none">$10.00</li></ul></td></tr>`));
  });

  it("should_refuse_an_aria_hidden_cell", () => {
    expectUnchanged(table(`<tr><td><b>Wire</b>${ul(["Outgoing", "Incoming"])}</td><td aria-hidden="true">${ul(["$20.00", "$10.00"])}</td></tr>`));
  });

  it("should_refuse_a_table_inside_a_footer", () => {
    expectUnchanged(`<footer><table><tr><td>${ul(["Branches", "Hours"])}</td><td>${ul(["$5.00", "$10.00"])}</td></tr><tr><td>A</td><td>B</td></tr></table></footer>`);
  });

  it("should_refuse_a_table_inside_site_navigation", () => {
    expectUnchanged(`<div role="navigation"><table><tr><td>${ul(["Checking", "Savings"])}</td><td>${ul(["$5.00", "$10.00"])}</td></tr><tr><td>A</td><td>B</td></tr></table></div>`);
    expectUnchanged(`<nav><table><tr><td>${ul(["Checking", "Savings"])}</td><td>${ul(["Free", "Free"])}</td></tr><tr><td>A</td><td>B</td></tr></table></nav>`);
  });

  it("should_refuse_a_link_list_table", () => {
    expectUnchanged(table(`<tr><td>${ul(["<a href='/c'>Checking</a>", "<a href='/s'>Savings</a>"])}</td><td>${ul(["<a href='/l'>Loans</a>", "<a href='/r'>Rates</a>"])}</td></tr>`));
  });

  it("should_refuse_a_value_list_of_descriptions", () => {
    expectUnchanged(table(listRow("Checking", ["Reward", "Regular"], ["Earns dividends monthly", "No minimum balance"])));
  });

  it("should_refuse_a_value_item_that_only_mentions_a_price_later", () => {
    expectUnchanged(table(listRow("Overdraft", ["Paid item", "Returned item"], ["Charged per item, $35.00", "Charged per item, $35.00"])));
  });

  it("should_refuse_a_long_price_description", () => {
    expectUnchanged(table(listRow("Wire", ["Outgoing", "Incoming"], ["$20.00 for each wire sent from any account at any branch or online", "$10.00"])));
  });

  it("should_refuse_a_dollar_amount_in_a_label_item", () => {
    expectUnchanged(table(listRow("Check Cashing", ["Up to $100", "$100 and over"], ["No Fee", "$5.00"])));
  });

  it("should_refuse_a_dollar_amount_in_the_heading", () => {
    expectUnchanged(table(listRow("Accounts under $100", ["Savings", "Checking"], ["$5.00", "$10.00"])));
  });

  it("should_refuse_text_after_the_label_list", () => {
    expectUnchanged(table(`<tr><td><b>Wire</b>${ul(["Outgoing", "Incoming"])}Fees subject to change.</td><td>${ul(["$20.00", "$10.00"])}</td></tr>`));
  });

  it("should_refuse_text_before_the_price_list", () => {
    expectUnchanged(table(`<tr><td><b>Wire</b>${ul(["Outgoing", "Incoming"])}</td><td>Per wire: ${ul(["$20.00", "$10.00"])}</td></tr>`));
  });

  it("should_refuse_a_block_heading_before_the_list", () => {
    expectUnchanged(table(`<tr><td><p><b>Wire</b></p>${ul(["Outgoing", "Incoming"])}</td><td>${ul(["$20.00", "$10.00"])}</td></tr>`));
  });

  it("should_refuse_two_lists_in_one_cell", () => {
    expectUnchanged(table(`<tr><td>${ul(["Outgoing"])}${ul(["Incoming"])}</td><td>${ul(["$20.00", "$10.00"])}</td></tr>`));
  });

  it("should_refuse_a_list_wrapped_in_a_div", () => {
    expectUnchanged(table(`<tr><td><b>Wire</b><div>${ul(["Outgoing", "Incoming"])}</div></td><td>${ul(["$20.00", "$10.00"])}</td></tr>`));
  });

  it("should_refuse_a_nested_table", () => {
    expectUnchanged(`<table><tr><td>${ul(["Outgoing", "Incoming"])}<table><tr><td>x</td></tr></table></td><td>${ul(["$20.00", "$10.00"])}</td></tr></table>`);
  });

  it("should_refuse_mixed_forms", () => {
    expectUnchanged(table(`<tr><td><b>Wire</b>${ul(["Outgoing", "Incoming"])}</td><td>$20.00<br>$10.00</td></tr>`));
  });

  it("should_refuse_a_br_form_count_mismatch", () => {
    expectUnchanged(table(`<tr><td>Automated Loan Transfer <br>• Bill Payer</td><td>FREE</td></tr>`));
  });

  it("should_refuse_a_br_form_with_a_heading_line_the_prices_skip", () => {
    expectUnchanged(table(`<tr><td><b>Wire</b><br>Outgoing<br>Incoming</td><td><br>$20.00<br>$10.00</td></tr>`));
  });

  it("should_refuse_a_br_form_with_a_blank_line_inside", () => {
    expectUnchanged(table(`<tr><td>Copy<br><br>Fax</td><td>$1.00<br>$2.00<br>$3.00</td></tr>`));
  });

  it("should_refuse_a_br_inside_bold_text", () => {
    expectUnchanged(table(`<tr><td><b>Copy<br>Fax</b></td><td>$1.00<br>$2.00</td></tr>`));
  });

  it("should_refuse_a_single_item_list", () => {
    expectUnchanged(table(listRow("Visa Gift Card", ["Over-the-Counter"], ["$3.95"])));
  });

  it("should_refuse_more_items_than_the_cap", () => {
    const items = Array.from({ length: MAX_ITEMS + 1 }, (_, index) => `Box ${index + 1}`);
    expectUnchanged(table(listRow("Boxes", items, items.map((_, index) => `$${index + 1}.00`))));
  });

  it("should_leave_a_row_main_already_reads_unchanged", () => {
    expectUnchanged(table(`<tr><td><b>Stop Payment Order</b></td><td>$35.00</td></tr>`, `<tr><td><b>Account Research</b></td><td>$20.00 per hour</td></tr>`));
  });

  it("should_leave_a_layout_table_unchanged", () => {
    expectUnchanged(`<table><tr><td>${ul(["Outgoing", "Incoming"])}</td></tr><tr><td>${ul(["$20.00", "$10.00"])}</td></tr></table>`);
  });

  it("should_leave_lists_outside_tables_unchanged", () => {
    expectUnchanged(`<main><h3>Wire</h3>${ul(["Outgoing", "Incoming"])}${ul(["$20.00", "$10.00"])}</main>`);
  });
});
