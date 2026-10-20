import { createHash } from "node:crypto";
import { evaluateReferenceEligibility, type ReferencePageObservation, type ReferenceKeySnapshot } from "../answer-key-eligibility";
import { referenceSnapshot, type ReferenceInput } from "../answer-key-reference-store";

export const REFERENCE_AS_OF = "2026-10-19T08:00:00.000Z";
export const REFERENCE_NOW = new Date("2026-10-19T08:00:01.000Z");
export const CONSUMER_TEXT = "Consumer Fee Schedule\nEffective July15,2024\nOverdraft fee $25\nStop payment fee $20\nWire transfer fee $15";
export const referenceHash = (text: string) => createHash("sha256").update(text).digest("hex");
export function fixtureReference(text = CONSUMER_TEXT, path = "/consumer-fees.pdf", answerKeyId = 1): { input: ReferenceInput; page: ReferencePageObservation } {
  const documentUrl = `https://bank.example${path}`;
  const key: ReferenceKeySnapshot = {
    answerKeyId, institutionId: 999, institutionName: "Fixture Bank", websiteUrl: "https://bank.example/",
    institutionFeeScheduleUrl: documentUrl, documentUrl, documentType: "text_pdf", contentHash: referenceHash(text),
    status: "confirmed", confirmedBy: "existing person", confirmedAt: "2026-10-18T00:00:00.000Z",
    fees: [{ id: 1, canonicalKey: "overdraft", amount: 25, amountKind: "fixed", frequency: "per_item",
      conditions: null, sourceLine: "Overdraft fee $25", uncertain: false, status: "confirmed",
      confirmedBy: "existing person", confirmedAt: "2026-10-18T00:00:00.000Z" }],
  };
  return { input: { key, sources: [], rawState: {} }, page: {
    requestedUrl: documentUrl, finalUrl: documentUrl, contentHash: key.contentHash!, contentType: "application/pdf",
    etag: null, lastModified: null, checkedAt: REFERENCE_AS_OF, effectiveDate: null, sourceDocumentId: null,
    sourceTextId: null, textHash: referenceHash(text), status: 200, text, links: [],
  } };
}
export function fixtureReceipt(fixture = fixtureReference()) {
  return evaluateReferenceEligibility({ ...fixture.input, pages: [fixture.page], asOf: REFERENCE_AS_OF,
    discovery: { entryUrls: ["https://bank.example/"], examinedUrls: [fixture.page.requestedUrl],
      candidateUrls: [fixture.page.requestedUrl], completeWithinProtocol: true, linkedFromOfficialSite: true, limitReason: null } });
}
export function fixtureEvent(receipt = fixtureReceipt(), id = 1) {
  return { id, step_valid: true, agent_run_id: 10, detail: receipt as unknown, created_at: "2026-10-19T08:00:00.100Z" };
}
export function fixtureEligibility(fixture = fixtureReference()) {
  return referenceSnapshot([fixture.input], [fixtureEvent(fixtureReceipt(fixture))], REFERENCE_NOW);
}
