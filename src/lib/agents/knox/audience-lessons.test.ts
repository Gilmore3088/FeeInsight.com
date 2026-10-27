import { describe, expect, it } from "vitest";
import { candidateWriteFacts } from "./candidate-facts";
import { prospectiveTakedownIdentity } from "./takedown-witness";
import {
  audienceLessonFlag, audienceLessonFor, audienceLessonsFrom, audienceLessonsLive, emptyAudienceLessons,
  KNOX_AUDIENCE_LESSONS_SWITCH, withAudienceLesson,
} from "./audience-lessons";
import type { ExtractedFeeCandidate } from "./rules";

const read = (changes: Partial<ExtractedFeeCandidate> = {}): ExtractedFeeCandidate => ({
  feeName: "Business ATM/Debit Transactions, off premises", amount: 2, frequency: null, canonicalHint: "atm_non_network",
  confidence: 0.9, excerpt: "Business ATM/Debit Transactions, off premises | $2.00", waivable: false, ...changes,
});

// Two confirmed business-schedule takedowns: a business-named fee on a mixed schedule (doc 40), and a
// fee read from a business-only schedule's address (doc 50).
const lessons = audienceLessonsFrom([
  { feedback_id: 11, source_document_id: 40, fee_name: "Business ATM/Debit Transactions, off premises", amount: "2.00", business_document: false },
  { feedback_id: 12, source_document_id: 50, fee_name: "Monthly Service Charge", amount: 20, business_document: true },
]);

describe("Knox audience lessons from confirmed business-schedule takedowns (#2062)", () => {
  it("is off unless its switch says on", () => {
    const env = (value?: string) => (value == null ? {} : { [KNOX_AUDIENCE_LESSONS_SWITCH]: value }) as NodeJS.ProcessEnv;
    expect(audienceLessonsLive(env())).toBe(false);
    expect(audienceLessonsLive(env("false"))).toBe(false);
    expect(audienceLessonsLive(env(" 'TRUE' "))).toBe(true);
    expect(audienceLessonsLive(env("1"))).toBe(true);
  });

  it("learns the same document's fee of the same name, however it is spelled", () => {
    expect(audienceLessonFor(read(), lessons, 40)).toEqual({ scope: "name", feedbackId: 11 });
    expect(audienceLessonFor(read({ feeName: "BUSINESS ATM / DEBIT TRANSACTIONS - off premises" }), lessons, 40)).toEqual({ scope: "name", feedbackId: 11 });
    // A mixed schedule's other fees, and the same name on the bank's other documents, are not taught.
    expect(audienceLessonFor(read({ feeName: "ATM/Debit Transactions, off premises", excerpt: "ATM/Debit Transactions | $2.00" }), lessons, 40)).toBeNull();
    expect(audienceLessonFor(read(), lessons, 41)).toBeNull();
  });

  it("teaches a name only at the amount the takedown read, since a mixed schedule may print it again at a consumer price", () => {
    expect(audienceLessonFor(read({ amount: 2.5, excerpt: "Business ATM/Debit Transactions, off premises | $2.50" }), lessons, 40)).toBeNull();
    // On a business-only document the document lesson still covers any amount.
    expect(audienceLessonFor(read({ feeName: "Monthly Service Charge", amount: 15, excerpt: "Monthly Service Charge | $15.00" }), lessons, 50))
      .toEqual({ scope: "document", feedbackId: 12 });
    // No usable amount teaches no name lesson.
    expect(audienceLessonsFrom([{ feedback_id: 3, source_document_id: 7, fee_name: "Business Fee", amount: null, business_document: false }]).names.size).toBe(0);
  });

  it("learns every fee of a business-only document", () => {
    expect(audienceLessonFor(read({ feeName: "Stop Payment", excerpt: "Stop Payment | $35.00", canonicalHint: "stop_payment" }), lessons, 50))
      .toEqual({ scope: "document", feedbackId: 12 });
    expect(audienceLessonFor(read({ feeName: "Monthly Service Charge", amount: 20, excerpt: "Monthly Service Charge | $20.00" }), lessons, 50))
      .toEqual({ scope: "name", feedbackId: 12 });
  });

  it("never overrides an audience the line states", () => {
    const consumer = read({ feeName: "Stop Payment", amount: 35, excerpt: "Stop Payment (consumer accounts) | $35.00" });
    expect(candidateWriteFacts(consumer).applicability.feeAudience).toBe("consumer");
    expect(audienceLessonFor(consumer, lessons, 50)).toBeNull();
    // Even a candidate carrying a lesson keeps the line's own audience.
    expect(candidateWriteFacts(withAudienceLesson(consumer, { scope: "document", feedbackId: 12 })).applicability.feeAudience).toBe("consumer");
  });

  it("writes the lesson's audience and evidence, and the takedown identity follows it", () => {
    const plain = read({ feeName: "Stop Payment", excerpt: "Stop Payment | $35.00", canonicalHint: "stop_payment" });
    expect(candidateWriteFacts(plain).applicability).toMatchObject({ feeAudience: "unknown", audienceEvidence: null });
    const learned = withAudienceLesson(plain, { scope: "document", feedbackId: 12 });
    expect(candidateWriteFacts(learned).applicability).toMatchObject({
      feeAudience: "business", audienceEvidence: "knox_lesson:hamilton.business_schedule:document (confirmed takedown feedback #12)", feeTreatment: "charged",
    });
    expect(prospectiveTakedownIdentity(9, learned)?.audience).toBe("business");
    expect(audienceLessonFlag("document")).toBe("knox_lesson:business_audience:document");
  });

  it("reads nothing from no lessons or a bad document id", () => {
    expect(audienceLessonFor(read(), emptyAudienceLessons(), 40)).toBeNull();
    expect(audienceLessonsFrom([{ feedback_id: 1, source_document_id: "x", fee_name: "Fee", amount: 1, business_document: true }]).loaded).toBe(0);
  });
});
