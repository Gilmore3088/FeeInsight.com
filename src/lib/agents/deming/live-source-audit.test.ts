// @vitest-environment node
import { describe, expect, it } from "vitest";
import { auditHash, boundedAuditJson, evaluateLiveAuditFee, freezeLiveAuditFee, liveAuditPolicyFingerprint,
  makeLiveAuditDraw, LIVE_SOURCE_AUDIT, type LiveAuditCatalogRow, type LiveAuditFee, type LiveAuditGraph,
  type LiveAuditGroup, type LiveAuditPage, type LiveAuditPolicy } from "./live-source-audit";

const at = "2026-10-19T12:00:00.000Z";
const website = "https://example.invalid/";
const oldUrl = `${website}old-2024-fees.pdf`, currentUrl = `${website}current-2026-fees.pdf`;
export function liveFee(overrides: Partial<LiveAuditCatalogRow> = {}): LiveAuditFee {
  const row = { id: 1, fee_published_id: 1, fee_verified_id: 2, fee_raw_id: 3, institution_id: 1,
    canonical_fee_key: "overdraft", fee_name: "Overdraft Fee", amount: 35, amount_kind: "flat", rate_percent: null,
    account_product_type: null, frequency: "per_item", conditions: null, waiver_text: null, rate_basis: null,
    fee_audience: "consumer", source_document_id:10, ...overrides } as LiveAuditCatalogRow;
  return freezeLiveAuditFee(row, { id: 10, institutionId:1, url: oldUrl, contentHash: "a".repeat(64), r2Key: null, status: "fetched", supersededById: null }, null);
}
export function liveGroup(fee = liveFee(), overrides: Partial<LiveAuditPolicy> = {}): LiveAuditGroup {
  const policy: LiveAuditPolicy = { institutionId: fee.institutionId, websiteUrl: website, feeScheduleUrl: oldUrl,
    canonicalSourceUrl: oldUrl, sourceKind: "html", readStrategy: "html", correctionVersion: 0, lockedByCorrection: false,
    lastSourceHash: fee.source.contentHash, lastSuccessfulSourceDocumentId: fee.source.id, doNotRetry: [], rejectedSourceUrls: [], ...overrides };
  return { institutionId: fee.institutionId, policy, policyFingerprint: liveAuditPolicyFingerprint(policy), feeIds: [fee.id], sources: [fee.source] };
}
export function livePage(url: string, text: string, overrides: Partial<LiveAuditPage> = {}): LiveAuditPage {
  return { requestedUrl: url, finalUrl: url, contentHash: auditHash(text), textHash: auditHash(text), checkedAt: at,
    contentType: "text/plain", etag: null, lastModified: null, status: 200, effectiveDate: null, text, links: [], ...overrides };
}
const schedule = (amount = 35) => `Consumer Fee Schedule\nEffective January 1, 2026\nOverdraft Fee $${amount}.00 per item\nStop Payment $30.00 per item\nWire Transfer $20.00 per item\nPaper Statement $3.00 per month`;
export function liveGraph(text = schedule(), url = currentUrl): LiveAuditGraph {
  return { entryUrl: website, complete: true, reason: null, candidateUrls: [url], pages: [
    livePage(website, "Welcome", { links: [{ url, label: "Consumer Fee Schedule" }] }), livePage(url, text) ] };
}

