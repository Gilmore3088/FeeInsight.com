import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  evaluateReferenceEligibility, referenceKeyFingerprint, referenceSourceFingerprint,
  type ReferenceDiscoveryEvidence, type ReferenceKeySnapshot, type ReferencePageObservation, type ReferenceSourceIdentity,
} from "./answer-key-eligibility";

const asOf = "2026-10-19T08:00:00.000Z";
const consumerText = "Consumer Fee Schedule\nEffective July 15, 2024\nOverdraft fee $25\nStop payment fee $20\nWire transfer fee $15";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function page(text = consumerText, url = "https://bank.example/consumer-fees.pdf"): ReferencePageObservation {
  return {
    requestedUrl: url, finalUrl: url, contentHash: hash(text), contentType: "application/pdf",
    etag: null, lastModified: null, checkedAt: asOf, effectiveDate: null,
    sourceDocumentId: 10, sourceTextId: 11, textHash: hash(text), status: 200, text, links: [],
  };
}
function key(document = page()): ReferenceKeySnapshot {
  return {
    answerKeyId: 1, institutionId: 999, institutionName: "Fixture Bank",
    websiteUrl: "https://bank.example/", institutionFeeScheduleUrl: document.requestedUrl,
    documentUrl: document.requestedUrl, documentType: "text_pdf", contentHash: document.contentHash,
    status: "confirmed", confirmedBy: "existing person", confirmedAt: "2026-10-18T08:00:00.000Z",
    fees: [{ id: 1, canonicalKey: "overdraft", amount: 25, amountKind: "fixed", frequency: "per_item",
      conditions: null, sourceLine: "Overdraft fee $25", uncertain: false, status: "confirmed",
      confirmedBy: "existing person", confirmedAt: "2026-10-18T08:00:00.000Z" }],
  };
}
function discovery(pages: ReferencePageObservation[]): ReferenceDiscoveryEvidence {
  return { entryUrls: ["https://bank.example/"], examinedUrls: pages.map((p) => p.requestedUrl),
    candidateUrls: pages.map((p) => p.requestedUrl), completeWithinProtocol: true,
    linkedFromOfficialSite: true, limitReason: null };
}
function decide(pages = [page()], snapshot = key(pages[0]), observation = discovery(pages)) {
  return evaluateReferenceEligibility({ key: snapshot, pages, sources: [], discovery: observation, asOf });
}

