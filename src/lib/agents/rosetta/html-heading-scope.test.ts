import { describe, expect, it } from "vitest";

import { extractHtmlDomText, headingContextSpans } from "./html-dom";
import { HTML_HEADING_CONTEXT_LIVE, headingLevel, isHiddenElement } from "./html-heading-scope";
import { normalizeWhitespace } from "./read";
import { appendHeadingContext, fnv1a, splitHeadingContext } from "@/lib/heading-context-trailer";

/**
 * Rosetta's side of `HTML_HEADING_CONTEXT_LIVE` (#1092, class R1): which line sits under which real
 * heading, as the trailer's spans. Knox's side and the near misses end to end are in
 * knox/heading-category-rows.test.ts.
 */

function headingsOf(html: string): Record<string, string> {
  const extracted = extractHtmlDomText(html, { headingContext: true });
  const text = normalizeWhitespace(extracted.text);
  const split = splitHeadingContext(appendHeadingContext(text, headingContextSpans(extracted, text, normalizeWhitespace)));
  const lines = split.text.split("\n");
  return Object.fromEntries([...(split.lines ?? new Map()).entries()].map(([index, h]) => [lines[index], `${h.kind}:${h.heading}`]));
}

describe("heading scope", () => {
  it("should_ship_off_and_leave_the_text_unchanged_on", () => {
    expect(HTML_HEADING_CONTEXT_LIVE).toBe(false);
    const html = "<h2>Wire Transfers</h2><p>Incoming: $15</p><table><tr><th>Item</th><th>Fee</th></tr><tr><td>Copy</td><td>$2</td></tr></table>";
    expect(extractHtmlDomText(html, { headingContext: true }).text).toBe(extractHtmlDomText(html, { headingContext: false }).text);
    expect(extractHtmlDomText(html, { headingContext: true }).rows).toEqual(extractHtmlDomText(html, { headingContext: false }).rows);
  });

  it("should_place_each_line_under_its_nearest_heading", () => {
    expect(headingsOf("<h2>Wire Transfers</h2><p>Incoming: $15</p><h3>Night Depository</h3><p>Bag: $25</p><h2>Other</h2><p>Fax: $3</p>")).toEqual({
      "Incoming: $15": "2:Wire Transfers",
      "Bag: $25": "3:Night Depository",
      "Fax: $3": "2:Other",
    });
  });

  it("should_return_to_the_outer_heading_after_a_nested_section_ends", () => {
    expect(headingsOf("<h2>Wire Transfers</h2><section><h3>Other</h3><p>Fax: $3</p></section><p>Incoming: $15</p>")).toEqual({
      "Fax: $3": "3:Other",
      "Incoming: $15": "2:Wire Transfers",
    });
  });

  it("should_place_table_rows_under_the_header_cell_over_their_names", () => {
    expect(headingsOf("<table><thead><tr><th>Cashier's Check</th><th>Price</th></tr></thead><tr><td>Non-Customer</td><td>$35</td></tr></table>")).toEqual({
      "Non-Customer | $35": "t:Cashier's Check",
    });
  });

  it("should_place_table_rows_under_a_heading_row_in_the_table", () => {
    expect(headingsOf('<table><tr><td colspan="2"><h2>ATM Service</h2></td></tr><tr><td>Other</td><td>$3</td></tr></table>')).toEqual({ "Other | $3": "2:ATM Service" });
  });

  it("should_give_no_heading_to_furniture_or_hidden_content", () => {
    expect(headingsOf('<nav><h2>Rates</h2><p>a: $1</p></nav><h2 class="sr-only">Fees</h2><p>b: $2</p><footer><p>c: $3</p></footer>')).toEqual({});
  });

  it("should_read_heading_levels_and_hidden_elements_from_markup_only", () => {
    expect(headingLevel({ name: "h4", attribs: {} })).toBe(4);
    expect(headingLevel({ name: "div", attribs: { role: "heading", "aria-level": "5" } })).toBe(5);
    expect(headingLevel({ name: "div", attribs: { role: "heading" } })).toBe(2);
    expect(headingLevel({ name: "div", attribs: { class: "heading" } })).toBeNull();
    expect(isHiddenElement({ name: "h2", attribs: { class: "foo screen-reader-text" } })).toBe(true);
    expect(isHiddenElement({ name: "h2", attribs: { style: "color: red; display:none" } })).toBe(true);
    expect(isHiddenElement({ name: "h2", attribs: { class: "hidden-print" } })).toBe(false);
  });

  it("should_write_a_trailer_that_checks_the_text_it_describes", () => {
    const text = "Wire Transfers\n\nIncoming: $15";
    const stored = appendHeadingContext(text, [{ headingLine: 0, cell: -1, kind: 2, from: 2, to: 2 }]);
    expect(stored).toBe(`${text}\n\n⟦heading-context:1⟧ n=3 h=${fnv1a(text)} s=0.-1.2:2-2`);
    expect(splitHeadingContext(stored).lines?.get(2)).toEqual({ heading: "Wire Transfers", kind: 2, headingLine: 0 });
    expect(splitHeadingContext(stored.replace("s=0.-1.2:2-2", "s=2.-1.2:0-0")).lines).toBeNull();
    expect(appendHeadingContext(text, [])).toBe(text);
  });
});
