import { describe, expect, it } from "vitest";

import { extractHtmlDomText } from "./html-dom";

function lines(html: string): string[] {
  return extractHtmlDomText(html)
    .text.split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

describe("Rosetta read.html_dom", () => {
  it("writes each data-table row on one line so a fee keeps its amount", () => {
    const html = `
      <table>
        <caption>Checking account fees</caption>
        <thead><tr><th>Service</th><th>Fee</th></tr></thead>
        <tbody>
          <tr><td>Overdraft fee</td><td>$35.00 <br>per item</td></tr>
          <tr><td><p>Stop payment</p></td><td>$30.00</td></tr>
          <tr><td></td><td></td></tr>
        </tbody>
      </table>`;

    const result = extractHtmlDomText(html);

    expect(lines(html)).toEqual([
      "Checking account fees",
      "Service | Fee",
      "Overdraft fee | $35.00 per item",
      "Stop payment | $30.00",
    ]);
    expect(result.tableRows).toBe(3);
  });

  it("reads a layout table as blocks and the nested data table by rows", () => {
    const html = `
      <table><tr><td>
        <h2>Fee schedule</h2>
        <table>
          <tr><td>Returned item</td><td>$32.00</td></tr>
          <tr><td>Wire transfer, outgoing</td><td>$25.00</td></tr>
        </table>
      </td></tr></table>`;

    expect(lines(html)).toEqual(["Fee schedule", "Returned item | $32.00", "Wire transfer, outgoing | $25.00"]);
    expect(extractHtmlDomText(html).tableRows).toBe(2);
  });

  it("does not join single-column tables into rows", () => {
    const html = `<table><tr><td>Overdraft fee</td></tr><tr><td>$35</td></tr></table>`;

    expect(lines(html)).toEqual(["Overdraft fee", "$35"]);
    expect(extractHtmlDomText(html).tableRows).toBe(0);
  });

  it("pairs definition-list terms with their descriptions", () => {
    const html = `
      <dl>
        <dt>Monthly maintenance</dt><dd>$12.00</dd>
        <div><dt>Paper statement</dt><dd>$3.00</dd></div>
        <dt>Notes</dt>
      </dl>`;

    expect(lines(html)).toEqual(["Monthly maintenance | $12.00", "Paper statement | $3.00", "Notes"]);
  });

  it("decodes entities once, breaks lines on <br>, and drops scripts, styles and the head", () => {
    const html = `
      <html><head><title>Bank &amp; Trust</title><style>.x{}</style></head>
      <body>
        <p>Cashier&#39;s check &amp; money order<br>$10.00</p>
        <script>window.noise = 1</script>
        <p>&amp;amp; stays literal</p>
      </body></html>`;

    expect(lines(html)).toEqual(["Cashier's check & money order", "$10.00", "&amp; stays literal"]);
  });
  // Draw 275762, fee 37214: Salem Five's fee schedule (salemfive.com/feeschedule/). Every html_dom
  // copy since Oct 7 kept "Misc. Account Related Fees | Amount" and lost the rows under it; the
  // Oct 2 tag-strip copy had them. The page's raw bytes were not readable from this session (no
  // vault credentials, host blocked), so the wrapper element below is reconstructed: the reader
  // keeps a header row and drops its body rows only when the rows sit inside an element that is
  // not thead/tbody/tfoot.
  const SALEM_FIVE_MISC = `
    <h3>Miscellaneous</h3>
    <div class="accordion-body">
      <h4>Miscellaneous Fees</h4>
      <table class="fee-table">
        <thead><tr><th>Misc. Account Related Fees</th><th>Amount</th></tr></thead>
        <div class="fee-table__rows">
          <tr><td>Account Reconciliation (per hour)</td><td>$25.00</td></tr>
          <tr><td>Account Research (per hour)</td><td>$25.00</td></tr>
          <tr><td>Escheat Processing (unclaimed Property)</td><td>$100.00</td></tr>
          <tr><td>Legal Processing - Government Levy</td><td>$50.00</td></tr>
          <tr><td>Outgoing Wire Transfer - Domestic<sup>14</sup></td><td>$30.00</td></tr>
        </div>
      </table>
      <p><sup>14</sup>Additional charges may be assessed by intermediary bank(s).</p>
    </div>`;

  it("keeps table rows that sit inside a wrapper element, not only under thead/tbody/tfoot (draw 275762)", () => {
    const result = extractHtmlDomText(SALEM_FIVE_MISC);

    expect(lines(SALEM_FIVE_MISC)).toEqual([
      "Miscellaneous",
      "Miscellaneous Fees",
      "Misc. Account Related Fees | Amount",
      "Account Reconciliation (per hour) | $25.00",
      "Account Research (per hour) | $25.00",
      "Escheat Processing (unclaimed Property) | $100.00",
      "Legal Processing - Government Levy | $50.00",
      "Outgoing Wire Transfer - Domestic14 | $30.00",
      "14Additional charges may be assessed by intermediary bank(s).",
    ]);
    expect(result.tableRows).toBe(6);
    expect(result.rows.map((row) => row.header)).toEqual([true, false, false, false, false, false]);
  });

  it("keeps rows under a form, under a thead wrapper, and in an implicit second body", () => {
    const html = `
      <table>
        <thead><div><tr><th>Service</th><th>Fee</th></tr></div></thead>
        <tbody><tr><td>Stop payment</td><td>$30.00</td></tr></tbody>
        <tr><td>Cashier's check</td><td>$10.00</td></tr>
        <form><tr><td>Wire transfer - outgoing</td><td>$25.00</td></tr></form>
      </table>`;

    const result = extractHtmlDomText(html);

    expect(lines(html)).toEqual([
      "Service | Fee",
      "Stop payment | $30.00",
      "Cashier's check | $10.00",
      "Wire transfer - outgoing | $25.00",
    ]);
    expect(result.rows.map((row) => row.header)).toEqual([true, false, false, false]);
  });

  it("never takes a nested table's rows, or a row inside a cell, as the outer table's", () => {
    const html = `
      <table>
        <tr><th>Service</th><th>Fee</th></tr>
        <div><tr><td>Stop payment</td><td>$30.00</td></tr></div>
        <div><table><tr><td>Inner row</td><td>$1.00</td></tr></table></div>
      </table>`;

    const result = extractHtmlDomText(html);

    expect(result.rows.map((row) => row.cells)).toEqual([["Service", "Fee"], ["Stop payment", "$30.00"]]);
  });
});
