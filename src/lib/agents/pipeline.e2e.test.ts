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
  // Overdraft far below its Vermont peers: Darwin's peer check must hold it for review.
  "https://www.ottercreek-test-bank.com/fees": {
    type: "text/html",
    body: page("Fee Schedule | Otter Creek Test Bank", FEE_TABLE.replace("$32.00", "$5.00")),
  },
  "https://www.champlain-test-cu.org/fees": {
    type: "text/html",
    body: page("Fee Schedule | Champlain Test Credit Union", FEE_TABLE.replace("$32.00", "$29.00")),
  },
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
        ('Champlain Test Credit Union', 'https://www.champlain-test-cu.org/', 'https://www.champlain-test-cu.org/fees', 'credit_union', 'Vermont', ${STATE}, 'Montpelier', 400000, 'E2E-2', 'e2e', 'active'),
        ('Otter Creek Test Bank', 'https://www.ottercreek-test-bank.com/', 'https://www.ottercreek-test-bank.com/fees', 'bank', 'Vermont', ${STATE}, 'Middlebury', 600000, 'E2E-4', 'e2e', 'active')
    `;
    // Nine Vermont peers (community_mid) with overdraft already published at $28-$34,
    // so the state expert has a peer level for Darwin's peer check. No website: the
    // lane never tries to crawl them.
    await sql`
      WITH peers AS (
        INSERT INTO institution_sources
          (institution_name, charter_type, state, state_code, asset_size, source, status, rescue_status)
        SELECT 'Peer Test Bank ' || g, 'bank', 'Vermont', ${STATE}, 500000, 'e2e', 'active', 'dead'
          FROM generate_series(1, 9) g
        RETURNING id
      ), raw AS (
        INSERT INTO raw_fee_observations (institution_id, agent_event_id, fee_name, amount, source, source_url)
        SELECT id, gen_random_uuid(), 'Overdraft fee', 28 + (id % 7), 'manual_import', 'https://peer.example/fees'
          FROM peers
        RETURNING fee_raw_id, institution_id, amount
      ), verified AS (
        INSERT INTO verified_fee_observations
          (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, source_url)
        SELECT fee_raw_id, institution_id, 'overdraft', gen_random_uuid(), 'Overdraft fee', amount, 'https://peer.example/fees'
          FROM raw
        RETURNING fee_verified_id, institution_id, amount
      )
      INSERT INTO published_fee_records
        (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, source_url)
      SELECT fee_verified_id, institution_id, 'overdraft', gen_random_uuid(), 'Overdraft fee', amount, 'https://peer.example/fees'
        FROM verified
    `;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sql?.end({ timeout: 1 });
  });

  let laneRunId = 0;

  it("takes a homepage to published fees through every lane step", async () => {
    const { startStateLaneRun } = await import("@/lib/agents/state-lane-scheduler");
    const { executeAgentRun, getAgentRunSteps } = await import("@/lib/agents/run-store");

    const started = await startStateLaneRun({ stateCode: STATE, triggeredBy: "e2e", triggerSource: "admin" });
    laneRunId = started.run.id;
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

    for (const step of summary.filter((s) => ["state-expert", "discover", "fetch", "read", "extract", "classify", "publish"].includes(s.key))) {
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
  }, 120_000);

  it("refreshes the Vermont expert's memory and holds a peer outlier for review", async () => {
    expect(laneRunId).toBeGreaterThan(0);
    const { getAgentRunSteps } = await import("@/lib/agents/run-store");
    const steps = await getAgentRunSteps(laneRunId);
    expect(steps.slice(0, 2).map((step) => step.stepKey)).toEqual(["enhance", "state-expert"]);
    const expertStep = steps.find((step) => step.stepKey === "state-expert");
    expect(expertStep?.status).toBe("completed");

    const [memory] = await sql`SELECT * FROM state_memory WHERE state_code = ${STATE}`;
    expect(memory).toMatchObject({ expert_name: "Justin S. Morrill" });
    expect(Number(memory.last_agent_run_id)).toBe(laneRunId);
    expect(memory.regulator).toMatchObject({ agency: "Vermont Department of Financial Regulation" });
    expect(memory.peer_levels).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalFeeKey: "overdraft", tier: "all", count: 9 }),
      expect.objectContaining({ canonicalFeeKey: "overdraft", tier: "community_mid", count: 9 }),
    ]));

    // Darwin flagged Otter Creek's $5 overdraft (peer range p25/3 .. p75*3) into review.
    const flags = await sql`
      SELECT pa.outcome, pa.detail
        FROM pipeline_attempts pa
        JOIN institution_sources inst ON inst.id = pa.institution_id
       WHERE pa.agent_run_id = ${laneRunId}
         AND pa.strategy = 'verify.peer_range'
         AND inst.institution_name = 'Otter Creek Test Bank'
         AND pa.detail->>'canonical_fee_key' = 'overdraft'
    `;
    expect(flags).toHaveLength(1);
    expect(flags[0].outcome).toBe("evidence_mismatch");
    expect(flags[0].detail).toMatchObject({ peer_outlier: true, decision: "needs_review", amount: 5 });
    expect(String(flags[0].detail.reason)).toContain("outside the community mid state peer range");

    // The good banks' overdrafts passed the same check.
    const passed = await sql`
      SELECT COUNT(*)::int AS n FROM pipeline_attempts
       WHERE agent_run_id = ${laneRunId} AND strategy = 'verify.peer_range' AND outcome = 'ok'
    `;
    expect(passed[0].n).toBeGreaterThanOrEqual(3);

    // The outlier is held back; the bank's other fees publish.
    const otter = await sql`
      SELECT c.fee_category FROM published_fee_catalog c
        JOIN institution_sources inst ON inst.id = c.institution_id
       WHERE inst.institution_name = 'Otter Creek Test Bank'
    `;
    const categories = otter.map((row) => String(row.fee_category));
    expect(categories).not.toContain("overdraft");
    expect(categories).toEqual(expect.arrayContaining(["nsf", "monthly_maintenance", "stop_payment"]));

    // Hamilton's report hook sees the expert, the peer level and the outlier.
    const { stateExpertSummary } = await import("@/lib/agents/hamilton/state-expert-summary");
    const report = await stateExpertSummary(STATE);
    expect(report).toMatchObject({ expertName: "Justin S. Morrill", source: "memory" });
    expect(report?.peerLevels.map((level) => level.canonicalFeeKey)).toContain("overdraft");
    expect(report?.notableOutliers).toEqual([
      expect.objectContaining({ institutionName: "Otter Creek Test Bank", canonicalFeeKey: "overdraft", amount: 5 }),
    ]);
  }, 60_000);
});