describe("recordable reference-document decisions (#1862)", () => {
  // Issue-reported failures are synthetic reproductions, not newly fetched bank evidence.
  it("does not reauthorize explicitly superseded exact key bytes from a still-linked page", () => {
    const document=page(), snapshot=key(document);
    const source:ReferenceSourceIdentity={id:10,documentUrl:document.requestedUrl,contentHash:document.contentHash,status:"success",supersededById:20,
      duplicateOfId:null,textId:11,textHash:document.textHash,textStatus:"completed",documentKind:"fee_schedule"};
    const check=(sources:typeof source[])=>evaluateReferenceEligibility({key:snapshot,pages:[document],sources,discovery:discovery([document]),asOf});
    expect(check([source]).facts.current).toEqual({status:"unknown",reasons:["reference_source_superseded"]});
    expect(check([{...source,contentHash:hash("unrelated older document")}]).status).toBe("eligible");
    expect(check([{...source,supersededById:null,duplicateOfId:12,status:"failed"}]).status).toBe("eligible");
  });

  it("rejects iTHINK key114's business schedule even with personal navigation", () => {
    const document = page("Personal\nBusiness Fee Schedule\nOverdraft fee $25\nStop payment fee $20\nWire transfer fee $15", "https://bank.example/business-fees.pdf");
    const receipt = decide([document], { ...key(document), answerKeyId: 114, institutionId: 6820 });
    expect(receipt).toMatchObject({ answerKeyId: 114, status: "rejected", facts: { consumer: { status: "fail", reasons: ["business_document"] } } });
  });

  it("does not mistake personal-assistance service copy for a consumer section", () => {
    const document = page("Business Fee Schedule\nFor personal assistance with business account fees, call us\nOverdraft fee $25\nStop payment fee $20\nWire transfer fee $15", "https://bank.example/business-fees.pdf");
    expect(decide([document]).facts.consumer).toEqual({ status: "fail", reasons: ["business_document"] });
  });

  it("rejects Texas Capital key6's page for products no longer available to open", () => {
    const document = page(`${consumerText}\nPreviously Offered Products\nAccount types previously offered and no longer available to open as of May 3, 2023.`);
    const newer = page(consumerText, "https://bank.example/current-consumer-fees.pdf");
    const receipt = decide([document, newer], { ...key(document), answerKeyId: 6, institutionId: 2426 });
    expect(receipt).toMatchObject({ status: "rejected", facts: { current: { status: "fail", reasons: ["legacy_not_current"] } } });
  });

  it("rejects TDECU key83's rates hub without priced fees", () => {
    const document = page("Personal Rates\nSavings APY 4.00%\nChecking APY 1.00%\nCD minimum balance $1000\nSee banking fees in the linked schedule.", "https://bank.example/rates");
    const receipt = decide([document], { ...key(document), answerKeyId: 83, institutionId: 2420 });
    expect(receipt).toMatchObject({ status: "rejected", facts: { priced: { status: "fail", reasons: ["not_priced_schedule"] } } });
  });

  it("keeps a byte-bound, priced consumer schedule eligible without changing its human confirmation", () => {
    const snapshot = key();
    const before = structuredClone(snapshot);
    const receipt = decide([page()], snapshot);
    expect(receipt.status).toBe("eligible");
    expect(receipt.facts).toMatchObject({ consumer: { status: "pass" }, current: { status: "pass" }, priced: { status: "pass" } });
    expect(snapshot).toEqual(before);
    expect(receipt.expiresAt).toBe("2026-10-20T08:00:00.000Z");
    expect(receipt.observations[0]).not.toHaveProperty("text");
  });

  it("keeps consumer lines in a combined document separate from business lines", () => {
    const document = page(`${consumerText}\nBusiness Fee Schedule\nCommercial overdraft fee $35\nBusiness stop payment fee $30\nBusiness wire transfer fee $40`);
    expect(decide([document]).status).toBe("eligible");
    const snapshot = key(document);
    snapshot.fees[0].sourceLine = "Commercial overdraft fee $35";
    expect(decide([document], snapshot).facts.consumer.status).not.toBe("pass");
  });

  it.each(["no official path", "incomplete discovery", "missing hash", "changed bytes", "missing source line"])("keeps inadequate evidence unknown: %s", (condition) => {
    const document = page();
    const snapshot = key(document);
    const observed = discovery([document]);
    if (condition === "no official path") observed.linkedFromOfficialSite = false;
    if (condition === "incomplete discovery") { observed.completeWithinProtocol = false; observed.limitReason = "page_limit"; }
    if (condition === "missing hash") snapshot.contentHash = null;
    if (condition === "changed bytes") document.contentHash = hash("changed");
    if (condition === "missing source line") snapshot.fees[0].sourceLine = null;
    expect(decide([document], snapshot, observed).status).toBe("unknown");
  });

  it("keeps PDF bytes bound: changed bytes stay unknown even with every key line present", () => {
    const document = page();
    document.contentHash = hash("changed");
    expect(decide([document], key(page())).facts.current).toEqual({ status: "unknown", reasons: ["reference_bytes_changed"] });
  });

  it("binds an HTML reference to its main text, not its bytes (#2466)", () => {
    const html = (text = consumerText) => ({ ...page(text, "https://bank.example/fees"), contentType: "text/html; charset=utf-8",
      contentHash: hash(`<html>${Date.now()}</html>`) });
    const snapshot = { ...key(page(consumerText, "https://bank.example/fees")), documentType: "html", contentHash: hash("bytes from another fetch") };
    expect(decide([html()], snapshot).facts.current).toEqual({ status: "pass", reasons: ["current_within_recorded_observation"] });
    expect(decide([html()], { ...snapshot, contentHash: null }).status).toBe("eligible");
    const edited = html(consumerText.replace("Overdraft fee $25", "Overdraft fee $35"));
    expect(decide([edited], snapshot).facts.current).toEqual({ status: "unknown", reasons: ["reference_main_text_changed"] });
    expect(decide([edited], snapshot).status).toBe("unknown");
    // A PDF served under an HTML content type, or keyed as a PDF, stays byte-bound.
    expect(decide([html()], { ...snapshot, documentType: "text_pdf" }).facts.current.reasons).toEqual(["reference_bytes_changed"]);
  });

  it("does not bind an HTML edition dated after the key was confirmed by key lines alone (#2466)", () => {
    const later = consumerText.replace("July 15, 2024", "October 19, 2026");
    const html = { ...page(later, "https://bank.example/fees"), contentType: "text/html", contentHash: hash("fresh bytes") };
    const snapshot = { ...key(page(consumerText, "https://bank.example/fees")), documentType: "html", contentHash: hash("old bytes") };
    expect(decide([html], snapshot).facts.current).toEqual({ status: "unknown", reasons: ["reference_main_text_changed"] });
    // The same edition is still bound when its main text hash is the key's hash.
    expect(decide([html], { ...snapshot, contentHash: hash(later) }).facts.current.status).toBe("pass");
    // Without a confirmation date, key lines alone cannot bind an HTML edition.
    const undated = { ...page(consumerText, "https://bank.example/fees"), contentType: "text/html", contentHash: hash("fresh bytes") };
    expect(decide([undated], { ...snapshot, confirmedAt: null }).facts.current.reasons).toEqual(["reference_main_text_changed"]);
  });

  it("accepts a consumer schedule with no audience heading and no business evidence (#2466)", () => {
    const plain = consumerText.replace("Consumer Fee Schedule", "Schedule of Fees");
    const receipt = decide([page(plain)]);
    expect(receipt.facts.consumer).toEqual({ status: "pass", reasons: ["consumer_reference_lines_no_business_evidence"] });
    expect(receipt.status).toBe("eligible");
    expect(decide([page(`${plain}\nFunds are available within two business days`)]).facts.consumer.status).toBe("pass");
    // A consumer merchant fee line whose price sits on the next line is not a business label.
    expect(decide([page(`${plain}\nMerchant Dispute Fee`)]).facts.consumer.status).toBe("pass");
  });

  it.each([
    ["a business section label", "Schedule of Fees\nOverdraft fee $25\nBusiness Checking\nWire transfer fee $15", "unknown", "consumer_scope_unproven"],
    ["a bulleted business label", "Schedule of Fees\nOverdraft fee $25\n• Business Checking\nWire transfer fee $15", "unknown", "consumer_scope_unproven"],
    ["a cash management label", "Schedule of Fees\nOverdraft fee $25\nCash Management Services\nWire transfer fee $15", "unknown", "consumer_scope_unproven"],
    ["a non-personal label", "Schedule of Fees\nOverdraft fee $25\n## Non-Personal Accounts\nWire transfer fee $15", "unknown", "consumer_scope_unproven"],
    ["a business fees section", "Schedule of Fees\nOverdraft fee $25\nBusiness Checking Fees\nWire transfer fee $15", "fail", "business_document"],
    ["a treasury fees section", "Schedule of Fees\nOverdraft fee $25\nTreasury Management Fees\nWire transfer fee $15", "unknown", "consumer_scope_unproven"],
    ["a spaced non personal label", "Schedule of Fees\nOverdraft fee $25\nNon Personal Accounts\nWire transfer fee $15", "unknown", "consumer_scope_unproven"],
    ["a business-only schedule", "Business Fee Schedule\nOverdraft fee $25\nWire transfer fee $15", "fail", "business_document"],
    ["a business URL", "Schedule of Fees\nOverdraft fee $25\nWire transfer fee $15", "fail", "business_document"],
    ["a missing key line", "Schedule of Fees\nNSF fee $25\nWire transfer fee $15", "unknown", "key_line_not_in_reference"],
  ])("keeps a schedule without a consumer heading out when it has %s", (condition, text, status, reason) => {
    const document = page(text, condition === "a business URL" ? "https://bank.example/business-fees.pdf" : undefined);
    expect(decide([document]).facts.consumer).toEqual({ status, reasons: [reason] });
  });

  it("rejects a newer currently effective consumer schedule, but does not replace today with a future edition", () => {
    const old = page(consumerText.replace("2024", "2023"));
    const newer = page(consumerText, "https://bank.example/new-consumer-fees.pdf");
    expect(decide([old, newer]).facts.current.reasons).toEqual(["newer_consumer_schedule"]);
    const future = page(consumerText.replace("2024", "2027"), newer.requestedUrl);
    expect(decide([old, future]).status).toBe("eligible");
  });

  it("does not infer a priced schedule from its title, yields or balance thresholds", () => {
    const document = page("Consumer Fee Schedule\nSavings APY 4.00%\nMinimum balance $1000\nOpening deposit $500");
    expect(decide([document]).facts.priced.status).toBe("fail");
  });

  it("does not approve a consumer-only document that lacks the exact confirmed reference line", () => {
    const snapshot = key();
    snapshot.fees[0].sourceLine = "A different institution's overdraft fee $25";
    expect(decide([page()], snapshot).facts.consumer).toEqual({ status: "unknown", reasons: ["key_line_not_in_reference"] });
    snapshot.fees[0].sourceLine = "Overdraft   fee\n$25";
    expect(decide([page()], snapshot).status).toBe("eligible");
  });

  it("does not infer current applicability while a linked schedule remains opaque", () => {
    const opaque = page("Consumer Fee Schedule", "https://bank.example/other-fees.pdf");
    expect(decide([page(), opaque]).facts.current).toEqual({ status: "unknown", reasons: ["candidate_classification_unknown"] });
  });
});

