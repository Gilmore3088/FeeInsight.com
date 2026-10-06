import { describe, expect, it, vi } from "vitest";

import { DISCOVERY_METHOD_VERSION, rejectedSourcesFrom, runMagellanDiscovery } from "./discovery";

type DbMock = ReturnType<typeof vi.fn>;
type Handler = (text: string, values: unknown[]) => unknown[] | undefined;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

/** Candidate rows for the selector; `extra` answers any other query (default: no rows). */
function createDbMock(rows: Array<Record<string, unknown>>, extra: Handler = () => undefined): DbMock {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = templateText(strings);
    const answer = extra(text, values);
    if (answer) return Promise.resolve(answer);
    if (text.includes("product-page upgrade search")) return Promise.resolve([]);
    if (text.includes("AS profile_canonical_source_url")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
}

function asDiscoveryDb(db: DbMock): NonNullable<Parameters<typeof runMagellanDiscovery>[0]["db"]> {
  return db as unknown as NonNullable<Parameters<typeof runMagellanDiscovery>[0]["db"]>;
}

function response(body: string, contentType = "text/html", status = 200): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

const FEE_TABLE = "<h1>Fee Schedule</h1><table><tr><td>Overdraft fee</td><td>$32.00</td></tr>" +
  "<tr><td>Stop payment</td><td>$35.00</td></tr><tr><td>Monthly maintenance fee</td><td>$12.00</td></tr></table>";

/** A fake site: exact URLs to responses, everything else 404. */
function site(pages: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    return pages[url]?.() ?? response("not found", "text/html", 404);
  });
}

function fetched(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return fetchImpl.mock.calls.map((call) => String(call[0]));
}

/** Learning schema on, so every specialist's attempt is written. */
function learningHandler(more: Handler = () => undefined): Handler {
  return (text, values) => {
    if (text.includes("learning_schema_ready")) return [{ learning_schema_ready: true }];
    return more(text, values);
  };
}

function selectorCall(db: DbMock): unknown[] {
  return db.mock.calls.find((call) => templateText(call[0]).includes("AS profile_canonical_source_url")) ?? [];
}

function attempts(db: DbMock): Array<{ strategy: unknown; outcome: unknown; detail: Record<string, unknown> }> {
  return db.mock.calls
    .filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"))
    .map((call) => ({ strategy: call[4], outcome: call[7], detail: JSON.parse(String(call[13])) }));
}

const bank = (id: number, website: string, extra: Record<string, unknown> = {}) => ({
  id,
  institution_name: `Bank ${id}`,
  website_url: website,
  state_code: "VT",
  asset_size: "1000",
  rescue_status: null,
  ...extra,
});

