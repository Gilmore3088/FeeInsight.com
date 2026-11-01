// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CONSUMER_TEXT, fixtureEligibility, fixtureReference, REFERENCE_AS_OF } from "@/lib/data-store/__fixtures__/answer-key-reference";

const store = vi.hoisted(() => ({ persisted: 0 }));
vi.mock("@/lib/data-store/answer-key-reference-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/data-store/answer-key-reference-store")>();
  return {
    ...real,
    persistReferenceReceipt: async () => { store.persisted += 1; return store.persisted; },
    readReferenceEligibility: async () => fixtureEligibility(),
  };
});

const { needsRenewal, refreshReferenceEligibility, REFERENCE_RENEWAL_MARGIN_MS } = await import("./answer-key-eligibility");

const html = '<html><main><a href="/consumer-fees.pdf">Consumer Fee Schedule</a></main></html>';
const fetchImpl = vi.fn(async (url: unknown) => {
  const result = new Response(String(url).endsWith(".pdf") ? CONSUMER_TEXT : html,
    { status: 200, headers: { "Content-Type": String(url).endsWith(".pdf") ? "text/plain" : "text/html" } });
  Object.defineProperty(result, "url", { value: String(url) });
  return result;
});

describe("eligible receipts are renewed before they lapse (#2533)", () => {
  it("renews a receipt with less than half its life left and reuses a fresh one", () => {
    const issued = Date.parse(REFERENCE_AS_OF);
    const receipt = { expiresAt: new Date(issued + 24 * 3_600_000).toISOString() };
    expect(needsRenewal(receipt, new Date(issued + 60_000))).toBe(false);
    expect(needsRenewal(receipt, new Date(issued + 24 * 3_600_000 - REFERENCE_RENEWAL_MARGIN_MS + 1))).toBe(true);
    // Yesterday's receipt at today's run: one minute left, so the run renews it.
    expect(needsRenewal(receipt, new Date(issued + 24 * 3_600_000 - 60_000))).toBe(true);
  });

  it("re-observes yesterday's eligible key at today's run instead of letting it expire after the run", async () => {
    const snapshot = fixtureEligibility(fixtureReference());
    expect(snapshot.keys[0].status).toBe("eligible");
    const nextDay = new Date(Date.parse(REFERENCE_AS_OF) + 24 * 3_600_000 - 60_000);
    const result = await refreshReferenceEligibility({ db: vi.fn() as never, runId: 1, stepId: 1, dryRun: false, snapshot,
      fetchImpl: fetchImpl as unknown as typeof fetch, now: () => nextDay });
    expect(result.attempted).toBe(1);
    expect(result.persisted).toBe(1);
    // The same receipt an hour after issue is reused: no source request.
    fetchImpl.mockClear();
    const fresh = await refreshReferenceEligibility({ db: vi.fn() as never, runId: 1, stepId: 1, dryRun: false, snapshot,
      fetchImpl: fetchImpl as unknown as typeof fetch, now: () => new Date(Date.parse(REFERENCE_AS_OF) + 3_600_000) });
    expect(fresh.attempted).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
