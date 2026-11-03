import { describe, expect, it } from "vitest";

import { extractHtmlDomText, headingContextSpans } from "@/lib/agents/rosetta/html-dom";
import { HTML_HEADING_CONTEXT_LIVE } from "@/lib/agents/rosetta/html-heading-scope";
import { normalizeWhitespace } from "@/lib/agents/rosetta/read";
import { headingCategory, rowName } from "@/lib/agents/knox/heading-category-rows";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { appendHeadingContext, splitHeadingContext, withoutHeadingContext } from "@/lib/heading-context-trailer";

/**
 * Near misses for Knox v177's heading-category rows (#1092, class R1), end to end: synthetic HTML
 * shaped like a fee page, read by Rosetta's HTML reader with `HTML_HEADING_CONTEXT_LIVE` held on, its
 * trailer appended as rosetta/read.ts stores it, then read by Knox's free read. Each test compares the
 * reads with the trailer against main's reads of the same text without it: only a row the markup puts
 * under a heading that names one fee type may be added, and no read of main's may change.
 */

function stored(html: string, headingContext = true): string {
  const extracted = extractHtmlDomText(html, { headingContext });
  const text = normalizeWhitespace(extracted.text);
  return appendHeadingContext(text, headingContextSpans(extracted, text, normalizeWhitespace));
}

const show = (c: { canonicalHint: string; amount: number; feeName: string }) => `${c.canonicalHint} ${c.amount} ${c.feeName}`;

/** Reads with the trailer that main (the same text, no trailer) does not make; and main's reads it lost. */
function delta(html: string): { added: string[]; lost: string[] } {
  const text = stored(html);
  const on = runFreeSpecialists(text).candidates.map(show);
  const off = runFreeSpecialists(withoutHeadingContext(text)).candidates.map(show);
  return { added: on.filter((r) => !off.includes(r)), lost: off.filter((r) => !on.includes(r)) };
}

const added = (html: string) => {
  const result = delta(html);
  expect(result.lost).toEqual([]);
  return result.added;
};

const page = (body: string) => `<html><body><main>${body}</main></body></html>`;
const list = (...items: string[]) => `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
const table = (rows: string[][], head?: string[] | string) => {
  const header = head == null ? "" : typeof head === "string" ? `<thead><tr><th colspan="2">${head}</th></tr></thead>` : `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
  return `<table>${header}<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
};

describe("HTML_HEADING_CONTEXT_LIVE switch", () => {
  it("should_ship_off", () => {
    expect(HTML_HEADING_CONTEXT_LIVE).toBe(false);
  });

  it("should_write_main_text_byte_for_byte_with_the_switch_off_or_on", () => {
    const html = page(`<h2>Night Depository</h2>${list("Bag Replacement: $25.00 each")}`);
    expect(extractHtmlDomText(html).text).toBe(extractHtmlDomText(html, { headingContext: false }).text);
    expect(extractHtmlDomText(html, { headingContext: true }).text).toBe(extractHtmlDomText(html, { headingContext: false }).text);
    expect(stored(html, false)).toBe(normalizeWhitespace(extractHtmlDomText(html).text));
    expect(withoutHeadingContext(stored(html, true))).toBe(stored(html, false));
  });

  it("should_store_no_trailer_while_off", () => {
    const html = page(`<h2>Night Depository</h2>${list("Bag Replacement: $25.00 each")}`);
    expect(stored(html, false)).not.toContain("⟦heading-context");
    expect(extractHtmlDomText(html).headingMarked).toBeUndefined();
  });

  it("should_read_a_text_without_a_trailer_exactly_as_main", () => {
    const text = "Night Depository\n\nBag Replacement: $25.00 each";
    expect(runFreeSpecialists(text)).toEqual(runFreeSpecialists(withoutHeadingContext(text)));
  });
});

describe("rows a structural heading names", () => {
  it("should_read_a_list_row_under_an_h2_that_names_its_fee_type", () => {
    expect(added(page(`<h2>Night Depository</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual(["night_deposit 25 Night Depository - Bag Replacement"]);
  });

  it("should_read_a_row_under_a_heading_row_inside_its_table", () => {
    const html = page(`<table><tr><td colspan="2"><h2>ATM Service</h2></td></tr><tr><td>CO-OP Network Transactions</td><td>Free</td></tr><tr><td>All Other Transactions</td><td>$3.00</td></tr></table>`);
    expect(added(html)).toEqual(["atm_non_network 3 ATM Service - All Other Transactions"]);
  });

  it("should_read_a_row_under_a_one_cell_table_header", () => {
    expect(added(page(table([["Non-Customer", "$35.00"]], "Cashier's Check")))).toEqual(["cashiers_check 35 Cashier's Check - Non-Customer"]);
  });

  it("should_read_a_row_under_the_header_cell_over_its_name_column", () => {
    expect(added(page(table([["Non-Customer", "$35.00"]], ["Cashier's Check", "Price"])))).toEqual(["cashiers_check 35 Cashier's Check - Non-Customer"]);
  });

  it("should_read_a_row_under_an_aria_heading", () => {
    const html = page(`<div role="heading" aria-level="3">Night Depository</div>${list("Bag Replacement: $25.00 each")}`);
    expect(added(html)).toEqual(["night_deposit 25 Night Depository - Bag Replacement"]);
  });

  it("should_take_the_nearest_heading_when_headings_nest", () => {
    const html = page(`<h2>Fees</h2><h3>Night Depository</h3>${list("Bag Replacement: $25.00 each")}`);
    expect(added(html)).toEqual(["night_deposit 25 Night Depository - Bag Replacement"]);
  });

  it("should_drop_the_held_unnamed_row_it_reads", () => {
    const text = stored(page(`<h2>Night Depository</h2>${list("Bag Replacement: $25.00 each")}`));
    const off = runFreeSpecialists(withoutHeadingContext(text));
    const on = runFreeSpecialists(text);
    expect(off.candidates.some((c) => c.excerpt.includes("Bag Replacement"))).toBe(false);
    expect(on.held.filter((h) => h.shape === "unclassified" && h.excerpt.includes("Bag Replacement"))).toEqual([]);
    expect(on.candidates.find((c) => c.canonicalHint === "night_deposit")?.excerpt).toBe("Bag Replacement: $25.00 each");
  });
});

