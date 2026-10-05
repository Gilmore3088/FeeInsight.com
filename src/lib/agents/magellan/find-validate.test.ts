// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { validateFeeCandidate } from "./find-validate";

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
});
