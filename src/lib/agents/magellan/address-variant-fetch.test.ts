import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchAndRecordLinkMock, recordAttemptMock } = vi.hoisted(() => ({
  fetchAndRecordLinkMock: vi.fn(),
  recordAttemptMock: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));
vi.mock("@/lib/agents/learning/attempts", () => ({ learningSchemaReady: vi.fn(async () => true), recordAttempt: recordAttemptMock }));
vi.mock("@/lib/agents/document-vault", () => ({
  documentVaultSchemaReady: vi.fn(async () => true),
  getDocumentVault: vi.fn(() => ({ configured: true })),
}));
vi.mock("./fetch", async () => {
  const actual = await vi.importActual<typeof import("./fetch")>("./fetch");
  return { ...actual, fetchAndRecordLink: fetchAndRecordLinkMock };
});

import { ADDRESS_VARIANT_FETCH_STRATEGY, addressVariants, runAddressVariantFetch, selectUnreachableLinks } from "./address-variant-fetch";

type Db = Parameters<typeof runAddressVariantFetch>[0]["db"];

// State Department FCU (#1051): the plain fetch of its https link failed with a network
// error from 3 Oct 2026; its stored website is http://www.sdfcu.org.
const sdfcu = {
  id: 4416,
  institution_name: "State Department Federal Credit Union",
  website_url: "http://www.sdfcu.org",
  fee_schedule_url: "https://www.sdfcu.org/sites/default/files/pdf/fees.pdf",
  asset_size: 1_900_000,
  last_crawl_at: "2026-10-09T05:10:46Z",
  consecutive_failures: 3,
  profile_canonical_source_url: "https://www.sdfcu.org/sites/default/files/pdf/fees.pdf",
  profile_last_source_hash: null,
  profile_last_document_id: null,
  last_plain_outcome: "network_error",
};

function dbReturning(rows: unknown[]) {
  return vi.fn(async () => rows) as unknown as Db & ReturnType<typeof vi.fn>;
}

function withUrl(response: Response, url: string): Response {
  Object.defineProperty(response, "url", { value: url });
  return response;
}

beforeEach(() => {
  fetchAndRecordLinkMock.mockReset();
  recordAttemptMock.mockReset();
});

describe("addressVariants", () => {
  it("tries the website's own spelling first, then www, then plain http, never the link itself", () => {
    expect(addressVariants(sdfcu.fee_schedule_url, sdfcu.website_url)).toEqual([
      { url: "http://www.sdfcu.org/sites/default/files/pdf/fees.pdf", kind: "website_host" },
      { url: "https://sdfcu.org/sites/default/files/pdf/fees.pdf", kind: "www_toggle" },
    ]);
    // Great Oaks Bank: the link is on the bare domain, the website on www.
    expect(addressVariants("https://greatoaks.bank/fees?x=1#top", "https://www.greatoaks.bank")).toEqual([
      { url: "https://www.greatoaks.bank/fees?x=1", kind: "website_host" },
      { url: "http://greatoaks.bank/fees?x=1", kind: "plain_http" },
    ]);
    // A staging host goes back to the bank's own website.
    expect(addressVariants("https://staging.csb123.com/wp-content/uploads/fees.pdf", "https://WWW.CSB123.COM")[0]).toEqual({
      url: "https://www.csb123.com/wp-content/uploads/fees.pdf",
      kind: "website_host",
    });
    expect(addressVariants("not a link", null)).toEqual([]);
  });
});

describe("runAddressVariantFetch", () => {
  it("stores the document from the first spelling that answers, through the normal fetch path", async () => {
    const db = dbReturning([sdfcu]);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("http://www.sdfcu.org")) throw new TypeError("fetch failed");
      return withUrl(new Response("%PDF-1.7 fees", { status: 200, headers: { "content-type": "application/pdf" } }), url);
    });
    fetchAndRecordLinkMock.mockResolvedValue({ result: { outcome: "success", attemptOutcome: "ok" }, sourceDocumentId: 1, supersededCopies: 0 });

    const result = await runAddressVariantFetch({ db, fetchImpl: fetchImpl as unknown as typeof fetch, runId: 3, stepId: 4 });

    expect(result).toMatchObject({ selected: 1, tried: 1, recovered: 1, failed: 0 });
    expect(result.results[0].url).toBe("https://sdfcu.org/sites/default/files/pdf/fees.pdf");
    expect(result.results[0].tries.map((entry) => entry.verdict)).toEqual(["network_error", "http_200"]);
    const [, row, fetcher, ctx] = fetchAndRecordLinkMock.mock.calls[0];
    // The working spelling becomes the address the plain fetch uses from now on.
    expect(row.profile_canonical_source_url).toBe("https://sdfcu.org/sites/default/files/pdf/fees.pdf");
    expect(ctx).toMatchObject({ strategy: ADDRESS_VARIANT_FETCH_STRATEGY, runId: 3, stepId: 4, dryRun: false });
    expect(ctx.costMicrousd ?? 0).toBe(0);
    expect((await fetcher()).status).toBe(200);
    expect(recordAttemptMock).not.toHaveBeenCalled();
  });

  it("records what it tried and leaves the bank alone when no spelling answers", async () => {
    const db = dbReturning([sdfcu]);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // The bare domain sends every address to the homepage: not the document.
      if (url.startsWith("https://sdfcu.org")) return withUrl(new Response("<html>home</html>", { status: 200, headers: { "content-type": "text/html" } }), "https://www.sdfcu.org/");
      return new Response("bad gateway", { status: 502 });
    });

    const result = await runAddressVariantFetch({ db, fetchImpl: fetchImpl as unknown as typeof fetch, runId: 3 });

    expect(result).toMatchObject({ tried: 1, recovered: 0, failed: 1 });
    expect(fetchAndRecordLinkMock).not.toHaveBeenCalled();
    expect(recordAttemptMock).toHaveBeenCalledTimes(1);
    const attempt = recordAttemptMock.mock.calls[0][1];
    expect(attempt).toMatchObject({ stage: "fetch", strategy: "fetch.address_variant", outcome: "wrong_document", costMicrousd: 0, fingerprint: sdfcu.fee_schedule_url });
    expect(attempt.detail.tries.map((entry: { verdict: string }) => entry.verdict)).toEqual(["http_502", "redirected_away"]);
    // Nothing writes to the bank's fetch state.
    expect((db as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  // #1306: a spelling that answers 2xx is still refused, and the bank left alone, when the
  // answer is not the document.
  const failingBody = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("%PDF-1.7 "));
        controller.error(new TypeError("terminated"));
      },
    });
  it.each([
    {
      name: "a redirect to another site",
      answer: () => withUrl(new Response("%PDF-1.7 fees", { status: 200, headers: { "content-type": "application/pdf" } }), "https://parked-domains.example/fees.pdf"),
      verdict: "redirected_off_domain",
      outcome: "wrong_document",
    },
    {
      name: "a 200 HTML page for a PDF link",
      answer: (url: string) => withUrl(new Response("<html><body>This domain is for sale</body></html>", { status: 200, headers: { "content-type": "text/html" } }), url),
      verdict: "not_pdf",
      outcome: "wrong_document",
    },
    {
      name: "a PDF content type over an HTML body",
      answer: (url: string) => withUrl(new Response("<html><body>catch-all</body></html>", { status: 200, headers: { "content-type": "application/pdf" } }), url),
      verdict: "not_pdf",
      outcome: "wrong_document",
    },
    {
      name: "a body read that fails after the spelling answered",
      answer: (url: string) => withUrl(new Response(failingBody(), { status: 200, headers: { "content-type": "application/pdf" } }), url),
      verdict: "body_network_error",
      outcome: "network_error",
    },
  ])("refuses $name and leaves the bank's fetch address and failure count alone", async ({ answer, verdict, outcome }) => {
    const db = dbReturning([sdfcu]);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => answer(String(input)));

    const result = await runAddressVariantFetch({ db, fetchImpl: fetchImpl as unknown as typeof fetch, runId: 3 });

    expect(result).toMatchObject({ tried: 1, recovered: 0, failed: 1 });
    expect(result.results[0].url).toBeNull();
    expect(fetchAndRecordLinkMock).not.toHaveBeenCalled();
    const attempt = recordAttemptMock.mock.calls[0][1];
    expect(attempt).toMatchObject({ strategy: "fetch.address_variant", outcome });
    expect(attempt.detail.tries.map((entry: { verdict: string }) => entry.verdict)).toEqual([verdict, verdict]);
    expect((db as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("hands the fetch path the body already read, at the final address", async () => {
    const db = dbReturning([sdfcu]);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      withUrl(new Response("%PDF-1.7 fees", { status: 200, headers: { "content-type": "application/octet-stream" } }), `${String(input)}?v=2`),
    );
    fetchAndRecordLinkMock.mockResolvedValue({ result: { outcome: "success", attemptOutcome: "ok" }, sourceDocumentId: 1, supersededCopies: 0 });

    const result = await runAddressVariantFetch({ db, fetchImpl: fetchImpl as unknown as typeof fetch, runId: 3 });

    expect(result).toMatchObject({ recovered: 1, failed: 0 });
    const response: Response = await fetchAndRecordLinkMock.mock.calls[0][2]();
    expect(response.url).toBe("http://www.sdfcu.org/sites/default/files/pdf/fees.pdf?v=2");
    expect(await response.text()).toBe("%PDF-1.7 fees");
  });
});

describe("selectUnreachableLinks", () => {
  it("asks only for links the plain fetch could not reach, and drops links on another site", async () => {
    const offSite = { ...sdfcu, id: 7016, fee_schedule_url: "https://www.lpl.com/disclosures.pdf", profile_canonical_source_url: "https://www.lpl.com/disclosures.pdf" };
    const db = dbReturning([offSite, sdfcu]);
    const rows = await selectUnreachableLinks(db, 3);
    expect(rows.map((row) => Number(row.id))).toEqual([4416]);
    const call = (db as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call.slice(1)).toContainEqual(["network_error", "timeout", "http_5xx"]);
    expect(call.slice(1)).toContain(ADDRESS_VARIANT_FETCH_STRATEGY.strategy);
  });
});