describe("near misses: the heading names no single fee type", () => {
  it("should_not_lend_an_account_heading_to_the_rows_under_it", () => {
    expect(added(page(`<h2>Premier Checking</h2>${table([["Minimum balance to open", "$500.00"], ["Paper statement fee", "$3.00"]])}`))).toEqual([]);
  });

  it("should_not_lend_a_business_account_heading_to_a_service_fee", () => {
    expect(added(page(`<h3>Business Checking Fees</h3>${table([["Service Fee", "$10.00/month"]])}`))).toEqual([]);
  });

  it("should_not_lend_a_heading_naming_a_share_draft_account", () => {
    expect(added(page(`<h2>Share Draft Account</h2>${table([["All Other Transactions", "$3.00"]])}`))).toEqual([]);
  });

  it("should_not_lend_a_plain_fees_heading", () => {
    expect(added(page(`<h2>Fees</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_not_lend_an_other_services_heading", () => {
    expect(added(page(`<h2>Other Services</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_not_lend_a_miscellaneous_heading", () => {
    expect(added(page(`<h2>Miscellaneous</h2>${list("Levy: $100.00 each", "Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_not_lend_a_heading_that_names_two_fee_types", () => {
    expect(added(page(`<h2>Stop Payment and Wire Fees</h2>${list("Each Item: $30.00")}`))).toEqual([]);
  });

  it("should_not_lend_a_heading_listing_types_with_a_slash", () => {
    expect(added(page(`<h2>Night Depository / Vault</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_not_lend_a_heading_listing_types_with_an_ampersand", () => {
    expect(added(page(`<h2>Cashier's Checks &amp; Money Orders</h2>${list("Non-Customer: $10.00")}`))).toEqual([]);
  });

  it("should_not_lend_a_heading_with_a_figure", () => {
    expect(added(page(`<h2>Night Depository 2025</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_not_lend_a_heading_that_is_a_sentence", () => {
    expect(added(page(`<h2>Night depository fees apply.</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_not_lend_a_monthly_maintenance_heading", () => {
    expect(added(page(`<h2>Monthly Maintenance Fee</h2>${list("Basic: $5.00")}`))).toEqual([]);
  });

  it("should_not_lend_a_header_cell_naming_amount", () => {
    expect(added(page(table([["Non-Customer", "$35.00"]], "Amount")))).toEqual([]);
  });

  it("should_not_lend_a_header_row_that_names_columns", () => {
    expect(added(page(table([["Bag Replacement", "$25.00"], ["Key Replacement", "$8.00"]], ["Service", "Fee"])))).toEqual([]);
  });

  it("should_not_lend_an_item_and_amount_header_row", () => {
    expect(added(page(table([["Non-Customer", "$35.00"]], ["Item", "Amount"])))).toEqual([]);
  });

  it("should_not_lend_a_header_row_whose_name_column_is_empty", () => {
    expect(added(page(table([["Non-Customer", "$35.00"]], ["", "Cashier's Check"])))).toEqual([]);
  });
});

describe("near misses: the nearest structural heading wins", () => {
  it("should_not_reach_past_a_nearer_heading_that_names_nothing", () => {
    expect(added(page(`<h2>Night Depository</h2><h3>Other Services</h3>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_end_a_heading_at_the_next_heading_of_its_rank_or_higher", () => {
    expect(added(page(`<h3>Night Depository</h3><h2>Miscellaneous</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_let_a_table_header_row_win_over_the_heading_above_the_table", () => {
    expect(added(page(`<h2>Night Depository</h2>${table([["Bag Replacement", "$25.00"]], ["Service", "Fee"])}`))).toEqual([]);
  });

  it("should_restore_no_table_heading_after_the_table_ends", () => {
    const html = page(`${table([["Non-Customer", "$35.00"]], "Cashier's Check")}<p>Non-Customer: $35.00</p>`);
    expect(added(html)).toEqual(["cashiers_check 35 Cashier's Check - Non-Customer"]);
  });

  it("should_end_a_heading_with_its_section", () => {
    expect(added(page(`<section><h2>Night Depository</h2></section>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_end_a_heading_with_its_layout_table_cell", () => {
    const html = page(`<table><tr><td><h2>Night Depository</h2><table><tr><td>x</td></tr></table></td><td>${list("Bag Replacement: $25.00 each")}</td></tr></table>`);
    expect(added(html)).toEqual([]);
  });
});

describe("near misses: hidden headings and page furniture", () => {
  it("should_refuse_an_aria_hidden_heading", () => {
    expect(added(page(`<h2 aria-hidden="true">Night Depository</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_refuse_a_heading_under_an_aria_hidden_wrapper", () => {
    expect(added(page(`<div aria-hidden="true"><h2>Night Depository</h2></div>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_refuse_a_screen_reader_only_heading", () => {
    expect(added(page(`<h2 class="sr-only">Night Depository</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_refuse_a_visually_hidden_heading", () => {
    expect(added(page(`<h2 class="visually-hidden">Night Depository</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_refuse_a_heading_styled_display_none", () => {
    expect(added(page(`<h2 style="display: none">Night Depository</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_refuse_a_heading_with_the_hidden_attribute", () => {
    expect(added(page(`<h2 hidden>Night Depository</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_refuse_a_hidden_table_header", () => {
    expect(added(page(`<table><thead><tr><th colspan="2" class="sr-only">Cashier's Check</th></tr></thead><tbody><tr><td>Non-Customer</td><td>$35.00</td></tr></tbody></table>`))).toEqual([]);
  });

  it("should_refuse_a_heading_inside_a_nav", () => {
    expect(added(`<html><body><nav><h2>Night Depository</h2></nav><main>${list("Bag Replacement: $25.00 each")}</main></body></html>`)).toEqual([]);
  });

  it("should_refuse_a_heading_inside_a_footer", () => {
    expect(added(`<html><body><footer><h2>Night Depository</h2>${list("Bag Replacement: $25.00 each")}</footer></body></html>`)).toEqual([]);
  });

  it("should_refuse_a_heading_inside_a_header", () => {
    expect(added(`<html><body><header><h1>Night Depository</h1></header>${list("Bag Replacement: $25.00 each")}</body></html>`)).toEqual([]);
  });

  it("should_refuse_a_heading_inside_an_aside", () => {
    expect(added(page(`<aside><h3>Night Depository</h3>${list("Bag Replacement: $25.00 each")}</aside>`))).toEqual([]);
  });

  it("should_refuse_a_heading_inside_a_navigation_landmark", () => {
    expect(added(page(`<div role="navigation"><h3>Night Depository</h3>${list("Bag Replacement: $25.00 each")}</div>`))).toEqual([]);
  });

  it("should_let_a_refused_heading_block_the_heading_above_it", () => {
    expect(added(page(`<h2>Night Depository</h2><h2 class="sr-only">Footnotes</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });
});

describe("near misses: what only looks like a heading", () => {
  it("should_not_take_a_bold_paragraph_as_a_heading", () => {
    expect(added(page(`<p><b>Night Depository</b></p>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_not_take_a_bold_full_width_table_cell_as_a_heading", () => {
    const html = page(`<table><tr><td colspan="3"><strong>WIRE TRANSFER</strong></td></tr><tr><td>FOREIGN</td><td>N/A</td><td>$50</td></tr></table>`);
    expect(added(html)).toEqual([]);
  });

  it("should_not_take_a_div_classed_heading_as_a_heading", () => {
    expect(added(page(`<div class="heading title">Night Depository</div>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });

  it("should_not_take_a_short_line_as_a_heading", () => {
    expect(added(page(`<div>Night Depository</div><div>Bag Replacement: $25.00 each</div>`))).toEqual([]);
  });

  it("should_refuse_a_heading_a_line_break_splits", () => {
    expect(added(page(`<h2>Night<br>Depository</h2>${list("Bag Replacement: $25.00 each")}`))).toEqual([]);
  });
});

describe("near misses: rows main reads, and rows with no single price", () => {
  it("should_leave_a_row_main_already_files_where_main_files_it", () => {
    expect(delta(page(`<h2>ATM Service</h2>${list("Stop Payment: $30.00", "All Other Transactions: $3.00")}`))).toEqual({
      added: ["atm_non_network 3 ATM Service - All Other Transactions"],
      lost: [],
    });
  });

  it("should_not_refile_a_row_whose_own_name_files_elsewhere", () => {
    // "Key Replacement" files as a safe deposit box key on its own; the heading never moves it.
    expect(added(page(`<h2>Night Depository</h2>${list("Key Replacement: $8.00 each")}`))).toEqual([]);
  });

  it("should_not_read_a_row_with_two_prices", () => {
    expect(added(page(`<h2>Night Depository</h2>${table([["Bag Replacement", "$25.00", "$30.00"]])}`))).toEqual([]);
  });

  it("should_not_read_a_free_row", () => {
    expect(added(page(`<h2>ATM Service</h2>${table([["CO-OP Network Transactions", "Free"]])}`))).toEqual([]);
  });

  it("should_not_read_a_row_with_no_name_of_its_own", () => {
    expect(added(page(`<h2>Night Depository</h2>${list("$25.00 each")}`))).toEqual([]);
  });

  it("should_not_read_a_row_the_heading_is_too_far_above_for_the_source_check", () => {
    const rows = Array.from({ length: 12 }, (_, i) => `Item number ${i + 1}: $${i + 2}.00 each`);
    const reads = added(page(`<h2>Night Depository</h2>${list(...rows)}`));
    // The shared source check finds the heading only a few lines up; rows further down stay as main read them.
    expect(reads.length).toBeLessThan(rows.length);
  });
});

describe("the trailer", () => {
  it("should_be_ignored_when_its_hash_does_not_match_the_text", () => {
    const text = stored(page(`<h2>Night Depository</h2>${list("Bag Replacement: $25.00 each")}`));
    const tampered = text.replace("Bag Replacement", "Bag Replacemant");
    expect(splitHeadingContext(tampered).lines).toBeNull();
    expect(runFreeSpecialists(tampered).candidates.map(show)).toEqual(runFreeSpecialists(withoutHeadingContext(tampered)).candidates.map(show));
  });

  it("should_be_ignored_when_it_is_not_the_last_line", () => {
    const text = `${stored(page(`<h2>Night Depository</h2>${list("Bag Replacement: $25.00 each")}`))}\n\nMore text`;
    expect(splitHeadingContext(text)).toEqual({ text, lines: null });
  });

  it("should_carry_no_word_and_no_dollar_sign", () => {
    const text = stored(page(`<h2>Night Depository</h2>${list("Bag Replacement: $25.00 each")}`));
    const trailer = text.slice(withoutHeadingContext(text).length);
    expect(trailer).toMatch(/^\n\n⟦heading-context:1⟧ n=\d+ h=[0-9a-f]{8} s=[0-9.,:\-t]+$/);
  });

  it("should_give_no_spans_when_the_page_prints_the_private_marks_itself", () => {
    const html = page(`<h2>Night Depository</h2>${list("Bag Replacement: $25.00 each ")}`);
    expect(stored(html)).toBe(stored(html, false));
  });

  it("should_give_the_shared_source_check_the_same_verdict_with_or_without_it", () => {
    const text = stored(page(`<h2>Night Depository</h2>${list("Bag Replacement: $25.00 each")}`));
    expect(splitHeadingContext(text).lines?.size).toBeGreaterThan(0);
    for (const [name, amount] of [["Night Depository - Bag Replacement", 25], ["Bag Replacement", 25], ["Night Depository", 1]] as const) {
      expect(checkFeeAgainstSource(text, name, amount, ".", "night_deposit")).toEqual(checkFeeAgainstSource(withoutHeadingContext(text), name, amount, ".", "night_deposit"));
    }
  });
});

describe("headingCategory and rowName", () => {
  it("should_lend_only_a_single_fee_type", () => {
    expect(headingCategory("Night Depository")).toBe("night_deposit");
    expect(headingCategory("ATM Service")).toBe("atm_non_network");
    expect(headingCategory("Stop Payment and Wire Fees")).toBeNull();
    expect(headingCategory("Premier Checking")).toBeNull();
    expect(headingCategory("Amount")).toBeNull();
  });

  it("should_name_a_row_by_its_first_cell_or_its_words_before_the_price", () => {
    expect(rowName("All Other Transactions | $3.00")).toBe("All Other Transactions");
    expect(rowName("Bag Replacement: $25.00 each")).toBe("Bag Replacement");
  });
});