describe("Magellan agentic discovery", () => {
  it("discovers a homepage fee schedule link and writes institution plus discovery evidence", async () => {
    const db = createDbMock([bank(42, "https://testbank.example")]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response('<a href="/schedule-of-fees.pdf">Schedule of Fees</a>'))
      .mockResolvedValueOnce(response("%PDF", "application/pdf"));

    const result = await runMagellanDiscovery({ runId: 101, limit: 500, db: asDiscoveryDb(db), fetchImpl });

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
      code: "found_homepage",
      foundBy: "homepageLinks",
      url: "https://testbank.example/schedule-of-fees.pdf",
      documentType: "pdf",
    });

    const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(sqlText).toContain("UPDATE institution_sources");
    expect(sqlText).toContain("INSERT INTO agent_url_discovery_attempts");
  });

  it("tries the fee link on the homepage before guessed paths", async () => {
    const db = createDbMock([bank(43, "https://linkbank.example")]);
    const fetchImpl = site({
      "https://linkbank.example/": () => response('<a href="/about">About</a> <a href="/disclosures/fee-schedule">Fee Schedule</a>'),
      "https://linkbank.example/disclosures/fee-schedule": () => response(FEE_TABLE),
    });

    const result = await runMagellanDiscovery({ runId: 111, db: asDiscoveryDb(db), fetchImpl });

    expect(result.results[0]).toMatchObject({ outcome: "discovered", url: "https://linkbank.example/disclosures/fee-schedule" });
    expect(fetched(fetchImpl)).toEqual(["https://linkbank.example/", "https://linkbank.example/disclosures/fee-schedule"]);
  });

  it("keeps dry runs read-only while still reporting possible discoveries", async () => {
    const db = createDbMock([bank(43, "dryrun.example")]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response('<a href="/fees">Account Fees</a>'))
      .mockResolvedValueOnce(response("Monthly maintenance fee $10.00. Overdraft fee $30.00. ATM fee $2.50."));

    const result = await runMagellanDiscovery({ runId: 102, dryRun: true, db: asDiscoveryDb(db), fetchImpl });

    expect(result.discovered).toBe(1);
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("runs every free specialist before calling a bank a miss, and logs each one", async () => {
    const db = createDbMock([bank(44, "https://nolinks.example")], learningHandler());
    const fetchImpl = site({
      "https://nolinks.example/": () => response('<a href="/careers">Careers</a> <a href="/about">About us</a>'),
      "https://nolinks.example/about": () => response("<p>Founded 1901.</p>"),
    });

    const result = await runMagellanDiscovery({ runId: 103, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

    expect(result).toMatchObject({ selected: 1, processed: 1, discovered: 0, dead: 1 });
    expect(result.results[0].code).toBe("candidates_failed");
    expect(fetched(fetchImpl)).toEqual(expect.arrayContaining([
      "https://nolinks.example/robots.txt",
      "https://nolinks.example/sitemap.xml",
      "https://nolinks.example/schedule-of-fees.pdf",
      "https://nolinks.example/about",
    ]));
    // The crawl never follows negative links (careers, privacy, social).
    expect(fetched(fetchImpl)).not.toContain("https://nolinks.example/careers");
    const logged = attempts(db);
    expect(logged.map((attempt) => attempt.strategy)).toEqual([
      "discover.homepage_links",
      "discover.sitemap",
      "discover.common_paths",
      "discover.site_crawl",
    ]);
    expect(logged.every((attempt) => attempt.detail.method_version === DISCOVERY_METHOD_VERSION)).toBe(true);
    expect(logged.find((attempt) => attempt.strategy === "discover.common_paths")?.outcome).toBe("http_404");
    expect(db.mock.calls.some((call) => call.includes("magellan_dead"))).toBe(true);
  });

  it("re-checks misses on a schedule and at once when the method version changes", async () => {
    const db = createDbMock([]);
    await runMagellanDiscovery({ runId: 104, db: asDiscoveryDb(db), fetchImpl: vi.fn() });

    const sqlText = templateText(selectorCall(db)[0]);
    expect(sqlText).toContain("COALESCE(inst.rescue_status, 'pending') IN ('pending', 'retry_after')");
    expect(sqlText).toContain("inst.last_rescue_attempt_at < NOW() - INTERVAL '12 hours'");
    expect(sqlText).toContain("inst.rescue_status IN ('dead', 'needs_human')");
    expect(sqlText).toContain("INTERVAL '90 days'");
    expect(sqlText).toContain("INTERVAL '30 days'");
    expect(sqlText).toContain("pa.detail @>");
    expect(sqlText).toContain("CASE WHEN inst.last_rescue_attempt_at IS NULL THEN 0 ELSE 1 END");
    expect(sqlText).toContain("inst.last_rescue_attempt_at NULLS FIRST");
    expect(selectorCall(db)).toContain(JSON.stringify({ method_version: DISCOVERY_METHOD_VERSION }));
  });

  it("filters discovery candidates by state lane", async () => {
    const db = createDbMock([]);
    await runMagellanDiscovery({ runId: 105, stateCode: "CA", db: asDiscoveryDb(db), fetchImpl: vi.fn() });

    const sqlText = templateText(selectorCall(db)[0]);
    expect(sqlText).toContain("upper(btrim(inst.state_code))");
    expect(sqlText).toContain("institution_source_profiles");
    expect(sqlText).toContain("COALESCE(profile.read_strategy, '') <> 'manual_review'");
    expect(sqlText).toContain("COALESCE(profile.source_kind, 'unknown') <> 'offline'");
  });

  it("uses a locked corrected source URL before crawling the homepage", async () => {
    const db = createDbMock([
      bank(45, "https://corrected.example", {
        profile_canonical_source_url: "https://corrected.example/fees.pdf",
        profile_source_kind: "pdf",
        profile_locked_by_correction: true,
      }),
    ]);
    const fetchImpl = vi.fn();

    const result = await runMagellanDiscovery({ runId: 106, db: asDiscoveryDb(db), fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({
      institutionId: 45,
      outcome: "discovered",
      url: "https://corrected.example/fees.pdf",
      documentType: "pdf",
      confidence: 1,
    });
  });

  it("re-checks the bank's known (unlocked) link first", async () => {
    const db = createDbMock([bank(46, "https://known.example", { profile_canonical_source_url: "https://known.example/legal/fees" })]);
    const fetchImpl = site({
      "https://known.example/": () => response("<p>Home</p>"),
      "https://known.example/legal/fees": () => response(FEE_TABLE),
    });

    const result = await runMagellanDiscovery({ runId: 107, db: asDiscoveryDb(db), fetchImpl });

    expect(result.results[0]).toMatchObject({ code: "found_known_link", url: "https://known.example/legal/fees" });
    expect(fetched(fetchImpl)).toEqual(["https://known.example/", "https://known.example/legal/fees"]);
  });

  describe("pass 1 specialists", () => {
    it("finds the fee schedule in the site map named by robots.txt", async () => {
      const db = createDbMock([bank(50, "https://mapbank.example")], learningHandler());
      const fetchImpl = site({
        "https://mapbank.example/": () => response('<a href="/about">About</a>'),
        "https://mapbank.example/robots.txt": () => response("User-agent: *\nSitemap: https://mapbank.example/wp-sitemap.xml", "text/plain"),
        "https://mapbank.example/wp-sitemap.xml": () => response(
          "<sitemapindex><sitemap><loc>https://mapbank.example/page-sitemap.xml</loc></sitemap></sitemapindex>",
          "application/xml",
        ),
        "https://mapbank.example/page-sitemap.xml": () => response(
          "<urlset><url><loc>https://mapbank.example/about</loc></url><url><loc>https://mapbank.example/disclosures/schedule-of-fees</loc></url></urlset>",
          "application/xml",
        ),
        "https://mapbank.example/disclosures/schedule-of-fees": () => response(FEE_TABLE),
      });

      const result = await runMagellanDiscovery({ runId: 120, db: asDiscoveryDb(db), fetchImpl });

      expect(result.results[0]).toMatchObject({ code: "found_sitemap", url: "https://mapbank.example/disclosures/schedule-of-fees" });
      expect(attempts(db).map((attempt) => [attempt.strategy, attempt.outcome])).toEqual([
        ["discover.homepage_links", "no_candidates"],
        ["discover.sitemap", "ok"],
      ]);
      expect(result.foundBy).toEqual({ sitemap: 1 });
    });

    it("follows a Disclosures hub page one click down", async () => {
      const db = createDbMock([bank(51, "https://hubbank.example")]);
      const fetchImpl = site({
        "https://hubbank.example/": () => response('<a href="/resources/disclosures">Disclosures</a>'),
        "https://hubbank.example/resources/disclosures": () => response('<a href="/files/consumer-schedule-of-fees.pdf">Consumer Schedule of Fees</a>'),
        "https://hubbank.example/files/consumer-schedule-of-fees.pdf": () => response("%PDF-1.4 scanned", "application/pdf"),
      });

      const result = await runMagellanDiscovery({ runId: 121, db: asDiscoveryDb(db), fetchImpl });

      expect(result.results[0]).toMatchObject({ code: "found_deep", url: "https://hubbank.example/files/consumer-schedule-of-fees.pdf", documentType: "pdf" });
    });

    it("tries learned platform paths for the detected platform before guessed paths", async () => {
      const db = createDbMock([bank(52, "https://wpbank.example")], (text) =>
        text.includes("FROM platform_registry") ? [{ fee_paths: ["/wp-content/uploads/consumer-fees.pdf"] }] : undefined,
      );
      const fetchImpl = site({
        "https://wpbank.example/": () => response('<link href="/wp-content/themes/bank/style.css"><p>Hello</p>'),
        "https://wpbank.example/wp-content/uploads/consumer-fees.pdf": () => response("%PDF-1.4", "application/pdf"),
      });

      const result = await runMagellanDiscovery({ runId: 122, db: asDiscoveryDb(db), fetchImpl });

      expect(result.results[0]).toMatchObject({ code: "found_platform_path", platform: "wordpress" });
      const urls = fetched(fetchImpl);
      expect(urls.indexOf("https://wpbank.example/wp-content/uploads/consumer-fees.pdf")).toBeLessThan(urls.length);
      expect(urls).not.toContain("https://wpbank.example/fees");
      // The find is fed back into platform_registry.
      expect(db.mock.calls.some((call) => templateText(call[0]).includes("UPDATE platform_registry"))).toBe(true);
    });
  });

  describe("pass 2 specialists", () => {
    it("uses a path that worked for a same-platform bank in the same state", async () => {
      const db = createDbMock([bank(60, "https://q2bank.example")], (text) =>
        text.includes("AS url") && text.includes("upper(btrim(inst.state_code))")
          ? [{ id: 61, url: "https://peer.example/about/deposit-pricing" }]
          : undefined,
      );
      const fetchImpl = site({
        "https://q2bank.example/": () => response('<script src="https://cdn.q2ebanking.com/x.js"></script><p>Hi</p>'),
        "https://q2bank.example/about/deposit-pricing": () => response(FEE_TABLE),
      });

      const result = await runMagellanDiscovery({ runId: 130, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

      expect(result.results[0]).toMatchObject({ code: "found_peer_hint", platform: "q2", url: "https://q2bank.example/about/deposit-pricing" });
    });

    it("crawls the site within robots.txt rules and finds an unlabeled fee page", async () => {
      const db = createDbMock([bank(62, "https://crawlbank.example")]);
      const fetchImpl = site({
        "https://crawlbank.example/": () => response('<a href="/private/area">Members</a> <a href="/about">About</a>'),
        "https://crawlbank.example/robots.txt": () => response("User-agent: FeeInsightBot\nDisallow: /private\n\nUser-agent: *\nDisallow:", "text/plain"),
        "https://crawlbank.example/private/area": () => response(FEE_TABLE),
        "https://crawlbank.example/about": () => response('<a href="/about/pricing-guide">Pricing guide</a>'),
        "https://crawlbank.example/about/pricing-guide": () => response(FEE_TABLE),
      });

      const result = await runMagellanDiscovery({ runId: 131, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

      expect(result.results[0]).toMatchObject({ code: "found_crawl", url: "https://crawlbank.example/about/pricing-guide" });
      expect(fetched(fetchImpl)).not.toContain("https://crawlbank.example/private/area");
    });
  });

  describe("fee-page check and rejected URLs", () => {
    const footerBank = bank(47, "https://footer.example", { rescue_status: "pending" });

    function vaultDb(rejected: string[]): DbMock {
      return createDbMock([footerBank], (text) => {
        if (text.includes("vault_schema_ready")) return [{ vault_schema_ready: true }];
        if (text.includes("SELECT institution_id, rejected_source_urls")) {
          return [{ institution_id: 47, rejected_source_urls: rejected.map((url) => ({ url, reason: "not a fee page" })) }];
        }
        return undefined;
      });
    }

    it("rejects a candidate page that only mentions fees in its footer", async () => {
      const db = vaultDb([]);
      const footerPage = "<p>Personal banking</p><footer>Fee Schedule | Truth in Savings | Service charge info</footer>";
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://footer.example/") return response('<a href="/personal/fees">Fee schedule</a>');
        return url.endsWith(".pdf") ? response("missing", "text/html", 404) : response(footerPage);
      });

      const result = await runMagellanDiscovery({ runId: 701, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

      expect(result.results[0]).toMatchObject({ outcome: "dead", url: null });
      expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    });

    it("never stores a rates page that has fee words in its footer", async () => {
      const db = vaultDb([]);
      const ratesPage = "<h1>Rates</h1><table>" +
        ["Savings 0.50% APY min $100", "Money market 1.10% APY min $2,500", "CD 12 month 4.00% APY min $500", "IRA 3.50% APY min $500"]
          .map((line) => `<tr><td>${line}</td></tr>`).join("") +
        "</table><footer>Fee Schedule | Truth in Savings</footer>";
      const fetchImpl = site({
        "https://footer.example/": () => response('<a href="/rates-and-fees">Rates and Fees</a>'),
        "https://footer.example/rates-and-fees": () => response(ratesPage),
      });

      const result = await runMagellanDiscovery({ runId: 703, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

      expect(result.results[0]).toMatchObject({ outcome: "dead", url: null });
    });

    it("never proposes a URL that was already read and found not to be a fee page", async () => {
      const db = vaultDb(["https://www.footer.example/schedule-of-fees.pdf/"]);
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "https://footer.example/"
          ? response('<a href="/schedule-of-fees.pdf">Schedule of Fees</a>')
          : response("%PDF", "application/pdf"),
      );

      const result = await runMagellanDiscovery({ runId: 702, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

      expect(fetched(fetchImpl)).not.toContain("https://footer.example/schedule-of-fees.pdf");
      expect(result.results[0].url).not.toBe("https://footer.example/schedule-of-fees.pdf");
    });
  });

  describe("pages already ruled out", () => {
    const sofi = bank(57, "https://www.sofi.com", { rescue_status: "pending" });
    const marketingPage = "<h1>No account fees</h1><p>We do not charge maintenance fees.</p>" +
      '<p>See the <a href="https://d32ijn7u0aqfv4.cloudfront.net/wp/wp-content/uploads/raw/SoFi-Bank-Fee-Sheet-May-18-2026.pdf">SoFi Bank Fee Sheet</a> for details.</p>';

    function rejectedDb(entries: Array<{ url: string; at?: string }>): DbMock {
      return createDbMock([sofi], (text) => {
        if (text.includes("vault_schema_ready")) return [{ vault_schema_ready: true }];
        if (text.includes("SELECT institution_id, rejected_source_urls")) {
          return [{ institution_id: 57, rejected_source_urls: entries.map((entry) => ({ ...entry, reason: "not a fee schedule" })) }];
        }
        return undefined;
      });
    }

    it("follows the ruled-out page's link to an off-site fee PDF, even when the homepage blocks bots", async () => {
      const db = rejectedDb([{ url: "https://www.sofi.com/banking/fees/", at: new Date().toISOString() }]);
      const fetchImpl = site({
        "https://www.sofi.com/": () => response("denied", "text/html", 403),
        "https://www.sofi.com/banking/fees/": () => response(marketingPage),
        "https://d32ijn7u0aqfv4.cloudfront.net/wp/wp-content/uploads/raw/SoFi-Bank-Fee-Sheet-May-18-2026.pdf": () => response("%PDF-1.7", "application/pdf"),
      });

      const result = await runMagellanDiscovery({ runId: 720, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

      expect(result.results[0]).toMatchObject({
        outcome: "discovered",
        code: "found_from_rejected_page",
        documentType: "pdf",
        url: "https://d32ijn7u0aqfv4.cloudfront.net/wp/wp-content/uploads/raw/SoFi-Bank-Fee-Sheet-May-18-2026.pdf",
      });
      expect(fetched(fetchImpl)).not.toContain("https://www.sofi.com/");
    });

    it("counts each ruled-out URL once and lets a ban expire after 90 days", () => {
      const now = Date.parse("2026-10-05T00:00:00Z");
      const sources = rejectedSourcesFrom([
        { url: "https://bank.example/old", at: "2026-01-01T00:00:00Z" },
        { url: "https://bank.example/fees/", at: "2026-10-01T00:00:00Z" },
        { url: "https://bank.example/fees/", at: "2026-10-04T00:00:00Z" },
        { url: "https://bank.example/legacy" },
      ], now);

      expect(sources.pages).toEqual(["https://bank.example/legacy", "https://bank.example/fees/", "https://bank.example/old"]);
      expect([...sources.identities].sort()).toEqual(["bank.example/fees", "bank.example/legacy"]);
    });
  });

  it("searches the new domain when the site redirects, and saves it", async () => {
    const db = createDbMock([bank(70, "https://oldname.example")]);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oldname.example/") {
        const moved = response('<a href="/fee-schedule">Fee Schedule</a>');
        Object.defineProperty(moved, "url", { value: "https://newname.example/" });
        return moved;
      }
      if (url === "https://newname.example/fee-schedule") return response(FEE_TABLE);
      return response("missing", "text/html", 404);
    });

    const result = await runMagellanDiscovery({ runId: 140, db: asDiscoveryDb(db), fetchImpl });

    expect(result.results[0]).toMatchObject({ url: "https://newname.example/fee-schedule", movedTo: "https://newname.example" });
    expect(db.mock.calls.some((call) => call.includes("https://newname.example"))).toBe(true);
  });

  it("records a bot wall as blocked, to be re-checked on schedule", async () => {
    const db = createDbMock([bank(71, "https://wall.example")]);
    const fetchImpl = vi.fn(async () => response("denied", "text/html", 403));

    const result = await runMagellanDiscovery({ runId: 141, db: asDiscoveryDb(db), fetchImpl });

    expect(result.results[0]).toMatchObject({ outcome: "dead", code: "blocked" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  describe("product-page upgrade search", () => {
    const productBank = bank(77, "https://upbank.example", {
      fee_schedule_url: "https://upbank.example/personal/checking",
      profile_canonical_source_url: "https://upbank.example/personal/checking",
    });
    const upgradeDb = () =>
      createDbMock([], learningHandler((text) => (text.includes("product-page upgrade search") ? [productBank] : undefined)));

    it("replaces a product-page link with the fee schedule and keeps the old page as a companion", async () => {
      const db = upgradeDb();
      const fetchImpl = site({
        "https://upbank.example/personal/checking": () =>
          response("<h1>Checking</h1><p>Monthly service charge $5.</p><footer>Fee Schedule | Truth in Savings</footer>"),
        "https://upbank.example/": () => response('<a href="/disclosures/fee-schedule">Fee Schedule</a>'),
        "https://upbank.example/disclosures/fee-schedule": () => response(FEE_TABLE),
      });

      const result = await runMagellanDiscovery({ runId: 120, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

      expect(result.results[0]).toMatchObject({ outcome: "discovered", url: "https://upbank.example/disclosures/fee-schedule" });
      const texts = db.mock.calls.map((call) => templateText(call[0]));
      expect(texts.some((text) => text.includes("UPDATE institution_sources"))).toBe(true);
      const companion = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO institution_additional_sources"));
      expect(companion).toBeDefined();
      expect(companion).toContain("https://upbank.example/personal/checking");
      expect(attempts(db).every((attempt) => attempt.detail.upgrade_search === 1)).toBe(true);
    });

    it("leaves the bank's link and rescue state alone when no schedule is found", async () => {
      const db = upgradeDb();
      const fetchImpl = site({
        "https://upbank.example/personal/checking": () => response("<h1>Checking</h1><p>Monthly service charge $5.</p>"),
        "https://upbank.example/": () => response('<a href="/about">About</a>'),
      });

      await runMagellanDiscovery({ runId: 121, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

      const texts = db.mock.calls.map((call) => templateText(call[0]));
      expect(texts.some((text) => text.includes("UPDATE institution_sources"))).toBe(false);
      expect(texts.some((text) => text.includes("INSERT INTO institution_additional_sources"))).toBe(false);
      expect(attempts(db).length).toBeGreaterThan(0);
      expect(attempts(db).every((attempt) => attempt.detail.upgrade_search === 1)).toBe(true);
    });
  });
});
