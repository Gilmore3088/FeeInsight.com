// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { auditHash, boundedAuditJson, evaluateLiveAuditFee, freezeLiveAuditFee, liveAuditContradiction, liveAuditFeeUrls, liveAuditPolicyFingerprint,
  makeLiveAuditDraw, liveTextIsShell, LIVE_SOURCE_AUDIT, LIVE_SOURCE_AUDIT_CHECKER, LIVE_TEXT_SHELL, type LiveAuditCatalogRow, type LiveAuditFee, type LiveAuditGraph,
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
/** Enough ordinary schedule text that a page without the fee is a real page, not a script shell. */
const terms = Array.from({ length: 6 }, (_, i) => `Section ${i + 1}. Terms and disclosures for personal deposit accounts.`).join("\n");
const capSchedule = (heading = "") => `Consumer Fee Schedule\nEffective January 1, 2026\n${heading ? `${heading}\n` : ""}NSF Fee\n• $140 Maximum. $35 per item\nStop Payment Fee\n• $30 per request\nWire Transfer Fee\n• $20 per item`;
/** The fee's own page as one chunk fetched it (2026-11-02: the fee's document address, not the homepage graph). */
export function pageGraph(text = schedule(), overrides: Partial<LiveAuditPage> = {}, url = oldUrl): LiveAuditGraph {
  return { entryUrl: url, complete: true, reason: null, candidateUrls: [url], failed: [], pages: [livePage(url, text, overrides)] };
}

