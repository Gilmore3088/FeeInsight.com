// @vitest-environment node
/**
 * End-to-end pipeline test: one real Atlas state-lane run, step by step, against a
 * Postgres database that has the production schema, with the bank websites served by
 * a stubbed fetch. Skipped unless E2E_DATABASE_URL points at such a throwaway database.
 *
 * Load tests/e2e/production-schema.sql (the production schema plus reference rows) into
 * an empty database first; the test seeds its own banks. CI does this on every push.
 * Never point it at a shared database: it deletes every VT institution first.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { scannedFeePdf } from "@/lib/agents/rosetta/test-fixtures/scanned-pdf";

const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;
const STATE = "VT";

const FEE_TABLE = `
  <h1>Schedule of Fees</h1>
  <p>Effective January 1, 2026</p>
  <table>
    <tr><th>Service</th><th>Fee</th></tr>
    <tr><td>Overdraft fee (per item)</td><td>$32.00</td></tr>
    <tr><td>Non-sufficient funds (NSF) fee</td><td>$30.00</td></tr>
    <tr><td>Monthly maintenance fee</td><td>$12.00</td></tr>
    <tr><td>Stop payment</td><td>$35.00</td></tr>
    <tr><td>Outgoing domestic wire transfer</td><td>$25.00</td></tr>
    <tr><td>Incoming domestic wire transfer</td><td>$15.00</td></tr>
    <tr><td>Foreign ATM withdrawal</td><td>$3.00</td></tr>
    <tr><td>Cashier's check</td><td>$10.00</td></tr>
    <tr><td>Paper statement fee</td><td>$3.00</td></tr>
  </table>`;

/** A minimal one-page PDF with real text objects, so the PDF reader has text to extract. */
function feePdf(lines: string[]): Uint8Array {
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
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
}

/** Two fake banks: one with only a homepage (discovery must find the fee page), one with a known fee URL. */
const SITE: Record<string, { body: string | Uint8Array; type: string }> = {
  "https://www.greenmountain-test-bank.com/": {
    type: "text/html",
    body: page("Green Mountain Test Bank", `
      <nav><a href="/personal">Personal</a> <a href="/about">About</a>
      <a href="/disclosures/fee-schedule">Fee Schedule</a></nav>
      <p>Welcome to Green Mountain Test Bank.</p>`),
  },
  "https://www.greenmountain-test-bank.com/disclosures/fee-schedule": {
    type: "text/html",
    body: page("Fee Schedule | Green Mountain Test Bank", FEE_TABLE),
  },
  "https://www.lakeside-test-bank.com/": {
    type: "text/html",
    body: page("Lakeside Test Bank", `<a href="/docs/schedule-of-fees.pdf">Schedule of Fees (PDF)</a>`),
  },
  "https://www.lakeside-test-bank.com/docs/schedule-of-fees.pdf": {
    type: "application/pdf",
    body: feePdf([
      "Lakeside Test Bank Schedule of Fees",
      "Overdraft fee per item $34.00",
      "Returned item NSF fee $34.00",
      "Monthly maintenance fee $8.00",
      "Stop payment request $30.00",
      "Outgoing domestic wire transfer $28.00",
      "Cashier's check $8.00",
      "Paper statement fee $2.00",
      "Foreign ATM withdrawal $2.50",
      "Incoming domestic wire transfer $12.00",
      "Account research per hour $25.00",
      "Fees are subject to change. See your account agreement for details.",
      "Member FDIC. Equal Housing Lender.",
    ]),
  },
  // Only in the site map: the homepage has no fee link and no guessed path matches.
  "https://www.maple-test-bank.com/": {
    type: "text/html",
    body: page("Maple Test Bank", `<a href="/about">About</a> <a href="/contact">Contact</a>`),
  },
  "https://www.maple-test-bank.com/sitemap.xml": {
    type: "application/xml",
    body: `<?xml version="1.0"?><urlset>
      <url><loc>https://www.maple-test-bank.com/about</loc></url>
      <url><loc>https://www.maple-test-bank.com/legal/disclosures/schedule-of-fees</loc></url>
    </urlset>`,
  },
  "https://www.maple-test-bank.com/legal/disclosures/schedule-of-fees": {
    type: "text/html",
    body: page("Schedule of Fees | Maple Test Bank", FEE_TABLE.replace("$32.00", "$27.00")),
  },
  // Only through a hub page: the homepage links to Disclosures, which links to the PDF.
  "https://www.birch-test-bank.com/": {
    type: "text/html",
    body: page("Birch Test Bank", `<a href="/about">About</a> <a href="/resources/disclosures">Disclosures</a>`),
  },
  "https://www.birch-test-bank.com/resources/disclosures": {
    type: "text/html",
    body: page("Disclosures | Birch Test Bank", `<ul>
      <li><a href="/resources/privacy-notice.pdf">Privacy Notice</a></li>
      <li><a href="/resources/documents/consumer-schedule-of-fees.pdf">Consumer Schedule of Fees</a></li>
    </ul>`),
  },
  "https://www.birch-test-bank.com/resources/documents/consumer-schedule-of-fees.pdf": {
    type: "application/pdf",
    body: feePdf([
      "Birch Test Bank Schedule of Fees",
      "Overdraft fee per item $36.00",
      "Returned item NSF fee $36.00",
      "Monthly maintenance fee $6.00",
      "Stop payment request $31.00",
      "Outgoing domestic wire transfer $29.00",
      "Cashier's check $9.00",
      "Paper statement fee $2.00",
      "Foreign ATM withdrawal $2.50",
      "Incoming domestic wire transfer $12.00",
      "Account research per hour $25.00",
      "Fees are subject to change. See your account agreement for details.",
      "Member FDIC. Equal Housing Lender.",
    ]),
  },
  // A scanner's PDF: page images only, no text objects. Rosetta's free OCR reads it.
  "https://www.ottercreek-test-bank.com/fee-schedule.pdf": {
    type: "application/pdf",
    body: scannedFeePdf([
      "OTTER CREEK TEST BANK",
      "SCHEDULE OF FEES",
      "OVERDRAFT FEE PER ITEM          $33.00",
      "MONTHLY MAINTENANCE FEE         $9.00",
      "STOP PAYMENT                    $31.00",
      "OUTGOING DOMESTIC WIRE          $27.00",
      "PAPER STATEMENT FEE             $4.00",
    ]),
  },
  "https://www.champlain-test-cu.org/fees": {
    type: "text/html",
    body: page("Fee Schedule | Champlain Test Credit Union", FEE_TABLE.replace("$32.00", "$29.00")),
  },
};

