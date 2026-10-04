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
});
