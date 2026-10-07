import { describe, expect, it } from "vitest";

import { alternateDocumentUrls, embeddedDataText, looksLikeJsShell, samePageKey, staticVariantUrls } from "./js-fallback";

describe("Rosetta JavaScript-page fallbacks", () => {
  it("recognizes an app shell", () => {
    expect(looksLikeJsShell("<div id=\"root\"></div>", "")).toBe(true);
    expect(looksLikeJsShell("<div id=\"__next\"></div><script>1</script>", "Home | Personal | Business")).toBe(true);
    expect(looksLikeJsShell("<p>Welcome</p>", "Welcome")).toBe(false);
  });

  it("reads fee rows out of __NEXT_DATA__ and ld+json, pairing names with amounts", () => {
    const html = `<div id="__next"></div>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { pageProps: { fees: [
          { name: "Overdraft fee", amount: 35, id: "a1" },
          { name: "Stop payment", price: "$30.00" },
        ], body: "<table><tr><td>Outgoing wire</td><td>$25.00</td></tr></table>" } },
      })}</script>
      <script type="application/ld+json">{"@type":"WebPage","name":"Schedule of Fees"}</script>`;
    const text = embeddedDataText(html);
    expect(text).toContain("Overdraft fee | $35.00");
    expect(text).toContain("Stop payment | $30.00");
    expect(text).toContain("Outgoing wire | $25.00");
    expect(text).toContain("Schedule of Fees");
  });

  it("reads inline state and Next.js flight chunks", () => {
    const html = `<script>window.__INITIAL_STATE__ = {"fees":[{"label":"NSF fee","fee":34}]};</script>
      <script>self.__next_f.push([1,"Paper statement fee $3.00"])</script>`;
    const text = embeddedDataText(html);
    expect(text).toContain("NSF fee | $34.00");
    expect(text).toContain("Paper statement fee $3.00");
    expect(embeddedDataText("<script>console.log(1)</script>")).toBe("");
  });

  it("finds PDF and print versions the page links to, PDFs first", () => {
    const html = `<a href="/fees/print">Print this fee schedule</a>
      <a href="/docs/fee-schedule.pdf">Download</a>
      <a href="/docs/annual-report.pdf">Annual report</a>
      <link rel="amphtml" href="https://bank.example/fees.amp">`;
    expect(alternateDocumentUrls(html, "https://bank.example/fees")).toEqual([
      "https://bank.example/docs/fee-schedule.pdf",
      "https://bank.example/fees/print",
      "https://bank.example/fees.amp",
    ]);
  });

  it("follows links that name the fee schedule even with no .pdf ending, never the page itself", () => {
    // visionsfcu.org and cu-rockies.org serve their schedules from paths like these (Oct 7).
    const html = `<nav><a href="https://www.bank.example/fee-schedule/">Fee Schedule</a><a href="/rates">Rates &amp; Fees</a></nav>
      <a href="/documents/general/service-charge-fee-schedule-effective-june-2026">Consumer Service Charge &amp; Fee Schedule</a>
      <a href="/files/1234">Schedule of Charges</a>
      <a href="/fee-schedule/print">Print this fee schedule</a>
      <a href="/docs/fees.pdf">Download</a>
      <a href="/about">About us</a>`;
    expect(alternateDocumentUrls(html, "https://bank.example/fee-schedule")).toEqual([
      "https://bank.example/docs/fees.pdf",
      "https://bank.example/documents/general/service-charge-fee-schedule-effective-june-2026",
      "https://bank.example/files/1234",
      "https://bank.example/fee-schedule/print",
    ]);
    expect(samePageKey("https://www.Bank.example/Fee-Schedule/")).toBe(samePageKey("https://bank.example/fee-schedule"));
  });

  it("tries common static variants of the same URL", () => {
    expect(staticVariantUrls("https://bank.example/fees?x=1")).toEqual([
      "https://bank.example/fees?x=1&print=1",
      "https://bank.example/fees?x=1&output=amp",
      "https://bank.example/fees/print?x=1",
    ]);
  });
});