/**
 * A fee page with no table and no line that carries both a name and a "$" price: names and
 * prices on separate lines, a heading the bare directions under it belong to, and a dot
 * leader with no "$". Only Knox's pass 2 specialists (extract.table, extract.family.*) read it.
 */
const STACKED_FEES = `
  <h1>Fees and Service Charges</h1>
  <p>Courtesy Pay</p><p>$31.00</p>
  <p>Card Replacement</p><p>$10.00</p>
  <h2>Wire Transfers</h2>
  <p>Incoming Domestic</p><p>$14.00</p>
  <p>Outgoing Domestic</p><p>$26.00</p>
  <p>Stop Payment .................. 33.00</p>`;

SITE["https://www.willow-test-bank.com/fees"] = {
  type: "text/html",
  body: page("Fees | Willow Test Bank", STACKED_FEES),
};

function stubFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const normalized = url.replace(/\/$/, "") || url;
    const hit = SITE[url] ?? SITE[normalized] ?? SITE[`${normalized}/`];
    if (!hit) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(hit.body as BodyInit, { status: 200, headers: { "content-type": hit.type } });
  });
}

describe.skipIf(!E2E_DATABASE_URL)("pipeline end to end (state lane)", () => {
  let sql: typeof import("@/lib/data-store/connection").sql;
  const fetchMock = stubFetch();

  beforeAll(async () => {
    process.env.DATABASE_URL = E2E_DATABASE_URL;
    process.env.EXECUTION_BACKEND = "agentic_v1";
    vi.stubGlobal("fetch", fetchMock);
    ({ sql } = await import("@/lib/data-store/connection"));
    await sql`DELETE FROM institution_sources WHERE state_code = ${STATE}`;
    await sql`
      INSERT INTO institution_sources
        (institution_name, website_url, fee_schedule_url, charter_type, state, state_code, city, asset_size, cert_number, source, status)
      VALUES
        ('Green Mountain Test Bank', 'https://www.greenmountain-test-bank.com/', NULL, 'bank', 'Vermont', ${STATE}, 'Burlington', 900000, 'E2E-1', 'e2e', 'active'),
        ('Lakeside Test Bank', 'https://www.lakeside-test-bank.com/', NULL, 'bank', 'Vermont', ${STATE}, 'Rutland', 700000, 'E2E-3', 'e2e', 'active'),
        ('Maple Test Bank', 'https://www.maple-test-bank.com/', NULL, 'bank', 'Vermont', ${STATE}, 'Stowe', 500000, 'E2E-4', 'e2e', 'active'),
        ('Birch Test Bank', 'https://www.birch-test-bank.com/', NULL, 'bank', 'Vermont', ${STATE}, 'Barre', 450000, 'E2E-5', 'e2e', 'active'),
        ('Champlain Test Credit Union', 'https://www.champlain-test-cu.org/', 'https://www.champlain-test-cu.org/fees', 'credit_union', 'Vermont', ${STATE}, 'Montpelier', 400000, 'E2E-2', 'e2e', 'active'),
        ('Otter Creek Test Bank', 'https://www.ottercreek-test-bank.com/', 'https://www.ottercreek-test-bank.com/fee-schedule.pdf', 'bank', 'Vermont', ${STATE}, 'Middlebury', 300000, 'E2E-6', 'e2e', 'active'),
        ('Willow Test Bank', 'https://www.willow-test-bank.com/', 'https://www.willow-test-bank.com/fees', 'bank', 'Vermont', ${STATE}, 'Woodstock', 250000, 'E2E-7', 'e2e', 'active')
    `;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sql?.end({ timeout: 1 });
  });

  it("takes a homepage to published fees through every lane step", async () => {
    const { startStateLaneRun } = await import("@/lib/agents/state-lane-scheduler");
    const { executeAgentRun, getAgentRunSteps } = await import("@/lib/agents/run-store");

    const started = await startStateLaneRun({ stateCode: STATE, triggeredBy: "e2e", triggerSource: "admin" });
    for (let tick = 0; tick < 20; tick += 1) {
      const result = await executeAgentRun(started.run.id, { maxSteps: 10, allowProviderSteps: false });
      if (result.terminal || result.executedSteps === 0) break;
    }

    const steps = await getAgentRunSteps(started.run.id);
    const summary = steps.map((step) => ({ key: step.stepKey, status: step.status, error: step.error ?? null }));

    const catalog = await sql`
      SELECT inst.institution_name, c.fee_category, c.amount
        FROM published_fee_catalog c
        JOIN institution_sources inst ON inst.id = c.institution_id
       WHERE inst.state_code = ${STATE}
       ORDER BY c.institution_id, c.fee_category
    `;

    for (const step of summary.filter((s) => ["discover", "fetch", "read", "extract", "classify", "publish"].includes(s.key))) {
      expect(step, step.key).toMatchObject({ status: "completed" });
    }
    // With no paid budget configured, each paid last pass is skipped and the free steps
    // behind it still run.
    for (const key of ["discover-paid", "read-paid", "extract-paid"]) {
      expect(summary.find((s) => s.key === key), key).toMatchObject({ status: "skipped" });
    }
    const published = (name: string) =>
      Object.fromEntries(
        catalog
          .filter((row) => row.institution_name === name)
          .map((row) => [String(row.fee_category), Number(row.amount)]),
      );
    const tableFees = {
      overdraft: 32,
      nsf: 30,
      monthly_maintenance: 12,
      stop_payment: 35,
      wire_domestic_outgoing: 25,
      wire_domestic_incoming: 15,
      atm_non_network: 3,
      cashiers_check: 10,
      paper_statement: 3,
    };
    // Found from a homepage link, read from HTML.
    expect(published("Green Mountain Test Bank")).toEqual(tableFees);
    // Known fee URL, read from HTML.
    expect(published("Champlain Test Credit Union")).toEqual({ ...tableFees, overdraft: 29 });
    // Found from a homepage link, read from a text PDF (curly apostrophe in "Cashier’s").
    expect(published("Lakeside Test Bank")).toEqual({
      overdraft: 34,
      nsf: 34,
      monthly_maintenance: 8,
      stop_payment: 30,
      wire_domestic_outgoing: 28,
      cashiers_check: 8,
      paper_statement: 2,
      atm_non_network: 2.5,
      wire_domestic_incoming: 12,
      account_research: 25,
    });
    // Found only in the site map (pass 1, discover.sitemap), read from HTML.
    expect(published("Maple Test Bank")).toEqual({ ...tableFees, overdraft: 27 });
    // Found only one click deep through the Disclosures hub page (discover.hub_pages), read from a PDF.
    expect(published("Birch Test Bank")).toEqual({
      overdraft: 36,
      nsf: 36,
      monthly_maintenance: 6,
      stop_payment: 31,
      wire_domestic_outgoing: 29,
      cashiers_check: 9,
      paper_statement: 2,
      atm_non_network: 2.5,
      wire_domestic_incoming: 12,
      account_research: 25,
    });

    // Every specialist that ran is in the attempt log with its own strategy and outcome.
    const tries = await sql`
      SELECT inst.institution_name, pa.strategy, pa.outcome, pa.detail->>'code' AS code
        FROM pipeline_attempts pa
        JOIN institution_sources inst ON inst.id = pa.institution_id
       WHERE inst.state_code = ${STATE} AND pa.stage = 'discover'
       ORDER BY pa.id
    `;
    const triesFor = (name: string) =>
      tries.filter((row) => row.institution_name === name).map((row) => [String(row.strategy), String(row.outcome)]);
    expect(triesFor("Maple Test Bank")).toEqual([
      ["discover.homepage_links", "no_candidates"],
      ["discover.sitemap", "ok"],
    ]);
    expect(triesFor("Birch Test Bank")).toEqual([
      ["discover.homepage_links", "no_candidates"],
      ["discover.sitemap", "no_candidates"],
      ["discover.hub_pages", "ok"],
    ]);
    expect(tries.find((row) => row.institution_name === "Birch Test Bank" && row.strategy === "discover.hub_pages")?.code).toBe("found_deep");
    // A scanned PDF with no text layer: free OCR (pass 2) read it in the same read step,
    // and Knox extracted its fees like any other text.
    expect(published("Otter Creek Test Bank")).toEqual({
      overdraft: 33,
      monthly_maintenance: 9,
      stop_payment: 31,
      wire_domestic_outgoing: 27,
      paper_statement: 4,
    });

    // The HTML fee table was also stored as structured rows for Knox (table_rows contract).
    const texts = await sql`
      SELECT inst.institution_name, adt.status, adt.reader, adt.table_rows
        FROM agent_source_texts adt
        JOIN institution_sources inst ON inst.id = adt.institution_id
       WHERE inst.state_code = ${STATE} AND adt.status = 'completed'
    `;
    const byName = Object.fromEntries(texts.map((row) => [String(row.institution_name), row]));
    const greenRows = (byName["Green Mountain Test Bank"].table_rows as { version: number; rows: Array<Record<string, unknown>> });
    expect(byName["Green Mountain Test Bank"].reader).toBe("read.html_dom");
    expect(greenRows.version).toBe(1);
    expect(greenRows.rows[0]).toMatchObject({ cells: ["Service", "Fee"], header: true, origin: "html_table" });
    expect(greenRows.rows).toContainEqual({ table: 0, page: null, cells: ["Overdraft fee (per item)", "$32.00"], header: false, origin: "html_table" });
    expect(greenRows.rows).toHaveLength(10);
    expect(byName["Otter Creek Test Bank"].reader).toBe("read.ocr_tesseract");
    const attempts = await sql`
      SELECT pa.strategy, pa.outcome
        FROM pipeline_attempts pa
        JOIN institution_sources inst ON inst.id = pa.institution_id
       WHERE inst.institution_name = 'Otter Creek Test Bank' AND pa.stage = 'read'
       ORDER BY pa.id
    `;
    expect(attempts.map((row) => `${row.strategy}:${row.outcome}`)).toEqual(
      expect.arrayContaining(["read.pdf_layout:scanned_pdf", "read.ocr_tesseract:ok"]),
    );
    // Stacked name/price lines and a "$"-less dot leader: read only by the pass 2 specialists.
    expect(published("Willow Test Bank")).toEqual({
      overdraft: 31,
      card_replacement: 10,
      wire_domestic_incoming: 14,
      wire_domestic_outgoing: 26,
      stop_payment: 33,
    });
  }, 120_000);
});