describe("a verdict against the bank's live copy of the fee's own page", () => {
  it("supports a fee the live page prints at our amount, with the shared match rule", () => {
    expect(checkFeeAgainstSource(schedule(), "Overdraft Fee", 35, ".", "overdraft").ok).toBe(true);
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), pageGraph(), at)).toMatchObject({
      status: "supported", reason: "own_current_fee_supported", dimensions: [], finalUrl: oldUrl,
      sourceLine: expect.stringContaining("$35.00"), checker: LIVE_SOURCE_AUDIT_CHECKER,
    });
  });
  it("calls the fee's own row at another single price a mismatch on amount", () => {
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), pageGraph(schedule(40)), at)).toMatchObject({
      status: "mismatch", reason: "positive_current_contradiction", dimensions: ["amount"], sourceLine: expect.stringContaining("$40.00"),
    });
  });
  it("calls a fee the loaded page does not print not found, with the check's reason", () => {
    const result = evaluateLiveAuditFee(liveFee(), liveGroup(), pageGraph(`${schedule().replace(/Overdraft[^\n]*\n/, "")}\n${terms}`), at);
    expect(result).toMatchObject({ status: "not_found", dimensions: [], sourceLine: null, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.reason).toMatch(/^not_on_live_page:/);
  });
  it("is unknown only when the page did not load, and says why", () => {
    const failed: LiveAuditGraph = { entryUrl: oldUrl, complete: false, reason: "live_fetch_enotfound", candidateUrls: [oldUrl], pages: [], failed: [{ url: oldUrl, reason: "live_fetch_enotfound" }] };
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), failed, at)).toMatchObject({ status: "unknown", reason: "live_fetch_enotfound" });
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), pageGraph(schedule(), { status: 404 }), at)).toMatchObject({ status: "unknown", reason: "live_http_404" });
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), pageGraph("   "), at)).toMatchObject({ status: "unknown", reason: "live_page_no_text" });
    const noUrl = freezeLiveAuditFee(liveFee().catalog, { ...liveFee().source, url: null }, null);
    expect(evaluateLiveAuditFee(noUrl, liveGroup(noUrl), pageGraph(), at)).toMatchObject({ status: "unknown", reason: "fee_document_url_missing" });
  });
  it("reads the fee's own address, never another page in the graph", () => {
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), pageGraph(schedule(), {}, currentUrl), at)).toMatchObject({ status: "unknown", reason: "live_page_not_fetched" });
  });
  it("no longer turns an incomplete graph, a missing consumer heading or unrecorded terms into unknown", () => {
    // Each of these was an unknown before Nov 2 (97 of 97 on prod); the page loaded, so it is scored.
    const bare = "Overdraft Fee $35.00 per item when your balance is below zero";
    const fee = liveFee({ frequency: null, fee_audience: null });
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), { ...pageGraph(bare), complete: false, reason: "live_page_cap" }, at).status).toBe("supported");
  });
  it("calls a priced fee whose name the category guard refuses for our category a category mismatch", () => {
    const fee = liveFee({ fee_name: "Wire Transfer", canonical_fee_key: "overdraft", amount: 20 });
    const result = evaluateLiveAuditFee(fee, liveGroup(fee), pageGraph(), at);
    // Labelled apart from a price contradiction: the page prints our price, the guard refuses the name.
    expect(result).toMatchObject({ status: "mismatch", reason: "category_guard", dimensions: ["category"] });
  });
  it("calls a plain-fetch script shell unknown, never not found", () => {
    const withoutFee = `${schedule().replace(/Overdraft[^\n]*\n/, "")}\n${terms}`;
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), pageGraph("Please enable JavaScript to view this site."), at))
      .toMatchObject({ status: "unknown", reason: "live_text_shell", contentHash: null });
    // A real-length page far thinner than the copy Magellan stored from a browser read is a shell too.
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), pageGraph(withoutFee), at, { chars: 40_000 }))
      .toMatchObject({ status: "unknown", reason: "live_text_shell" });
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), pageGraph(withoutFee), at, { chars: withoutFee.length }).status).toBe("not_found");
    // A shell that does print the fee still supports it.
    expect(evaluateLiveAuditFee(liveFee(), liveGroup(), pageGraph("Overdraft Fee $35.00 per item"), at, { chars: 40_000 }).status).toBe("supported");
    expect(liveTextIsShell(LIVE_TEXT_SHELL.floorChars - 1, null)).toBe(true);
    expect(liveTextIsShell(LIVE_TEXT_SHELL.floorChars, null)).toBe(false);
    expect(liveTextIsShell(999, 900)).toBe(false);
  });
  it.each([
    ["Youth Checking (ages 18 and under)", { eligibilityContext: "Youth Checking (ages 18 and under)" }],
    ["Ages 18 and under", { eligibilityContext: "Ages 18 and under" }],
    ["Youth Checking (ages 18 and under)\nOther available services", { producerScopeUnknown: true }],
  ])("keeps a restricted or unproven witness (%s) unknown instead of general-product support", (heading, metadata) => {
    const fee = liveFee({ fee_name: "NSF Fee", canonical_fee_key: "nsf", amount: 5 });
    const text = capSchedule(heading).replace("$35 per item", "$5 per item");
    expect(checkFeeAgainstSource(text, "NSF Fee", 5, ".", "nsf")).toEqual({ ok: true, sourceLine: "NSF Fee | • $140 Maximum. $5 per item", ...metadata });
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), pageGraph(text), at)).toMatchObject({ status: "unknown", reason: "own_applicability_unproven", dimensions: [] });
  });
  it("keeps the leading maximum of a stacked price from reading as the item price", () => {
    const capped = "Consumer Fee Schedule\nNSF Fee\n• $140 Maximum. $35 per item\nStop Payment Fee\n• $30 per request";
    const own = liveFee({ fee_name: "NSF Fee", canonical_fee_key: "nsf", amount: 35 });
    expect(evaluateLiveAuditFee(own, liveGroup(own), pageGraph(capped), at).status).toBe("supported");
    const cap = liveFee({ fee_name: "NSF Fee", canonical_fee_key: "nsf", amount: 140 });
    expect(evaluateLiveAuditFee(cap, liveGroup(cap), pageGraph(capped), at).status).not.toBe("supported");
  });
  it("finds a contradiction only on the fee's own row with one price", () => {
    const fee = liveFee().catalog;
    expect(liveAuditContradiction("Overdraft Fee $40.00 per item", fee)).toMatchObject({ amount: 40 });
    expect(liveAuditContradiction("Overdraft Fee $40.00 per item, $5.00 daily after 3 days", fee)).toBeNull();
    expect(liveAuditContradiction("Overdraft Fee $40.00 per item\nOverdraft Fee $45.00 per item", fee)).toBeNull();
    expect(liveAuditContradiction("Returned Item Fee $40.00 per item", fee)).toBeNull();
  });
  it("lists each fee's document address once, as fetched", () => {
    const other = freezeLiveAuditFee({ ...liveFee().catalog, id: 2 }, { ...liveFee().source, url: `${oldUrl}#page=2` }, null);
    expect(liveAuditFeeUrls([liveFee(), other])).toEqual([oldUrl]);
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

/**
 * Draw 275762 (Nov 2): of 11 fees not found on their live page, 7 were right and the audit missed them.
 * The texts are the banks' own lines from the stored and live copies.
 */
describe("verdict 2: the cited page, a band price and the stored reading of the same bytes", () => {
  const landing = "https://statebankeaston.invalid/checking-accounts/", cited = "https://statebankeaston.invalid/services-fees-charges/";
  const easton = `Wire Transfers\nOutgoing - domestic | $20.00\nStop Payment | $20.00\nLevy/Garnishment Fee | $25.00\nFax - Outgoing First Page | $2.00\nAdditional Sheets | $0.50\nFax - Incoming First Page | $1.00\nPhotocopies | $0.25\n${terms}`;
  const guaranty = `Fee Schedule\nStop payment - all types of items | $35.00/stop\nDormant Savings Accounts - No deposits or withdrawals to the account for one year and the balance is $49.99 or less* | $15.00/ annually\nAccount closed within 90 days of opening | $10.00\nLost passbooks | $10.00\n${terms}`;
  const welch = `Your Choice Checking\nAccount Features\n$50 minimum deposit to open\n$6.29 monthly fee for mailed paper statements\nTiered Interest Checking\nAn interest-bearing checking account designed for customers who maintain higher account balances.\nAccount Features\n$50 minimum deposit to open\n30-day grace period to reach the required minimum balance\nMaintain a minimum balance of $1,500 to avoid a $6.00 monthly service charge during the statement cycle\nMonthly paper statements included\n${terms}`;
  const trustoneStored = `OTHER ACCOUNT SERVICE FEES\nCLOSED ACCOUNT | $20 if closed within 6 months\nDORMANT ACCOUNT | Up to $100 at time of escheat\nINACTIVE ACCOUNT ** | $10 per month\nIRA TRANSFER | $25 per transfer\n** Combined balance $100 or below, inactive more than 365 days. Waived for minors.`;
  /** A plain reading of the same bytes that lost the pairing: names and prices in separate runs. */
  const trustoneLive = `OTHER ACCOUNT SERVICE FEES\nCLOSED ACCOUNT\nDORMANT ACCOUNT\nINACT IVE ACC OUNT **\nIRA TRANSFER\n$20 if closed within 6 months\nUp to $100 at time of escheat\n$10 per month\n$25 per transfer\n${terms}`;

  it("fetches and judges the page the fee cites, not its document's landing page", () => {
    const fee = freezeLiveAuditFee({ ...liveFee().catalog, fee_name: "Fax - Outgoing First Page", canonical_fee_key: "document_reproduction", amount: 2,
      document_url: cited } as LiveAuditCatalogRow, { ...liveFee().source, url: landing }, null);
    expect(liveAuditFeeUrls([fee])).toEqual([cited]);
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), pageGraph(easton, {}, cited), at)).toMatchObject({
      status: "supported", requestedUrl: cited, sourceLine: "Fax - Outgoing First Page | $2.00" });
    // The landing page is no longer what the fee is judged on.
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), pageGraph(`Checking\nThere is a service charge of $3 per monthly statement.\n${terms}`, {}, landing), at))
      .toMatchObject({ status: "unknown", reason: "live_page_not_fetched" });
  });
  it("falls back to the document's address when the catalog cites none", () => {
    expect(liveAuditFeeUrls([liveFee()])).toEqual([oldUrl]);
    expect(liveAuditFeeUrls([liveFee({ document_url: "javascript:void(0)" } as Partial<LiveAuditCatalogRow>)])).toEqual([oldUrl]);
  });
  it("supports a fee the page prices for its balance band, quoting the bank's line", () => {
    const named = liveFee({ fee_name: "Dormant Savings Accounts", canonical_fee_key: "dormant_account", amount: 15 });
    expect(checkFeeAgainstSource(guaranty, "Dormant Savings Accounts", 15, ".", "dormant_account")).toMatchObject({ ok: false, reason: "tiered_fee" });
    expect(evaluateLiveAuditFee(named, liveGroup(named), pageGraph(guaranty), at)).toMatchObject({
      status: "supported", reason: "own_current_fee_supported", sourceLine: expect.stringContaining("$49.99 or less* | $15.00") });
    const product = liveFee({ fee_name: "Tiered Interest Checking Monthly service charge", canonical_fee_key: "monthly_maintenance", amount: 6 });
    expect(evaluateLiveAuditFee(product, liveGroup(product), pageGraph(welch), at)).toMatchObject({
      status: "supported", sourceLine: "Maintain a minimum balance of $1,500 to avoid a $6.00 monthly service charge during the statement cycle" });
  });
  it("leaves a band price unknown when no single line of the bank's can be quoted", () => {
    const twice = `${welch}\nPremier Checking\nMaintain a minimum balance of $2,500 to avoid a $6.00 monthly service charge during the statement cycle`;
    const product = liveFee({ fee_name: "Monthly service charge", canonical_fee_key: "monthly_maintenance", amount: 6 });
    expect(evaluateLiveAuditFee(product, liveGroup(product), pageGraph(twice), at)).toMatchObject({ status: "unknown", reason: "band_line_unproven" });
  });
  it("judges a page serving the stored copy's own bytes on the stored reading too", () => {
    const fee = liveFee({ fee_name: "Inactive Account", canonical_fee_key: "dormant_account", amount: 10 });
    const sameBytes = pageGraph(trustoneLive, { contentHash: fee.source.contentHash! });
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), sameBytes, at).status).toBe("not_found");
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), sameBytes, at, { text: trustoneStored })).toMatchObject({
      status: "supported", sourceLine: "INACTIVE ACCOUNT ** | $10 per month", contentHash: fee.source.contentHash });
    // Changed bytes: the stored reading is of another document and proves nothing about today's.
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), pageGraph(trustoneLive), at, { text: trustoneStored }).status).toBe("not_found");
    // The stored reading never supports a fee it does not print either.
    expect(evaluateLiveAuditFee(fee, liveGroup(fee), sameBytes, at, { text: trustoneStored.replace("INACTIVE ACCOUNT ** | $10 per month\n", "") }).status).toBe("not_found");
  });
  it("records the verdict version on every verdict", () => {
    expect(LIVE_SOURCE_AUDIT_CHECKER).toMatch(/:verdict2$/);
  });
});