describe("exact reference fingerprints", () => {
  it.each(["category", "price", "kind", "frequency", "conditions", "source line", "uncertainty", "status", "attribution", "document"])("changes after a %s edit", (field) => {
    const snapshot = key();
    const before = referenceKeyFingerprint(snapshot);
    if (field === "category") snapshot.fees[0].canonicalKey = "nsf";
    if (field === "price") snapshot.fees[0].amount = 25.01;
    if (field === "kind") snapshot.fees[0].amountKind = "varies";
    if (field === "frequency") snapshot.fees[0].frequency = "monthly";
    if (field === "conditions") snapshot.fees[0].conditions = "waived";
    if (field === "source line") snapshot.fees[0].sourceLine += " per item";
    if (field === "uncertainty") snapshot.fees[0].uncertain = true;
    if (field === "status") snapshot.fees[0].status = "prefilled";
    if (field === "attribution") snapshot.fees[0].confirmedBy = "another existing person";
    if (field === "document") snapshot.documentUrl += "?v=2";
    expect(referenceKeyFingerprint(snapshot)).not.toBe(before);
  });
  it("does not hash input row ordering as a measurement change", () => {
    const snapshot = key();
    snapshot.fees.push({ ...snapshot.fees[0], id: 2, canonicalKey: "nsf" });
    expect(referenceKeyFingerprint(snapshot)).toBe(referenceKeyFingerprint({ ...snapshot, fees: [...snapshot.fees].reverse() }));
    expect(referenceSourceFingerprint([])).toMatch(/^[a-f0-9]{64}$/);
  });
});
