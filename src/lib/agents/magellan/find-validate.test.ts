// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { looksLikeProductPage, mainContentText, validateFeeCandidate } from "./find-validate";

/** A minimal one-page PDF with real text objects (no lines: an image-only "scan"). */
function pdf(lines: string[]): Uint8Array {
  const text = lines
    .map((line, index) => `BT /F1 11 Tf 72 ${740 - index * 18} Td (${line.replace(/[()\\]/g, "")}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function serve(body: BodyInit, contentType: string) {
  return vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": contentType } }));
}

const candidate = (url: string, score = 0.9) => ({ url, score, reasons: ["schedule of fees"] });

describe("Magellan fee-page check", () => {
  it("accepts a text PDF that lists fees", async () => {
    const bytes = pdf(["Schedule of Fees", "Overdraft fee $32.00", "NSF fee $30.00", "Stop payment $35.00", "Wire transfer fee $25.00"]);
    const result = await validateFeeCandidate(candidate("https://a.example/fees.pdf"), serve(bytes as BodyInit, "application/pdf"));
    expect(result).toMatchObject({ ok: true, documentType: "pdf", verdict: "accepted_pdf" });
    // The shadow page classifier scores the same text the rule check read.
    expect(result.scoringText).toContain("Overdraft fee $32.00");
  });

  it("rejects a press release PDF even with a fee-like link", async () => {
    const bytes = pdf([
      "FOR IMMEDIATE RELEASE",
      "First Example Bank announces new branch in Springfield",
      "The bank is proud to serve the community for 100 years.",
      "Contact our media team for more information.",
    ]);
    const result = await validateFeeCandidate(candidate("https://a.example/news/fee-schedule-update.pdf"), serve(bytes as BodyInit, "application/pdf"));
    expect(result).toMatchObject({ ok: false, verdict: "not_fee_page" });
  });

  it("rejects a rate sheet PDF", async () => {
    const bytes = pdf([
      "Deposit Rates",
      "Savings 0.50% APY minimum $100",
      "Money Market 1.10% APY minimum $2,500",
      "12 month CD 4.00% APY minimum $500",
      "IRA 3.50% APY minimum $500",
      "Annual Percentage Yield accurate as of today",
    ]);
    const result = await validateFeeCandidate(candidate("https://a.example/rates-and-fees.pdf"), serve(bytes as BodyInit, "application/pdf"));
    expect(result).toMatchObject({ ok: false, verdict: "rate_page" });
  });

  it("accepts a scanned PDF only on a strong fee label", async () => {
    const scan = pdf([]);
    const strong = await validateFeeCandidate(candidate("https://a.example/schedule-of-fees.pdf", 0.9), serve(scan as BodyInit, "application/pdf"));
    expect(strong).toMatchObject({ ok: true, verdict: "accepted_pdf_unreadable" });
    const weak = await validateFeeCandidate(candidate("https://a.example/doc.pdf", 0.6), serve(scan as BodyInit, "application/pdf"));
    expect(weak).toMatchObject({ ok: false, verdict: "unreadable_pdf_weak_label" });
  });

  it("rejects an HTML page served as a .pdf link", async () => {
    const result = await validateFeeCandidate(candidate("https://a.example/fees.pdf"), serve("<p>Page not found</p>", "application/pdf"));
    expect(result).toMatchObject({ ok: false, verdict: "not_a_pdf" });
  });

  it("rejects a checking account page whose footer names the fee schedule", async () => {
    const html = `<html><body><nav><a href="/fees">Fee Schedule</a> <a href="/tis">Truth in Savings</a></nav>
      <h1>Simple Checking</h1><p>Earn rewards with every swipe.</p><p>Monthly service charge $5, waived with direct deposit.</p>
      <footer>Fee Schedule | Truth in Savings | Privacy</footer></body></html>`;
    const result = await validateFeeCandidate(candidate("https://a.example/personal/checking/simple-checking", 0.9), serve(html, "text/html"));
    expect(result).toMatchObject({ ok: false, verdict: "product_page" });
  });

  it("still accepts a product address that lists the full fee schedule", async () => {
    const items = ["Overdraft fee $32", "NSF fee $30", "Stop payment fee $25", "Monthly service charge $8", "Wire transfer fee $25", "Cashier's check fee $10", "Statement copy fee $5", "Dormant account fee $5", "Account research fee $25", "Debit card replacement fee $5"];
    const html = `<html><body><h1>Checking accounts</h1><ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul></body></html>`;
    const result = await validateFeeCandidate(candidate("https://a.example/personal/checking", 0.6), serve(html, "text/html"));
    expect(result).toMatchObject({ ok: true, verdict: "accepted_html" });
  });

  it("accepts a fee-named page with fee words but few amounts", async () => {
    const html = `<html><body><h1>Schedule of Fees</h1><p>Overdraft fee and NSF fee: see the table below.</p><p>Wire transfer fee $25</p></body></html>`;
    const result = await validateFeeCandidate(candidate("https://a.example/schedule-of-fees", 0.7), serve(html, "text/html"));
    expect(result).toMatchObject({ ok: true, verdict: "accepted_html" });
  });

  it("does not count menu and footer fee words", () => {
    const text = mainContentText("<nav>Fee Schedule</nav><main>Hello</main><footer>Truth in Savings</footer>").toLowerCase();
    expect(text).not.toContain("fee schedule");
    expect(text).not.toContain("truth in savings");
  });

  it("tells product pages from fee pages by address", () => {
    expect(looksLikeProductPage("https://a.example/personal/checking-accounts")).toBe(true);
    expect(looksLikeProductPage("https://a.example/savings")).toBe(true);
    expect(looksLikeProductPage("https://a.example/personal/checking/fee-schedule")).toBe(false);
    expect(looksLikeProductPage("https://a.example/checking-disclosures.pdf")).toBe(false);
    expect(looksLikeProductPage("https://a.example/fees")).toBe(false);
    expect(looksLikeProductPage("https://a.example/personal.html")).toBe(true);
    expect(looksLikeProductPage("https://a.example/account-services")).toBe(false);
  });

  it("rejects a product page that lists a few fees as the bank's fee link (#1053)", async () => {
    const lines = "<p>Monthly service charge $5.00</p><p>Overdraft fee $30.00</p><p>Paper statement fee $2.00</p><p>ATM fee $2.50</p>";
    const html = `<html><body><main><h1>Personal Checking</h1>${lines}</main></body></html>`;
    const result = await validateFeeCandidate(candidate("https://a.example/personal/checking", 0.9), serve(html, "text/html"));
    expect(result).toMatchObject({ ok: false, verdict: "product_page" });
    const schedule = `<html><body><main><h1>Schedule of Fees</h1>${lines}</main></body></html>`;
    expect(await validateFeeCandidate(candidate("https://a.example/personal/checking", 0.9), serve(schedule, "text/html"))).toMatchObject({ ok: true });
  });
});

describe("business-only schedules", () => {
  const page = (body: string) => vi.fn(async () => new Response(`<html><body><main>${body}</main></body></html>`, { status: 200, headers: { "content-type": "text/html" } }));
  const lines = "<p>Overdraft fee $35.00</p><p>Stop payment $30.00</p><p>Wire $25.00</p><p>Cashier's check $10.00</p>";

  it("rejects a link whose address names a business-only schedule without opening it", async () => {
    const fetchImpl = page(lines);
    const result = await validateFeeCandidate({ url: "https://bank.example/uploads/Business-Account-Fee-Schedule.pdf", score: 0.9, reasons: [] }, fetchImpl);
    expect(result).toMatchObject({ ok: false, verdict: "business_schedule" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an article about fees without opening it, and keeps a fee document filed under articles", async () => {
    const fetchImpl = page(lines);
    const article = await validateFeeCandidate({ url: "https://www.sccu.com/articles/personal-finance/common-checking-account-fees-to-avoid", score: 0.9, reasons: [] }, fetchImpl);
    expect(article).toMatchObject({ ok: false, verdict: "article_page" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const schedule = await validateFeeCandidate({ url: "https://www.mtcfederal.com/articles/schedule-of-fees/", score: 0.9, reasons: [] }, fetchImpl);
    expect(schedule.verdict).not.toBe("article_page");
  });

  it("rejects one product's disclosure without opening it", async () => {
    const fetchImpl = page(lines);
    const disclosure = await validateFeeCandidate({ url: "https://www.fiveriversbank.com/documents/truth-in-savings-12-month-time-deposit-disclosure", score: 0.9, reasons: [] }, fetchImpl);
    expect(disclosure).toMatchObject({ ok: false, verdict: "single_product_disclosure" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects another country's schedule by its domain without opening it, and by its currency once read", async () => {
    const fetchImpl = page(lines);
    const foreignHost = await validateFeeCandidate({ url: "https://www.southeastbank.com.bd/documents/schedule-of-charges.pdf", score: 0.95, reasons: [] }, fetchImpl);
    expect(foreignHost).toMatchObject({ ok: false, verdict: "foreign_schedule" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const ownSite = await validateFeeCandidate({ url: "https://www.nbc.ca/natbank/fees", score: 0.95, reasons: [], websiteUrl: "https://www.nbc.ca/natbank" }, page(lines));
    expect(ownSite.verdict).not.toBe("foreign_schedule");
    const taka = "<h1>Schedule of Charges</h1>" + [
      "Account maintenance fee Tk 500", "Cheque book issue fee Tk 10 per leaf", "Debit card annual fee BDT 1,000",
      "Statement fee Tk 50", "Stop payment fee Tk 100", "Standing instruction fee Tk 200",
    ].map((line) => `<p>${line}</p>`).join("");
    const foreignText = await validateFeeCandidate({ url: "https://www.citigroup.com/rcs/citigpa/storage/public/Schedule_of_Charges.html", score: 0.95, reasons: [] }, page(taka));
    expect(foreignText).toMatchObject({ ok: false, verdict: "foreign_schedule" });
  });

  it("rejects a page whose own heading is a business schedule, and keeps a combined one", async () => {
    const business = await validateFeeCandidate({ url: "https://bank.example/fees", score: 0.9, reasons: [] }, page(`<h1>Business Account Fee Schedule</h1>${lines}`));
    expect(business).toMatchObject({ ok: false, verdict: "business_schedule" });
    const combined = await validateFeeCandidate({ url: "https://bank.example/fees", score: 0.9, reasons: [] }, page(`<h1>Schedule of Fees</h1><p>Personal and business accounts</p>${lines}`));
    expect(combined.ok).toBe(true);
  });
});

describe("the bank's own documents only (#1033)", () => {
  const html = "<html><body><main><h1>Schedule of Fees</h1><p>Overdraft fee $30.00</p><p>NSF fee $30.00</p><p>Stop payment fee $25.00</p><p>Wire transfer fee $20.00</p></main></body></html>";

  it("refuses a fee page on another host that does not name the bank", async () => {
    const result = await validateFeeCandidate({ url: "https://www.usfcu.com/schedule-of-fees", score: 0.9, reasons: [], websiteUrl: "http://www.usffcu.com", institutionName: "USF Federal Credit Union" }, serve(html, "text/html"));
    expect(result).toMatchObject({ ok: false, verdict: "unconfirmed_host" });
  });

  it("keeps one that names the bank, and judges nothing without the bank's website", async () => {
    const named = html.replace("<h1>Schedule of Fees</h1>", "<h1>USF Federal Credit Union Schedule of Fees</h1>");
    expect(await validateFeeCandidate({ url: "https://www.usfcu.com/schedule-of-fees", score: 0.9, reasons: [], websiteUrl: "http://www.usffcu.com", institutionName: "USF Federal Credit Union" }, serve(named, "text/html"))).toMatchObject({ ok: true });
    expect(await validateFeeCandidate({ url: "https://www.usfcu.com/schedule-of-fees", score: 0.9, reasons: [] }, serve(html, "text/html"))).toMatchObject({ ok: true });
  });

  it("refuses a CRA public file without opening it", async () => {
    const fetchImpl = serve(html, "text/html");
    const result = await validateFeeCandidate({ url: "https://bank.example/uploads/CRA-Public-File-2025.pdf", score: 0.9, reasons: [] }, fetchImpl);
    expect(result).toMatchObject({ ok: false, verdict: "non_fee_document" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("judged where it landed (#1051)", () => {
  it("rejects a fee-schedule address that redirects to a checking page", async () => {
    const productPage = "<h1>Personal Checking</h1><p>Monthly maintenance fee $10.00</p><p>Overdraft fee $32.00</p>" +
      "<p>Stop payment fee $35.00</p><p>Paper statement fee $3.00</p>";
    const fetchImpl = vi.fn(async () => {
      const landed = new Response(productPage, { status: 200, headers: { "content-type": "text/html" } });
      Object.defineProperty(landed, "url", { value: "https://bank.example/personal/checking" });
      return landed;
    });

    const result = await validateFeeCandidate(candidate("https://bank.example/fee-schedule"), fetchImpl);

    expect(result).toMatchObject({ ok: false, verdict: "product_page", finalUrl: "https://bank.example/personal/checking" });
  });
  const redirectedTo = (landedUrl: string, body: BodyInit, contentType: string) =>
    vi.fn(async () => {
      const landed = new Response(body, { status: 200, headers: { "content-type": contentType } });
      Object.defineProperty(landed, "url", { value: landedUrl });
      return landed;
    });

  it("still reads a .pdf link that lands on a download address with no extension", async () => {
    const result = await validateFeeCandidate(
      candidate("https://bank.example/docs/fee-schedule.pdf", 0.95),
      redirectedTo("https://cdn.example.net/download?id=81", "not a pdf body", "application/octet-stream"),
    );

    expect(result.verdict).not.toBe("unsupported_type");
  });

  it("still accepts a short fee page whose fee address lands on a CMS address", async () => {
    const shortPage = "<h1>Fee Schedule</h1><p>Service charges and fees</p><p>Overdraft fee $30.00</p>";
    const direct = await validateFeeCandidate(candidate("https://bank.example/fee-schedule", 0.5), serve(shortPage, "text/html"));
    const result = await validateFeeCandidate(
      candidate("https://bank.example/fee-schedule", 0.5),
      redirectedTo("https://bank.example/page.aspx?id=123", shortPage, "text/html"),
    );

    expect(direct.ok).toBe(true);
    expect(result).toMatchObject({ ok: true, finalUrl: "https://bank.example/page.aspx?id=123" });
  });
});
