import { describe, expect, it } from "vitest";

import { extractHtmlDomText } from "./html-dom";
import { HTML_ROW_PAIRING_LIVE } from "./html-row-pairing";

/**
 * Near misses for `HTML_ROW_PAIRING_LIVE` (#1092, class R2): a label and its price join only when
 * the page's own markup makes them one row. Each case is synthetic HTML shaped like a fee page.
 */

function lines(html: string, rowPairing = true): string[] {
  return extractHtmlDomText(html, { rowPairing })
    .text.split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const row = (cls: string, cells: string[], cellClass = "col-md-6") =>
  `<div class="${cls}">${cells.map((cell) => `<div class="${cellClass}">${cell}</div>`).join("")}</div>`;

describe("HTML_ROW_PAIRING_LIVE switch", () => {
  it("should_ship_off", () => {
    expect(HTML_ROW_PAIRING_LIVE).toBe(false);
  });

  it("should_leave_the_default_read_unchanged_while_off", () => {
    const html = row("row", ["Stop payment", "$30.00"]);
    expect(lines(html, false)).toEqual(["Stop payment", "$30.00"]);
    expect(extractHtmlDomText(html).text).toBe(extractHtmlDomText(html, { rowPairing: false }).text);
  });

  it("should_leave_tables_and_definition_lists_as_they_were_when_on", () => {
    const html = `<table><tr><td>Overdraft</td><td>$35</td></tr></table><dl><dt>Wire</dt><dd>$25</dd></dl>`;
    expect(lines(html, true)).toEqual(lines(html, false));
  });
});

describe("rows the markup makes one row", () => {
  it("should_join_an_aria_row", () => {
    const html = `<div role="table"><div role="row"><div role="cell"><div>Deposited or Cashed Item Returned Unpaid</div></div><div role="cell"><div>$20.00</div></div></div></div>`;
    expect(lines(html)).toEqual(["Deposited or Cashed Item Returned Unpaid | $20.00"]);
  });

  it("should_join_an_aria_row_with_a_non_price_cell_as_a_table_would", () => {
    const html = `<div role="row"><div role="columnheader">Service</div><div role="columnheader">Fee</div></div>`;
    expect(lines(html)).toEqual(["Service | Fee"]);
  });

  it("should_join_aria_gridcells", () => {
    const html = `<div role="row"><span role="gridcell">Coin counting</span><span role="gridcell">5% of total</span></div>`;
    expect(lines(html)).toEqual(["Coin counting | 5% of total"]);
  });

  it("should_not_join_an_aria_row_whose_children_are_not_cells", () => {
    const html = `<div role="row"><div>Stop payment</div><div>$30.00</div></div>`;
    expect(lines(html)).toEqual(["Stop payment", "$30.00"]);
  });

  it("should_join_a_bootstrap_row_of_columns", () => {
    expect(lines(row("row", ["Stop payment", "$30.00"]))).toEqual(["Stop payment | $30.00"]);
  });

  it("should_join_a_kadence_row", () => {
    const html = `<div class="kt-row-column-wrap kt-has-2-columns"><div class="wp-block-kadence-column"><div class="kt-inside-inner-col"><h4>Counter Check</h4></div></div><div class="wp-block-kadence-column"><div class="kt-inside-inner-col"><p><strong>$1</strong> per check</p></div></div></div>`;
    expect(lines(html)).toEqual(["Counter Check | $1 per check"]);
  });

  it("should_join_gutenberg_columns", () => {
    const html = row("wp-block-columns", ["<p>Cashier's check</p>", "<p>$10.00</p>"], "wp-block-column");
    expect(lines(html)).toEqual(["Cashier's check | $10.00"]);
  });

  it("should_join_a_flex_row_by_class", () => {
    const html = `<div class="d-flex justify-content-between"><span>Overdraft fee</span><span>$35.00 per item</span></div>`;
    expect(lines(html)).toEqual(["Overdraft fee | $35.00 per item"]);
  });

  it("should_join_a_flex_row_by_inline_style", () => {
    const html = `<div style="display: flex; gap: 1rem"><div>Wire transfer, outgoing</div><div>$25</div></div>`;
    expect(lines(html)).toEqual(["Wire transfer, outgoing | $25"]);
  });

  it("should_join_a_css_grid_row", () => {
    const html = `<li style="display:grid"><span>Paper statement</span><span>$2.00</span></li>`;
    expect(lines(html)).toEqual(["Paper statement | $2.00"]);
  });

  it("should_join_three_cells_and_drop_an_empty_one", () => {
    const html = row("row mx-0", ["", "Fresh Start (monthly)", "$9.00"], "item col-md-4");
    expect(lines(html)).toEqual(["Fresh Start (monthly) | $9.00"]);
  });

  it("should_skip_a_mobile_only_column_header_inside_each_cell", () => {
    const cell = (head: string, value: string) => `<div class="item col-md-4"><div class="table-subhead d-md-none">${head}</div><div class="row-content">${value}</div></div>`;
    const html = `<div class="row mx-0">${cell("Fee Type", "<b>Checking</b>")}${cell("Fee Description", "Premium (daily balance below $1,000)")}${cell("Fee Amount", "$5.00")}</div>`;
    expect(lines(html)).toEqual(["Checking | Premium (daily balance below $1,000) | $5.00"]);
  });

  it("should_keep_a_free_price_row", () => {
    expect(lines(row("row", ["Notary service", "Free"]))).toEqual(["Notary service | Free"]);
  });

  it("should_keep_a_no_charge_row", () => {
    expect(lines(row("row", ["Set up fee", "No charge"]))).toEqual(["Set up fee | No charge"]);
  });

  it("should_join_each_row_of_a_list_of_rows", () => {
    const html = row("row", ["Overdraft", "$35"]) + row("row", ["NSF", "$35"]) + row("row", ["Stop payment", "$30"]);
    expect(lines(html)).toEqual(["Overdraft | $35", "NSF | $35", "Stop payment | $30"]);
  });

  it("should_join_rows_inside_an_accordion_panel", () => {
    const html = `<details><summary>Checking fees</summary>${row("row", ["Overdraft", "$35"])}</details>`;
    expect(lines(html)).toEqual(["Checking fees", "Overdraft | $35"]);
  });

  it("should_join_flex_rows_inside_a_card", () => {
    const html = `<div class="card"><h3>Overdraft</h3><div class="d-flex"><span>Per item</span><span>$35</span></div><div class="d-flex"><span>Daily maximum</span><span>$105</span></div></div>`;
    expect(lines(html)).toEqual(["Overdraft", "Per item | $35", "Daily maximum | $105"]);
  });

  it("should_join_the_inner_row_of_nested_rows_only", () => {
    const html = `<div class="row"><div class="col-md-12"><h2>Fees</h2>${row("row", ["Stop payment", "$30"], "col-6")}</div><div class="col-md-12"><p>Questions? Call us.</p></div></div>`;
    expect(lines(html)).toEqual(["Fees", "Stop payment | $30", "Questions? Call us."]);
  });
});

describe("price-first rows", () => {
  it("should_put_the_label_before_a_leading_price", () => {
    expect(lines(row("row", ["$20.00", "Wire Transfer"]))).toEqual(["Wire Transfer | $20.00"]);
  });

  it("should_put_the_label_before_a_leading_price_in_a_flex_row", () => {
    const html = `<div class="flex"><span class="price">$25.00</span><span>NSF Check/ACH/ATM item</span></div>`;
    expect(lines(html)).toEqual(["NSF Check/ACH/ATM item | $25.00"]);
  });

  it("should_not_join_price_first_br_lines_with_no_row_markup", () => {
    const html = `<p>$20.00 - Stop Payment<br>$10.00 - Debit Card Replacement</p>`;
    expect(lines(html)).toEqual(["$20.00 - Stop Payment", "$10.00 - Debit Card Replacement"]);
  });

  it("should_not_pair_a_price_with_the_label_on_the_line_above_it", () => {
    const html = `<p>Wire Transfer</p><p>$20.00</p><p>Stop Payment</p><p>$30.00</p>`;
    expect(lines(html)).toEqual(["Wire Transfer", "$20.00", "Stop Payment", "$30.00"]);
  });
});

describe("a description between the label and the price", () => {
  it("should_keep_the_heading_as_the_label_and_write_the_description_after_the_row", () => {
    const html = row("kt-row-column-wrap", [
      "<h4>Check Stop Payment</h4><p>You request a Stop Payment Order be placed on a check.</p>",
      "<p><strong>$30</strong> per request</p>",
    ], "wp-block-kadence-column");
    expect(lines(html)).toEqual(["Check Stop Payment | $30 per request", "You request a Stop Payment Order be placed on a check."]);
  });

  it("should_split_a_long_label_cell_at_its_first_block", () => {
    const long = "Applies when you ask us to research an account. ".repeat(4);
    const html = row("row", [`<p>Account research</p><p>${long}</p>`, "$25 per hour"]);
    expect(lines(html)[0]).toBe("Account research | $25 per hour");
  });

  it("should_keep_a_short_two_block_label_whole", () => {
    expect(lines(row("row", ["<div>Overdraft</div><div>paid item</div>", "$35"]))).toEqual(["Overdraft paid item | $35"]);
  });

  it("should_not_join_a_long_label_with_no_blocks_to_split", () => {
    const long = "This fee is charged when an item is presented and the account lacks funds and we pay it anyway at our discretion under the terms of the deposit account agreement.";
    expect(lines(row("row", [long, "$35"]))).toEqual([long, "$35"]);
  });

  it("should_keep_a_second_price_block_on_its_own_line", () => {
    const html = row("row", ["<h4>Notary Service</h4>", "<p>No charge for notarization of Bank documents.</p><p>$10 per signature for notarization of non-Bank documents</p>"]);
    expect(lines(html)).toEqual(["Notary Service | No charge for notarization of Bank documents.", "$10 per signature for notarization of non-Bank documents"]);
  });

  it("should_keep_a_long_price_cell_first_block_on_the_row", () => {
    const tail = "Fees will show as a total for each calendar month on your statement. ".repeat(4);
    const html = row("row", ["Excessive withdrawal", `<p>$15 for each excessive item.</p><p>${tail}</p>`]);
    expect(lines(html)[0]).toBe("Excessive withdrawal | $15 for each excessive item.");
  });

  it("should_keep_a_short_price_cell_with_its_frequency_whole", () => {
    expect(lines(row("row", ["Monthly service charge", "<p>$5.00</p><p>per month</p>"]))).toEqual(["Monthly service charge | $5.00 per month"]);
  });
});

describe("near misses that must not join", () => {
  it("should_not_join_pricing_cards_with_label_and_price_in_each_card", () => {
    const html = row("row", ["<h3>Basic</h3><p>$5/month</p>", "<h3>Plus</h3><p>$10/month</p>", "<h3>Premier</h3><p>$15/month</p>"], "col-md-4");
    expect(lines(html)).toEqual(["Basic", "$5/month", "Plus", "$10/month", "Premier", "$15/month"]);
  });

  it("should_not_join_cards_that_lead_with_their_price", () => {
    const html = row("row", ["<div>$5</div><div>Basic</div>", "<div>$10</div><div>Plus</div>"]);
    expect(lines(html)).toEqual(["$5", "Basic", "$10", "Plus"]);
  });

  it("should_not_join_a_label_that_prints_its_own_price", () => {
    expect(lines(row("row", ["Basic checking $5 monthly", "$10"]))).toEqual(["Basic checking $5 monthly", "$10"]);
  });

  it("should_not_join_a_row_with_no_price", () => {
    expect(lines(row("row", ["Featured", "Stack Checking", "Free high-yield checking and savings."]))).toEqual([
      "Featured",
      "Stack Checking",
      "Free high-yield checking and savings.",
    ]);
  });

  it("should_not_join_a_row_of_prices_only", () => {
    expect(lines(row("row", ["$5", "$10"]))).toEqual(["$5", "$10"]);
  });

  it("should_not_join_a_row_with_more_than_four_cells", () => {
    const html = row("row", ["A", "B", "C", "D", "$5"], "col");
    expect(lines(html)).toEqual(["A", "B", "C", "D", "$5"]);
  });

  it("should_not_join_a_row_whose_children_are_not_all_columns", () => {
    const html = `<div class="row"><div class="col-6">Stop payment</div><div class="note">$30</div></div>`;
    expect(lines(html)).toEqual(["Stop payment", "$30"]);
  });

  it("should_not_join_a_container_without_row_markup", () => {
    const html = `<div class="fee-item"><div>Stop payment</div><div>$30</div></div>`;
    expect(lines(html)).toEqual(["Stop payment", "$30"]);
  });

  it("should_not_join_a_stacked_flex_column", () => {
    const html = `<div class="d-flex flex-column"><div>Stop payment</div><div>$30</div></div>`;
    expect(lines(html)).toEqual(["Stop payment", "$30"]);
  });

  it("should_not_join_a_flex_column_set_by_style", () => {
    const html = `<div style="display:flex;flex-direction:column"><div>Stop payment</div><div>$30</div></div>`;
    expect(lines(html)).toEqual(["Stop payment", "$30"]);
  });

  it("should_not_join_a_wrapping_flex_strip_of_cards", () => {
    const html = `<div class="d-flex flex-wrap"><div>Stop payment</div><div>$30</div></div>`;
    expect(lines(html)).toEqual(["Stop payment", "$30"]);
  });

  it("should_not_join_a_row_with_loose_text_outside_its_cells", () => {
    const html = `<div class="row">Fee: <div class="col-6">Stop payment</div><div class="col-6">$30</div></div>`;
    expect(lines(html)).toEqual(["Fee:", "Stop payment", "$30"]);
  });

  it("should_not_join_a_row_whose_cell_holds_a_list", () => {
    const html = row("row", ["<ul><li>Overdraft</li><li>NSF</li></ul>", "$35"]);
    expect(lines(html)).toEqual(["Overdraft", "NSF", "$35"]);
  });

  it("should_not_join_nested_list_items_to_a_price", () => {
    const html = `<ul><li>Overdraft<ul><li>$35 per item</li></ul></li></ul>`;
    expect(lines(html)).toEqual(["Overdraft", "$35 per item"]);
  });

  it("should_not_join_a_row_whose_cell_holds_a_table", () => {
    const html = row("row", ["<h3>Checking</h3>", "<table><tr><td>Overdraft</td><td>$35</td></tr></table>"]);
    expect(lines(html)).toEqual(["Checking", "Overdraft | $35"]);
  });

  it("should_not_join_a_page_layout_row", () => {
    const html = row("row", ["<nav><a href='/'>Home</a></nav>", "<h1>Fee schedule</h1><p>$30 stop payment</p>"], "col-md-3");
    expect(lines(html)).toEqual(["Home", "Fee schedule", "$30 stop payment"]);
  });

  it("should_not_join_an_accordion_summary_to_its_panel", () => {
    const html = `<details><summary>Overdraft fee</summary><p>$35 per item</p></details>`;
    expect(lines(html)).toEqual(["Overdraft fee", "$35 per item"]);
  });

  it("should_not_join_a_bootstrap_accordion_header_to_its_body", () => {
    const html = `<div class="accordion-item"><h2 class="accordion-header"><button>Stop payment</button></h2><div class="accordion-collapse collapse"><div class="accordion-body">$30</div></div></div>`;
    expect(lines(html)).toEqual(["Stop payment", "$30"]);
  });

  it("should_not_take_free_marketing_copy_for_a_price", () => {
    expect(lines(row("row", ["Checking", "Free checking with no minimum balance and online banking"]))).toEqual([
      "Checking",
      "Free checking with no minimum balance and online banking",
    ]);
  });

  it("should_not_join_a_single_cell_row", () => {
    expect(lines(row("row", ["Stop payment $30"]))).toEqual(["Stop payment $30"]);
  });

  it("should_not_join_a_row_whose_label_cell_holds_another_row", () => {
    const inner = row("row", ["Overdraft", "$35"], "col-6");
    const html = row("row", [inner, "$5"], "col-md-6");
    expect(lines(html)).toEqual(["Overdraft | $35", "$5"]);
  });

  it("should_not_join_a_heading_to_the_row_below_it", () => {
    const html = `<h3>Wire Transfers</h3>${row("row", ["Outgoing domestic", "$25"])}`;
    expect(lines(html)).toEqual(["Wire Transfers", "Outgoing domestic | $25"]);
  });

  it("should_ignore_scripts_inside_a_row", () => {
    const html = `<div class="row"><div class="col-6">Stop payment</div><script>var x = "$1";</script><div class="col-6">$30</div></div>`;
    expect(lines(html)).toEqual(["Stop payment | $30"]);
  });

  it("should_not_join_a_flex_navigation_bar_without_prices", () => {
    const html = `<ul class="d-flex"><li>Home</li><li>Rates</li><li>Fees</li></ul>`;
    expect(lines(html)).toEqual(["Home", "Rates", "Fees"]);
  });
});
