import { describe, expect, it, vi } from "vitest";

import {
  DISCOVERY_METHOD_VERSION,
  nextDiscoveryResume,
  parseDiscoveryResume,
  rejectedSourcesFrom,
  RESUME_FIRST_PER_STEP,
  RESUME_MAX_TICKS,
  runMagellanDiscovery,
  type DiscoveryResume,
} from "./discovery";

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
    it("uses a path that produced live fees for a same-platform bank elsewhere", async () => {
      const db = createDbMock([bank(60, "https://q2bank.example")], (text) => {
        if (text.includes("to_regclass('public.pipeline_feedback')")) return [{ ready: true }];
        if (text.includes("AS url") && text.includes("FROM pipeline_feedback")) {
          return [{ id: 61, url: "https://peer.example/about/deposit-pricing", rejected: [], yield_kind: "produced_live_fees", live_fees: 12 }];
        }
        return undefined;
      });
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

  describe("homepage that blocks bots (MG-7)", () => {
    it("records a bot wall as blocked after trying only robots.txt and the site maps", async () => {
      const db = createDbMock([bank(71, "https://wall.example")]);
      const fetchImpl = vi.fn(async () => response("denied", "text/html", 403));

      const result = await runMagellanDiscovery({ runId: 141, db: asDiscoveryDb(db), fetchImpl });

      expect(result.results[0]).toMatchObject({ outcome: "dead", code: "blocked", homepageBlocked: true });
      expect(fetched(fetchImpl)).toEqual([
        "https://wall.example/",
        "https://wall.example/robots.txt",
        "https://wall.example/sitemap.xml",
        "https://wall.example/sitemap_index.xml",
      ]);
      // Our crawler's own name on every request; nothing pretends to be a browser.
      for (const call of fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>) {
        expect(String((call[1].headers as Record<string, string>)["User-Agent"])).toContain("FeeInsightBot");
      }
    });

    it("finds a fee PDF listed in the site map although the homepage answers 403, within robots.txt rules", async () => {
      const db = createDbMock([bank(72, "https://walled.example")], learningHandler());
      const fetchImpl = site({
        "https://walled.example/": () => response("denied", "text/html", 403),
        "https://walled.example/robots.txt": () => response(
          "User-agent: *\nDisallow: /private/\nSitemap: https://walled.example/sitemap_index.xml",
          "text/plain",
        ),
        "https://walled.example/sitemap_index.xml": () => response(
          "<sitemapindex><sitemap><loc>https://walled.example/media-sitemap.xml</loc></sitemap></sitemapindex>",
          "application/xml",
        ),
        "https://walled.example/media-sitemap.xml": () => response(
          "<urlset><url><loc>https://walled.example/private/fee-schedule.pdf</loc></url>" +
            "<url><loc>https://walled.example/files/privacy-notice.pdf</loc></url>" +
            "<url><loc>https://walled.example/files/tis-disclosure.pdf</loc></url></urlset>",
          "application/xml",
        ),
        "https://walled.example/private/fee-schedule.pdf": () => response("%PDF-1.4", "application/pdf"),
        "https://walled.example/files/tis-disclosure.pdf": () => response("%PDF-1.4 scanned", "application/pdf"),
      });

      const result = await runMagellanDiscovery({ runId: 142, db: asDiscoveryDb(db), fetchImpl });

      // The disclosure PDF is opened (its name looks like one), but a scan with a weak
      // name is never accepted unread; the disallowed fee schedule is never requested.
      expect(fetched(fetchImpl)).toContain("https://walled.example/files/tis-disclosure.pdf");
      expect(fetched(fetchImpl)).not.toContain("https://walled.example/private/fee-schedule.pdf");
      expect(fetched(fetchImpl)).not.toContain("https://walled.example/files/privacy-notice.pdf");
      expect(result.results[0]).toMatchObject({ outcome: "dead", code: "blocked" });
      const logged = attempts(db);
      expect(logged.map((attempt) => [attempt.strategy, attempt.outcome])).toEqual([
        ["discover.homepage_links", "http_403"],
        ["discover.sitemap", "wrong_document"],
      ]);
      expect(logged.every((attempt) => attempt.detail.homepage_blocked === true)).toBe(true);
      const trail = logged[1].detail.trail as Array<{ url: string; verdict: string }>;
      expect(trail).toContainEqual(expect.objectContaining({ url: "https://walled.example/private/fee-schedule.pdf", verdict: "robots_disallow" }));
    });

    it("counts a find past a blocked homepage as its own code and attempt detail", async () => {
      const db = createDbMock([bank(73, "https://walled2.example")], learningHandler());
      const fetchImpl = site({
        "https://walled2.example/": () => response("denied", "text/html", 403),
        "https://walled2.example/sitemap.xml": () => response(
          "<urlset><url><loc>https://walled2.example/disclosures/schedule-of-fees</loc></url></urlset>",
          "application/xml",
        ),
        "https://walled2.example/disclosures/schedule-of-fees": () => response(FEE_TABLE),
      });

      const result = await runMagellanDiscovery({ runId: 143, db: asDiscoveryDb(db), fetchImpl });

      expect(result.results[0]).toMatchObject({
        outcome: "discovered",
        code: "found_blocked_homepage",
        foundBy: "sitemap",
        homepageBlocked: true,
        url: "https://walled2.example/disclosures/schedule-of-fees",
      });
      expect(result.blockedHomepageRescues).toBe(1);
      expect(result.codes).toEqual({ found_blocked_homepage: 1 });
      const logged = attempts(db);
      expect(logged.map((attempt) => [attempt.strategy, attempt.outcome])).toEqual([
        ["discover.homepage_links", "http_403"],
        ["discover.sitemap", "ok"],
      ]);
      expect(logged[1].detail).toMatchObject({ code: "found_blocked_homepage", rescue: "blocked_homepage", homepage_blocked: true });
      // /sitemap.xml answered, so /sitemap_index.xml is not requested.
      expect(fetched(fetchImpl)).not.toContain("https://walled2.example/sitemap_index.xml");
    });

    it("treats a bot challenge page served with HTTP 200 like a 403", async () => {
      const db = createDbMock([bank(74, "https://challenge.example")], learningHandler());
      const fetchImpl = site({
        "https://challenge.example/": () => response("<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>"),
        "https://challenge.example/sitemap_index.xml": () => response(
          "<urlset><url><loc>https://challenge.example/docs/schedule-of-fees.pdf</loc></url></urlset>",
          "application/xml",
        ),
        "https://challenge.example/docs/schedule-of-fees.pdf": () => response("%PDF-1.4 scanned", "application/pdf"),
      });

      const result = await runMagellanDiscovery({ runId: 144, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

      expect(result.results[0]).toMatchObject({ code: "found_blocked_homepage", documentType: "pdf", homepageBlocked: true });
      expect(attempts(db)[0]).toMatchObject({ strategy: "discover.homepage_links", outcome: "blocked_bot" });
      // Homepage-based specialists (hub pages, common paths, crawl) never run behind the wall.
      expect(fetched(fetchImpl)).not.toContain("https://challenge.example/fees");
    });

    it("asks nothing more of a site that rate-limits us (HTTP 429)", async () => {
      const db = createDbMock([bank(75, "https://busy.example")]);
      const fetchImpl = vi.fn(async () => response("slow down", "text/html", 429));

      const result = await runMagellanDiscovery({ runId: 145, db: asDiscoveryDb(db), fetchImpl });

      expect(result.results[0]).toMatchObject({ outcome: "dead", code: "blocked", homepageBlocked: false });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe("website repair (MG-8)", () => {
    function websiteUpdate(db: DbMock): unknown[] {
      return db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE institution_sources")) ?? [];
    }

    it("repairs a website missing the dot after www, searches it, saves it and logs the repair", async () => {
      const db = createDbMock([bank(80, "wwwrepairbank.com")], learningHandler());
      const fetchImpl = site({
        "https://www.repairbank.com/": () => response('<a href="/fee-schedule">Fee Schedule</a>'),
        "https://www.repairbank.com/fee-schedule": () => response(FEE_TABLE),
      });

      const result = await runMagellanDiscovery({ runId: 150, db: asDiscoveryDb(db), fetchImpl });

      expect(result.results[0]).toMatchObject({ outcome: "discovered", url: "https://www.repairbank.com/fee-schedule" });
      expect(result.results[0].websiteRepair).toMatchObject({ original: "wwwrepairbank.com", repaired: "https://www.repairbank.com", save: true });
      expect(result.websitesRepaired).toBe(1);
      expect(websiteUpdate(db)).toContain("https://www.repairbank.com");
      expect(templateText(websiteUpdate(db)[0])).toContain("locked_by_correction IS TRUE");
      const repair = attempts(db).find((attempt) => attempt.strategy === "discover.website_repair");
      expect(repair).toMatchObject({ outcome: "ok" });
      expect(repair?.detail).toMatchObject({ original: "wwwrepairbank.com", repaired: "https://www.repairbank.com", saved: true });
      expect(repair?.detail.changes).toContain("added_dot_after_www");
    });

    it("repairs a website missing the dot before .com", async () => {
      const db = createDbMock([bank(81, "www.gluedbankcom")]);
      const fetchImpl = site({ "https://www.gluedbank.com/": () => response("<p>Home</p>") });

      const result = await runMagellanDiscovery({ runId: 151, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

      expect(fetched(fetchImpl)[0]).toBe("https://www.gluedbank.com/");
      expect(result.results[0].websiteRepair).toMatchObject({ repaired: "https://www.gluedbank.com", save: true });
    });

    it("uses but never saves a repair for a bank locked by a person's correction", async () => {
      const db = createDbMock([bank(82, "wwwlockedbank.com", { profile_locked_by_correction: true })], learningHandler());
      const fetchImpl = site({ "https://www.lockedbank.com/": () => response("<p>Home</p>") });

      const result = await runMagellanDiscovery({ runId: 152, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

      expect(fetched(fetchImpl)[0]).toBe("https://www.lockedbank.com/");
      expect(result.results[0].websiteRepair).toMatchObject({ save: false, locked: true });
      expect(result.websitesRepaired).toBe(0);
      expect(websiteUpdate(db)).not.toContain("https://www.lockedbank.com");
      const repair = attempts(db).find((attempt) => attempt.strategy === "discover.website_repair");
      expect(repair?.detail).toMatchObject({ saved: false, locked_by_correction: true });
    });

    it("sends a website it cannot read to a person, with no registry website to fall back on", async () => {
      const db = createDbMock([bank(83, "www")], learningHandler());
      const fetchImpl = vi.fn();

      const result = await runMagellanDiscovery({ runId: 153, db: asDiscoveryDb(db), fetchImpl });

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(result.results[0]).toMatchObject({ outcome: "needs_human", code: "website_unrepairable" });
      expect(result.results[0].reason).toContain("no registry website is stored");
      const logged = attempts(db);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ strategy: "discover.website_repair", outcome: "invalid_url" });
      expect(logged[0].detail).toMatchObject({ original: "www", repaired: null, saved: false, registry_fallback: "none_stored" });
    });

    it("does not log or save a website that only lacks its scheme", async () => {
      const db = createDbMock([bank(84, "plainbank.example")], learningHandler());
      const fetchImpl = site({ "https://plainbank.example/": () => response("<p>Home</p>") });

      const result = await runMagellanDiscovery({ runId: 154, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0 });

      expect(result.results[0].websiteRepair).toBeNull();
      expect(attempts(db).some((attempt) => attempt.strategy === "discover.website_repair")).toBe(false);
    });
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

  describe("searches cut short by time resume where they stopped", () => {
    const HUB_HOME = '<a href="/disclosures">Disclosures</a> <a href="/rates-and-fees">Rates and Fees</a>' +
      ' <a href="/documents">Documents</a> <a href="/forms">Forms</a>';

    /** A slow site: every request takes `clock.costMs` on a fake clock. */
    function slowSite(pages: Record<string, () => Response>, clock: { now: number; costMs: number }) {
      return vi.fn(async (input: RequestInfo | URL) => {
        clock.now += clock.costMs;
        const url = String(input);
        return pages[url]?.() ?? response("not found", "text/html", 404);
      });
    }

    function hubSite(host: string): Record<string, () => Response> {
      return {
        [`https://${host}/`]: () => response(HUB_HOME),
        [`https://${host}/disclosures`]: () => response("<p>Our disclosures.</p>"),
        [`https://${host}/rates-and-fees`]: () => response("<p>Rates.</p>"),
        [`https://${host}/documents`]: () => response("<p>Documents.</p>"),
        [`https://${host}/forms`]: () => response("<p>Forms.</p>"),
      };
    }

    function lastDetail(db: DbMock): Record<string, unknown> {
      const logged = attempts(db);
      return logged[logged.length - 1].detail;
    }

    it("remembers finished specialists and counts a cut only on a full budget", () => {
      const first = nextDiscoveryResume(null, {
        completed: ["knownLink", "homepageLinks", "sitemap"],
        cutIn: "hubPages",
        fullBudget: true,
        sawCandidates: false,
      });
      expect(first).toEqual({
        methodVersion: DISCOVERY_METHOD_VERSION,
        done: ["knownLink", "homepageLinks", "sitemap"],
        cutIn: "hubPages",
        cutCount: 1,
        ticks: 1,
        skipped: [],
        sawCandidates: false,
      });
      // Squeezed in at the end of a step: the cut does not count toward skipping.
      const squeezed = nextDiscoveryResume(first, { completed: [], cutIn: "hubPages", fullBudget: false, sawCandidates: true });
      expect(squeezed).toMatchObject({ cutIn: "hubPages", cutCount: 1, ticks: 2, sawCandidates: true });
      // A second cut on a full budget skips the specialist; the next search starts after it.
      const skipped = nextDiscoveryResume(squeezed, { completed: [], cutIn: "hubPages", fullBudget: true, sawCandidates: false });
      expect(skipped).toMatchObject({
        done: ["knownLink", "homepageLinks", "sitemap", "hubPages"],
        cutIn: null,
        cutCount: 0,
        ticks: 3,
        skipped: ["hubPages"],
        sawCandidates: true,
      });
      // The clock ran out between two specialists: nothing to count against either.
      expect(nextDiscoveryResume(skipped, { completed: ["platformPaths"], cutIn: null, fullBudget: true, sawCandidates: false }))
        .toMatchObject({ cutIn: null, cutCount: 0, ticks: 4, done: expect.arrayContaining(["platformPaths"]) });
    });

    it("reads a stored resume state and ignores one from another method version", () => {
      const stored = { methodVersion: DISCOVERY_METHOD_VERSION, done: ["sitemap", "bogus", "sitemap"], cutIn: "siteCrawl", cutCount: 1, ticks: 2 };
      expect(parseDiscoveryResume(JSON.stringify(stored))).toEqual({
        methodVersion: DISCOVERY_METHOD_VERSION,
        done: ["sitemap"],
        cutIn: "siteCrawl",
        cutCount: 1,
        ticks: 2,
        skipped: [],
        sawCandidates: false,
      });
      expect(parseDiscoveryResume({ ...stored, methodVersion: DISCOVERY_METHOD_VERSION - 1 })).toBeNull();
      expect(parseDiscoveryResume(null)).toBeNull();
      expect(parseDiscoveryResume("not json")).toBeNull();
    });

    it("splits a slow bank's search across steps instead of restarting it", async () => {
      const clock = { now: 1_000_000, costMs: 10_000 };
      const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock.now);
      try {
        const pages = {
          ...hubSite("slow.example"),
          // One declared site map, so the site-map specialist makes a single request.
          "https://slow.example/robots.txt": () => response("User-agent: *\nSitemap: https://slow.example/sitemap.xml\n", "text/plain"),
          "https://slow.example/schedule-of-fees": () => response(FEE_TABLE),
        };

        // Search 1: homepage, robots.txt and site map take 30 s; the clock stops inside the hub pages.
        const db1 = createDbMock([bank(80, "https://slow.example")], learningHandler());
        const fetch1 = slowSite(pages, clock);
        const first = await runMagellanDiscovery({ runId: 150, db: asDiscoveryDb(db1), fetchImpl: fetch1, politeDelayMs: 0, secondDocuments: false });
        expect(first.results[0]).toMatchObject({ outcome: "retry_after", code: "out_of_time", resumedFrom: null });
        const resume1 = first.results[0].resume as DiscoveryResume;
        expect(resume1).toMatchObject({ done: ["rejectedPageLinks", "knownLink", "homepageLinks", "sitemap"], cutIn: "hubPages", cutCount: 1, ticks: 1 });
        // Visible on the search's last attempt, which is also where the next search reads it.
        expect(lastDetail(db1)).toMatchObject({ code: "out_of_time", resume: resume1, resumed_from: null });
        expect(first.results[0].reason).toContain("next hubPages");

        // Search 2: resumes at the hub pages (no second robots.txt or site map read) and,
        // with the time search 1 spent on them saved, finishes all four before the clock stops.
        const db2 = createDbMock(
          [bank(80, "https://slow.example", { rescue_status: "retry_after", discovery_cut_off: true, discovery_resume: resume1 })],
          learningHandler(),
        );
        const fetch2 = slowSite(pages, clock);
        const second = await runMagellanDiscovery({ runId: 151, db: asDiscoveryDb(db2), fetchImpl: fetch2, politeDelayMs: 0, secondDocuments: false });
        expect(fetched(fetch2)).not.toContain("https://slow.example/robots.txt");
        expect(fetched(fetch2)).not.toContain("https://slow.example/sitemap.xml");
        expect(fetched(fetch2)).toContain("https://slow.example/disclosures");
        expect(second.resumed).toBe(1);
        expect(attempts(db2).map((attempt) => attempt.strategy)).toEqual(["discover.hub_pages"]);
        const resume2 = second.results[0].resume as DiscoveryResume;
        expect(fetched(fetch2)).toContain("https://slow.example/forms");
        expect(resume2).toMatchObject({ cutIn: null, cutCount: 0, ticks: 2, skipped: [] });
        expect(resume2.done).toEqual(["rejectedPageLinks", "knownLink", "homepageLinks", "sitemap", "hubPages"]);
        expect(lastDetail(db2)).toMatchObject({
          resume: resume2,
          resumed_from: { cut_off_searches: 1, skipped_done: ["rejectedPageLinks", "knownLink", "homepageLinks", "sitemap"] },
        });

        // Search 3: continues after the hub pages and finds the schedule by a guessed path.
        clock.costMs = 0;
        const db3 = createDbMock(
          [bank(80, "https://slow.example", { rescue_status: "retry_after", discovery_cut_off: true, discovery_resume: resume2 })],
          learningHandler(),
        );
        const fetch3 = slowSite(pages, clock);
        const third = await runMagellanDiscovery({ runId: 152, db: asDiscoveryDb(db3), fetchImpl: fetch3, politeDelayMs: 0, secondDocuments: false });
        expect(third.results[0]).toMatchObject({
          outcome: "discovered",
          code: "found_common_path",
          url: "https://slow.example/schedule-of-fees",
          resume: null,
        });
        expect(fetched(fetch3)).not.toContain("https://slow.example/disclosures");
        expect(lastDetail(db3)).toMatchObject({ resume: null, resumed_from: { cut_off_searches: 2 } });
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("ignores a resume state unless the bank's last search was cut short", async () => {
      const db = createDbMock(
        [bank(81, "https://fresh.example", {
          rescue_status: "dead",
          discovery_cut_off: false,
          discovery_resume: { methodVersion: DISCOVERY_METHOD_VERSION, done: ["sitemap"], cutIn: null, cutCount: 0, ticks: 1 },
        })],
        learningHandler(),
      );
      const fetchImpl = site({ "https://fresh.example/": () => response("<p>Home</p>") });
      const result = await runMagellanDiscovery({ runId: 153, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0, secondDocuments: false });
      expect(result.results[0].resumedFrom).toBeNull();
      expect(fetched(fetchImpl)).toContain("https://fresh.example/sitemap.xml");
    });

    it("calls a bank a miss after too many cut-off searches", async () => {
      const clock = { now: 2_000_000, costMs: 10_000 };
      const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock.now);
      try {
        const resume: DiscoveryResume = {
          methodVersion: DISCOVERY_METHOD_VERSION,
          done: ["knownLink", "homepageLinks", "sitemap"],
          cutIn: null,
          cutCount: 0,
          ticks: RESUME_MAX_TICKS,
          skipped: [],
          sawCandidates: false,
        };
        const db = createDbMock(
          [bank(82, "https://slow2.example", { rescue_status: "retry_after", discovery_cut_off: true, discovery_resume: resume })],
          learningHandler(),
        );
        clock.costMs = 20_000;
        const fetchImpl = slowSite(hubSite("slow2.example"), clock);
        const result = await runMagellanDiscovery({ runId: 154, db: asDiscoveryDb(db), fetchImpl, politeDelayMs: 0, secondDocuments: false });
        expect(result.results[0]).toMatchObject({ outcome: "dead", code: "out_of_time" });
        expect(result.results[0].resume).toMatchObject({ ticks: RESUME_MAX_TICKS + 1 });
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("puts one cut-off bank at the front of the step and reads its resume state from the attempt log", async () => {
      const db = createDbMock([], learningHandler());
      await runMagellanDiscovery({ runId: 155, db: asDiscoveryDb(db), fetchImpl: vi.fn() });
      const call = selectorCall(db);
      const sqlText = templateText(call[0]);
      expect(sqlText).toContain("LIKE 'out_of_time:%') AS discovery_cut_off");
      expect(sqlText).toContain("pa.detail ? 'resume'");
      expect(sqlText).toContain("ranked.cut_rank <=");
      expect(call).toContain(RESUME_FIRST_PER_STEP);
    });
  });
});