describe("separate fresh official-source policy", () => {
  it("supports an own current consumer fee without borrowing the remembered edition", () => {
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), liveGraph(), at)).toMatchObject({ status: "supported", finalUrl: currentUrl });
  });
  it("requires positive same-fee current price contradiction for mismatch", () => {
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), liveGraph(schedule(40)), at)).toMatchObject({ status: "mismatch", dimensions: ["amount"] });
  });
  it("absence is unknown, never an incorrect fee label", () => {
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), liveGraph(schedule().replace(/Overdraft[^\n]*\n/, "")), at)).toMatchObject({ status: "unknown", dimensions: [] });
  });
  it("old URL200 and its unchanged bytes cannot pass when the official homepage links the new schedule", () => {
    const graph = liveGraph(schedule(40)); graph.pages.push(livePage(oldUrl, schedule(35), { contentHash: "a".repeat(64) }));
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), graph, at)).toMatchObject({ status: "mismatch", finalUrl: currentUrl });
    graph.pages = graph.pages.filter((p) => p.requestedUrl !== currentUrl);
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), graph, at).status).toBe("unknown");
  });
  it("an unlinked direct row URL is not official authority", () => {
    const graph = liveGraph(); graph.pages[0].links = [];
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), graph, at).status).toBe("unknown");
  });
  it("keeps a currently delegated older named product distinct from the newer general schedule", () => {
    const productUrl = `${website}safe-debit-2025.pdf`;
    const product = "Safe Debit Account Pricing and Information\nACCOUNT TERMS AND FEES\nMoney Orders $1.65 per item\nATM Non-Network Fee $2.50 per item\nACCOUNT FEATURES";
    const fee = liveFee({ fee_name: "Money Orders", canonical_fee_key: "money_order", amount: 1.65, account_product_type: "Safe Debit Account" });
    const graph = liveGraph("Consumer Fee Schedule\nEffective January 1, 2026\nMoney Orders $5.00 per item\nStop Payment $30.00 per item\nWire Transfer $20.00 per item");
    graph.pages[1].links = [{ url: productUrl, label: "Safe Debit Account Pricing and Information" }];
    graph.candidateUrls.push(productUrl); graph.pages.push(livePage(productUrl, product));
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), graph, at)).toMatchObject({ status: "supported", finalUrl: productUrl });
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), liveGraph(), at).status).toBe("unknown");
  });
  it.each(["For personal assistance with business account fees, call us", "Business Account Fee Schedule"])("never borrows consumer scope from %s", (title) => {
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), liveGraph(schedule().replace("Consumer Fee Schedule", title)), at).status).toBe("unknown");
  });
  it.each(["unreadable", "link_limit", "page_limit", "text_limit", "cancelled"])("keeps incomplete %s evidence unknown", (reason) => {
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), { ...liveGraph(), complete: false, reason }, at)).toMatchObject({ status: "unknown", reason });
  });
  it("does not label equal-category/equal-price different products as interchangeable", () => {
    const fee = liveFee({ account_product_type: "Distinct Checking Account" });
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), liveGraph(), at).status).toBe("unknown");
  });
  it("preserves known stored supersession as conflicting authority", () => {
    const fee = liveFee(); fee.source.supersededById = 20;
    const graph = liveGraph(); graph.pages[1].contentHash = fee.source.contentHash!;
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), graph, at)).toMatchObject({ status: "unknown", reason: "stored_source_superseded" });
  });
  it("does not use an older complete graph after a newer incomplete graph", () => {
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), { ...liveGraph(), complete: false, reason: "fetch_failed" }, at).status).toBe("unknown");
  });
  it("never interprets a null primary-product attestation as general/all-product authority", () => {
    const mixed = "Consumer Fee Schedule\nPremium Checking Account\nOverdraft Fee $35.00 per item\nStandard Checking Account\nStop Payment $30.00 per item\nWire Transfer $20.00 per item";
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), liveGraph(mixed), at)).toMatchObject({ status: "unknown", reason: "unassigned_product_scope_unproven" });
  });
  it.each(["conditions", "waiver_text"] as const)("requires %s to belong to the own fee instead of a neighboring price", (field) => {
    const fee = liveFee({ [field]: "when balance is below $100" });
    const graph = liveGraph(schedule().replace("Stop Payment $30.00 per item", "Stop Payment $30.00 per item when balance is below $100"));
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), graph, at)).toMatchObject({ status: "unknown", reason: "own_conditions_unproven" });
    const own = liveGraph(schedule().replace("Overdraft Fee $35.00 per item", "Overdraft Fee $35.00 per item when balance is below $100"));
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), own, at).status).toBe("supported");
  });
  it("keeps omitted own applicability unknown instead of assuming null means unconditional", () => {
    const graph = liveGraph(schedule().replace("Overdraft Fee $35.00 per item", "Overdraft Fee $35.00 per item when balance is below $100"));
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), graph, at)).toMatchObject({ status: "unknown", reason: "own_conditions_incomplete" });
  });
  it("binds the graph entry to the frozen homepage while allowing its observed redirect", () => {
    const wrong = liveGraph(); wrong.entryUrl = "https://other.invalid/";
    wrong.pages[0].requestedUrl = wrong.entryUrl; wrong.pages[0].finalUrl = wrong.entryUrl;
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), wrong, at)).toMatchObject({ status: "unknown", reason: "official_entry_identity_changed" });
    const redirected = liveGraph(); redirected.pages[0].finalUrl = "https://www.example.invalid/";
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), redirected, at).status).toBe("supported");
  });
  it.each(["Premium Checking Account:","Premium Checking | Standard Savings","Premium Account"])("keeps an unassigned row unknown under a named %s heading",heading=>{
    expect(evaluateLiveAuditFee(liveFee(),liveGroup(),liveGraph(schedule().replace("Overdraft Fee",heading+"\nOverdraft Fee")),at).status).toBe("unknown");
  });
  it("refuses unsupported institution, omitted frequency/basis and extra own restrictions",()=>{
    const fee=liveFee();fee.source.institutionId=2;
    expect(evaluateLiveAuditFee(fee,liveGroup(fee),liveGraph(),at).status).toBe("unknown");
    const missing=liveFee({frequency:null});expect(evaluateLiveAuditFee(missing,liveGroup(missing),liveGraph(),at).reason).toBe("frequency_not_recorded");
    const restricted=liveFee({conditions:"when balance is below $100"});
    expect(evaluateLiveAuditFee(restricted,liveGroup(restricted),liveGraph(schedule().replace("per item","per item when balance is below $100 unless premium account")),at).status).toBe("unknown");
    const foreign=liveGraph(schedule(),"https://other-bank.invalid/consumer-fees.pdf");expect(evaluateLiveAuditFee(liveFee(),liveGroup(),foreign,at).reason).toBe("candidate_institution_unproven");
  });
  it("enforces distinct-link/metadata caps and observation age even on a complete injected graph",()=>{
    const links=liveGraph();links.pages[0].links.push(...Array.from({length:81},(_,i)=>({url:`https://fixture.invalid/a${i}`,label:"navigation"})));
    links.pages[1].links.push(...Array.from({length:81},(_,i)=>({url:`https://fixture.invalid/b${i}`,label:"navigation"})));
    expect(evaluateLiveAuditFee(liveFee(),liveGroup(),links,at).reason).toBe("graph_limit");
    const large=liveGraph();large.pages[1].links=[{url:currentUrl,label:"x".repeat(33000)}];expect(evaluateLiveAuditFee(liveFee(),liveGroup(),large,at).reason).toBe("graph_limit");
    const stale=liveGraph();stale.pages[1].checkedAt="2026-10-17T00:00:00.000Z";expect(evaluateLiveAuditFee(liveFee(),liveGroup(),stale,at).reason).toBe("live_observation_stale");
  });

});

