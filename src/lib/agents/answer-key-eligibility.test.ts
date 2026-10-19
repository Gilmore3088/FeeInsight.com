// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeReferenceDocument, refreshReferenceEligibility } from "./answer-key-eligibility";
import { CONSUMER_TEXT, fixtureEligibility, fixtureReference } from "@/lib/data-store/__fixtures__/answer-key-reference";
import { evaluateReferenceEligibility } from "@/lib/data-store/answer-key-eligibility";

const html = '<html><main><a href="/consumer-fees.pdf">Consumer Fee Schedule</a></main></html>';
const response = (body: string, type = "text/html", status = 200) => new Response(body, { status, headers: { "Content-Type": type, ETag: '"fixture"' } });
const options = (fetchImpl: typeof fetch) => ({ signal: new AbortController().signal, fetchImpl });
afterEach(() => vi.useRealTimers());

describe("bounded current-reference observation (injected networking only)", () => {
  it("follows the official link, preserves final URL/header/hash provenance, and accepts priced consumer text", async () => {
    const fixture = fixtureReference();
    const fetchImpl = vi.fn(async (url: unknown) => {
      const result = String(url).endsWith(".pdf") ? response(CONSUMER_TEXT, "text/plain") : response(html);
      Object.defineProperty(result, "url", { value: String(url) });
      return result;
    });
    const observed = await observeReferenceDocument(fixture.input, options(fetchImpl as typeof fetch));
    expect(observed.discovery).toMatchObject({ completeWithinProtocol: true, linkedFromOfficialSite: true });
    expect(observed.pages[1]).toMatchObject({ requestedUrl: fixture.input.key.documentUrl, finalUrl: fixture.input.key.documentUrl,
      etag: '"fixture"', contentHash: fixture.input.key.contentHash });
    expect(evaluateReferenceEligibility({ ...fixture.input, ...observed, asOf: new Date().toISOString() }).status).toBe("eligible");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not infer an official path from a direct-key fetch alone", async () => {
    const fixture = fixtureReference();
    const observed = await observeReferenceDocument(fixture.input, options((async (url) => String(url).endsWith(".pdf")
      ? response(CONSUMER_TEXT, "text/plain") : response("<main>Welcome</main>")) as typeof fetch));
    expect(observed.discovery.linkedFromOfficialSite).toBe(false);
    expect(evaluateReferenceEligibility({ ...fixture.input, ...observed, asOf: new Date().toISOString() }).status).toBe("unknown");
  });

  it.each(["fetch", "body", "parser"])("bounds a stalled %s even when an injected dependency ignores abort", async (stage) => {
    vi.useFakeTimers();
    const never = () => new Promise<never>(() => undefined);
    const fetchImpl = (async () => {
      if (stage === "fetch") return never();
      const result = response(stage === "parser" ? "%PDF-fixture" : CONSUMER_TEXT, "application/pdf");
      if (stage === "body") Object.defineProperty(result, "arrayBuffer", { value: never });
      return result;
    }) as typeof fetch;
    const task = observeReferenceDocument(fixtureReference().input, { ...options(fetchImpl), pdfText: never });
    await vi.advanceTimersByTimeAsync(16_010);
    const observed = await task;
    expect(observed.discovery.completeWithinProtocol).toBe(false);
    expect(observed.discovery.limitReason).toBe("reference_timeout_or_cancelled");
  });

  it("does not start a fetch after cancellation", async () => {
    const signal = AbortSignal.abort(new Error("synthetic cancellation"));
    const fetchImpl = vi.fn();
    const observed = await observeReferenceDocument(fixtureReference().input, { signal, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(observed.discovery.completeWithinProtocol).toBe(false);
  });

  it.each(["oversized bytes", "oversized text", "bad status", "unsupported format", "candidate unreadable", "page cap"])("keeps %s as incomplete evidence", async (kind) => {
    const fixture = fixtureReference();
    const fetchImpl = (async (url: unknown) => {
      if (!String(url).endsWith(".pdf")) return response(kind === "page cap"
        ? `<main>${Array.from({ length: 8 }, (_, i) => `<a href="/fees-${i}.pdf">Fee Schedule ${i}</a>`).join("")}</main>` : html);
      if (kind === "candidate unreadable") throw new Error("injected unavailable source");
      if (kind === "oversized bytes") return response("x".repeat(8 * 1024 * 1024 + 1), "text/plain");
      if (kind === "oversized text") return response("x".repeat(1_000_001), "text/plain");
      if (kind === "bad status") return response("unavailable", "text/plain", 503);
      if (kind === "unsupported format") return response("opaque", "application/octet-stream");
      return response(CONSUMER_TEXT, "text/plain");
    }) as typeof fetch;
    const observed = await observeReferenceDocument(fixture.input, options(fetchImpl));
    expect(observed.discovery.completeWithinProtocol).toBe(false);
    expect(evaluateReferenceEligibility({ ...fixture.input, ...observed, asOf: new Date().toISOString() }).status).not.toBe("eligible");
  });

  it("passes cancellation and PDF limits into the shared Rosetta parser", async () => {
    const pdfText = vi.fn(async () => ({ text: CONSUMER_TEXT, totalPages: 1 }));
    await observeReferenceDocument(fixtureReference().input, { ...options((async () => response("%PDF-fixture", "application/pdf")) as typeof fetch), pdfText });
    expect(pdfText).toHaveBeenCalledWith(expect.any(Uint8Array), expect.objectContaining({ signal: expect.any(AbortSignal),
      timeoutMs: 8000, maxPages: 30, maxTextChars: 1_000_000, maxItems: 100_000 }));
  });

  it.each(["dry run", "missing run", "missing step", "snapshot read failed"])("does no source work for %s", async (kind) => {
    const fetchImpl = vi.fn();
    const snapshot = fixtureEligibility();
    if (kind === "snapshot read failed") snapshot.readError = true;
    const result = await refreshReferenceEligibility({ db: vi.fn() as never, runId: kind === "missing run" ? null : 1,
      stepId: kind === "missing step" ? null : 1, dryRun: kind === "dry run", snapshot, fetchImpl });
    expect(result.attempted).toBe(0); expect(fetchImpl).not.toHaveBeenCalled();
  });
});
