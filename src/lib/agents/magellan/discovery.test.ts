import { describe, expect, it, vi } from "vitest";

import { runMagellanDiscovery } from "./discovery";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("FROM institution_sources")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
  return db;
}

function asDiscoveryDb(db: DbMock): NonNullable<Parameters<typeof runMagellanDiscovery>[0]["db"]> {
  return db as unknown as NonNullable<Parameters<typeof runMagellanDiscovery>[0]["db"]>;
}

function response(body: string, contentType = "text/html", status = 200): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

describe("Magellan agentic discovery", () => {
  it("discovers a homepage fee schedule link and writes institution plus discovery evidence", async () => {
    const db = createDbMock([
      {
        id: 42,
        institution_name: "Test Bank",
        website_url: "https://testbank.example",
        state_code: "CA",
        asset_size: "1000000",
        rescue_status: null,
      },
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response('<a href="/schedule-of-fees.pdf">Schedule of Fees</a>'))
      .mockResolvedValueOnce(response("%PDF", "application/pdf"));

    const result = await runMagellanDiscovery({
      runId: 101,
      limit: 500,
      db: asDiscoveryDb(db),
      fetchImpl,
    });

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      discovered: 1,
      dead: 0,
      needsHuman: 0,
      retryAfter: 0,
      attemptedUrls: 2,
      limit: 50,
      dryRun: false,
    });
    expect(result.results[0]).toMatchObject({
      institutionId: 42,
      outcome: "discovered",
      url: "https://testbank.example/schedule-of-fees.pdf",
      documentType: "pdf",
    });

    const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(sqlText).toContain("UPDATE institution_sources");
    expect(sqlText).toContain("INSERT INTO agent_url_discovery_attempts");
  });

  it("keeps dry runs read-only while still reporting possible discoveries", async () => {
    const db = createDbMock([
      {
        id: 43,
        institution_name: "Dry Run CU",
        website_url: "dryrun.example",
        state_code: "WA",
        asset_size: "100",
        rescue_status: null,
      },
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response('<a href="/fees">Account Fees</a>'))
      .mockResolvedValueOnce(response("monthly maintenance fee overdraft fee atm fee"));

    const result = await runMagellanDiscovery({
      runId: 102,
      dryRun: true,
      db: asDiscoveryDb(db),
      fetchImpl,
    });

    expect(result.discovered).toBe(1);
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("marks successful homepage scans with no fee-like links as no source found", async () => {
    const db = createDbMock([
      {
        id: 44,
        institution_name: "No Links Bank",
        website_url: "https://nolinks.example",
        state_code: "OR",
        asset_size: "50",
        rescue_status: null,
      },
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response('<a href="/careers">Careers</a>'))
      .mockResolvedValue(response("", "text/html", 404));

    const result = await runMagellanDiscovery({
      runId: 103,
      db: asDiscoveryDb(db),
      fetchImpl,
    });

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      discovered: 0,
      dead: 1,
      attemptedUrls: 4,
    });
    const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(sqlText).toContain("INSERT INTO agent_url_discovery_attempts");
    expect(db.mock.calls.some((call) => call.includes("magellan_dead"))).toBe(true);
  });

  it("selects never-attempted and oldest retryable rows instead of terminal rescue rows", async () => {
    const db = createDbMock([]);
    const fetchImpl = vi.fn();

    await runMagellanDiscovery({
      runId: 104,
      db: asDiscoveryDb(db),
      fetchImpl,
    });

    const sqlText = templateText(db.mock.calls[0][0]);
    expect(sqlText).toContain("COALESCE(inst.rescue_status, 'pending') IN ('pending', 'retry_after')");
    expect(sqlText).toContain("inst.last_rescue_attempt_at < NOW() - INTERVAL '12 hours'");
    expect(sqlText).toContain("CASE WHEN inst.last_rescue_attempt_at IS NULL THEN 0 ELSE 1 END");
    expect(sqlText).toContain("inst.last_rescue_attempt_at NULLS FIRST");
    expect(sqlText).toContain("CASE WHEN inst.rescue_status = 'retry_after' THEN 1 ELSE 0 END");
  });

  it("filters discovery candidates by state lane", async () => {
    const db = createDbMock([]);
    const fetchImpl = vi.fn();

    await runMagellanDiscovery({
      runId: 105,
      stateCode: "CA",
      db: asDiscoveryDb(db),
      fetchImpl,
    });

    const sqlText = templateText(db.mock.calls[0][0]);
    expect(sqlText).toContain("upper(btrim(inst.state_code))");
    expect(sqlText).toContain("institution_source_profiles");
    expect(sqlText).toContain("COALESCE(profile.read_strategy, '') <> 'manual_review'");
    expect(sqlText).toContain("COALESCE(profile.source_kind, 'unknown') <> 'offline'");
  });

  it("uses a locked corrected source URL before crawling the homepage", async () => {
    const db = createDbMock([
      {
        id: 45,
        institution_name: "Corrected Bank",
        website_url: "https://corrected.example",
        state_code: "CA",
        asset_size: "100",
        rescue_status: null,
        profile_canonical_source_url: "https://corrected.example/fees.pdf",
        profile_source_kind: "pdf",
        profile_locked_by_correction: true,
      },
    ]);
    const fetchImpl = vi.fn();

    const result = await runMagellanDiscovery({
      runId: 106,
      db: asDiscoveryDb(db),
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({
      institutionId: 45,
      outcome: "discovered",
      url: "https://corrected.example/fees.pdf",
      documentType: "pdf",
      confidence: 1,
    });
  });

  describe("fee-page check and rejected URLs", () => {
    const bank = {
      id: 47,
      institution_name: "Footer Bank",
      website_url: "https://footer.example",
      state_code: "GA",
      asset_size: "1000",
      rescue_status: "pending",
    };

    function vaultDb(rejected: string[]): DbMock {
      return vi.fn((strings: TemplateStringsArray) => {
        const text = templateText(strings);
        if (text.includes("vault_schema_ready")) return Promise.resolve([{ vault_schema_ready: true }]);
        if (text.includes("FROM institution_sources")) return Promise.resolve([bank]);
        if (text.includes("rejected_source_urls")) {
          return Promise.resolve([{ institution_id: 47, rejected_source_urls: rejected.map((url) => ({ url, reason: "not a fee page" })) }]);
        }
        return Promise.resolve([]);
      });
    }

    it("rejects a candidate page that only mentions fees in its footer", async () => {
      const db = vaultDb([]);
      const footerPage = "<p>Personal banking</p><footer>Fee Schedule | Truth in Savings | Service charge info</footer>";
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => { const url = String(input); return (
        url === "https://footer.example/"
          ? response('<a href="/personal/fees">Fee schedule</a>')
          : url.endsWith(".pdf")
            ? response("missing", "text/html", 404)
            : response(footerPage));
      });

      const result = await runMagellanDiscovery({ runId: 701, db: asDiscoveryDb(db), fetchImpl });

      expect(result.results[0]).toMatchObject({ outcome: "dead", url: null });
      expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    });

    it("never proposes a URL that was already read and found not to be a fee page", async () => {
      const db = vaultDb(["https://www.footer.example/schedule-of-fees.pdf/"]);
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => { const url = String(input); return (
        url === "https://footer.example/"
          ? response('<a href="/schedule-of-fees.pdf">Schedule of Fees</a>')
          : response("%PDF", "application/pdf"));
      });

      const result = await runMagellanDiscovery({ runId: 702, db: asDiscoveryDb(db), fetchImpl });

      const fetched = fetchImpl.mock.calls.map((call) => String(call[0]));
      expect(fetched).not.toContain("https://footer.example/schedule-of-fees.pdf");
      expect(result.results[0].url).not.toBe("https://footer.example/schedule-of-fees.pdf");
    });
  });
});