describe("bounded immutable draw", () => {
  const draw = (extra: Record<string, unknown> = {}) => makeLiveAuditDraw({ day: "2026-10-19", asOf: at, seed: "1".repeat(64), populationIds: [1], rows: [liveFee()], groups: [liveGroup()], ...extra });
  it("freezes IDs, exact fee and semantic authority independently", () => {
    const result = draw(); expect(result.state).toBe("ready"); expect(result.rows[0].fingerprint).toBe(liveFee().fingerprint);
    expect(liveFee({ amount: 40 }).fingerprint).not.toBe(liveFee().fingerprint);
    expect(liveGroup(liveFee(), { correctionVersion: 1 }).policyFingerprint).not.toBe(liveGroup().policyFingerprint);
  });
  it("never biases a frame by silently dropping over-cap IDs", () => {
    const result = draw({ populationIds: Array.from({ length: LIVE_SOURCE_AUDIT.population + 1 }, (_, i) => i + 1) });
    expect(result).toMatchObject({ state: "unavailable", reason: "population_cap", populationCount: null, rows: [] });
  });
  it("exposes inventory drift instead of redrawing or shrinking to surviving rows", () => {
    expect(draw({ populationIds: [1, 2] })).toMatchObject({ state: "unavailable", reason: "sample_inventory_mismatch" });
  });
  it("checks escaped UTF8 and exact byte caps before serialization", () => {
    expect(() => boundedAuditJson("\ud800", 5)).toThrow(/limit/);
    expect(() => boundedAuditJson({ x: "\u0001".repeat(20) }, 100)).toThrow(/limit/);
    expect(() => freezeLiveAuditFee({ ...liveFee().catalog, conditions: "x".repeat(9000) }, liveFee().source, null)).toThrow(/limit/);
    expect(() => boundedAuditJson({ x: Number.NaN }, 100)).toThrow(/type/);
  });
  it("records an empty population without claiming support100%", () => {
    expect(draw({ populationIds: [], rows: [], groups: [] })).toMatchObject({ state: "ready", populationCount: 0, rows: [] });
  });
});
