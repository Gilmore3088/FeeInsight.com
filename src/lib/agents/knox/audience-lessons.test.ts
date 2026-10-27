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
/** Doc 50's stored text: a business-only schedule. */
const BUSINESS_TEXT = "Business Fee Schedule\n\nMonthly Service Charge | $20.00\n\nStop Payment | $35.00\n";
const lessonFor = (candidate: ExtractedFeeCandidate, from: typeof lessons, documentId: number) =>
  audienceLessonFor(candidate, from, documentId, documentId === 50 ? BUSINESS_TEXT : null);

// #2072: Portland FCU's document 37425, address `Fee-Schedule?panel=Business-Fees`, stored text copied
// from agent_source_texts (menu trimmed, rows kept in order): the whole tabbed page, not the business tab.
const PORTLAND_TEXT = [
  "Skip to main content", "Personal Loans", "For Your Business", "Business Savings", "Business Checking", "Business Debit Cards",
  "Fee Schedule",
  "This Schedule of Fees sets forth certain conditions, fees and charges applicable to your regular savings, checking, money market and business accounts at PFCU. This schedule is incorporated as part of your account agreement.",
  "Personal Fees", "Service | Fee",
  "Account Activity Printout - current month | $1.00",
  "Account Reconciliation (per hour) | $25.00",
  "Check Printing | (Fee varies by design)",
  "Check Printing (per box - Ages 55+) | $6.00",
  "Copy of Check, Cashier’s Check, Money Order | $3.00",
  "Late Fee - Credit Card Late Payment | $25.00",
  "RETURN CHECK FEE | $5.00",
  "WIRE OUT FEE - Wire Transfer - Outgoing (domestic) | $20.00",
  "*Excludes Youth Accounts (ages 23 years and younger), Prime Time Accounts (ages 55 years and older), and Organizational Accounts.",
  "Fees in all caps are as stated on monthly statement.",
  "Business Fees", "Service | Fee",
  "BELOW MIN BAL (Business Checking PLUS if below min. balance) | $10.00",
  "Copy of a Check | $10.00",
  "RETURN CHECK FEE | $10.00",
  "STOP PAY FEE | $25.00",
  "*Excludes organizational accounts.",
  "Fees in all caps are as stated on monthly statement.",
  "Safe Deposit Boxes",
  "For members that require an off-site location to keep their valuables, we have Safe Deposit Boxes for rent in our Portland, Ionia, Westphalia, Lake Odessa, Lansing, Durand and Swartz Creek offices. All locations do not have all the sizes available.",
  "Size | Annual Fee",
  "3\" x 5\" | $10.00",
  "10\" x 10\" | $50.00",
  "If you lose one key, you will be assessed a $20.00 fee.",
].join("\n\n");
const CCUFL_TEXT = [
  "BUSINESS SCHEDULE OF FEES AND CHARGES Community Credit Union of Florida SIMPLE BUSINESS CHECKING FEES",
  "Monthly Maintenance Fee | $5.00", "Stop Payment | $30.00", "Wire Transfer - Outgoing Domestic | $25.00",
].join("\n");
const tabbed = audienceLessonsFrom([{ feedback_id: 21, source_document_id: 37425, fee_name: "RETURN CHECK FEE", amount: 99, business_document: true }]);
const pure = audienceLessonsFrom([{ feedback_id: 22, source_document_id: 13912, fee_name: "Account Closing", amount: 99, business_document: true }]);
const row = (feeName: string, amount: number) => read({ feeName, amount, excerpt: `${feeName} | $${amount.toFixed(2)}`, canonicalHint: "other" });

describe("Knox audience lessons from confirmed business-schedule takedowns (#2062)", () => {
  it("is off unless its switch says on", () => {
    const env = (value?: string) => (value == null ? {} : { [KNOX_AUDIENCE_LESSONS_SWITCH]: value }) as NodeJS.ProcessEnv;
    expect(audienceLessonsLive(env())).toBe(false);
    expect(audienceLessonsLive(env("false"))).toBe(false);
    expect(audienceLessonsLive(env(" 'TRUE' "))).toBe(true);
    expect(audienceLessonsLive(env("1"))).toBe(true);
  });

  it("learns the same document's fee of the same name, however it is spelled", () => {
    expect(lessonFor(read(), lessons, 40)).toEqual({ scope: "name", feedbackId: 11 });
    expect(lessonFor(read({ feeName: "BUSINESS ATM / DEBIT TRANSACTIONS - off premises" }), lessons, 40)).toEqual({ scope: "name", feedbackId: 11 });
    // A mixed schedule's other fees, and the same name on the bank's other documents, are not taught.
    expect(lessonFor(read({ feeName: "ATM/Debit Transactions, off premises", excerpt: "ATM/Debit Transactions | $2.00" }), lessons, 40)).toBeNull();
    expect(lessonFor(read(), lessons, 41)).toBeNull();
  });

  it("teaches a name only at the amount the takedown read, since a mixed schedule may print it again at a consumer price", () => {
    expect(lessonFor(read({ amount: 2.5, excerpt: "Business ATM/Debit Transactions, off premises | $2.50" }), lessons, 40)).toBeNull();
    // On a business-only document the document lesson still covers any amount.
    expect(lessonFor(read({ feeName: "Monthly Service Charge", amount: 15, excerpt: "Monthly Service Charge | $15.00" }), lessons, 50))
      .toEqual({ scope: "document", feedbackId: 12 });
    // No usable amount teaches no name lesson.
    expect(audienceLessonsFrom([{ feedback_id: 3, source_document_id: 7, fee_name: "Business Fee", amount: null, business_document: false }]).names.size).toBe(0);
  });

  it("learns every fee of a business-only document", () => {
    expect(lessonFor(read({ feeName: "Stop Payment", excerpt: "Stop Payment | $35.00", canonicalHint: "stop_payment" }), lessons, 50))
      .toEqual({ scope: "document", feedbackId: 12 });
    expect(lessonFor(read({ feeName: "Monthly Service Charge", amount: 20, excerpt: "Monthly Service Charge | $20.00" }), lessons, 50))
      .toEqual({ scope: "name", feedbackId: 12 });
  });

  it("never overrides an audience the line states", () => {
    const consumer = read({ feeName: "Stop Payment", amount: 35, excerpt: "Stop Payment (consumer accounts) | $35.00" });
    expect(candidateWriteFacts(consumer).applicability.feeAudience).toBe("consumer");
    expect(lessonFor(consumer, lessons, 50)).toBeNull();
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

  it("on a tabbed page teaches only the fees whose line sits under the business heading (#2072)", () => {
    const at = (feeName: string, amount: number) => audienceLessonFor(row(feeName, amount), tabbed, 37425, PORTLAND_TEXT);
    // Each of these lines states no audience, so trusting the address (v1) labelled every one business.
    for (const [feeName, amount] of [["Account Reconciliation (per hour)", 25], ["Late Fee - Credit Card Late Payment", 25], ["3\" x 5\"", 10]] as const) {
      expect(audienceLessonFor(row(feeName, amount), tabbed, 37425, "Fee Schedule\nService | Fee\n")).toEqual({ scope: "document", feedbackId: 21 });
    }
    // Personal Fees rows stay unknown.
    expect(at("Account Reconciliation (per hour)", 25)).toBeNull();
    expect(at("Check Printing (per box - Ages 55+)", 6)).toBeNull();
    expect(at("Late Fee - Credit Card Late Payment", 25)).toBeNull();
    expect(at("RETURN CHECK FEE", 5)).toBeNull();
    // Business Fees rows are business, a name printed in both tables at its business price included.
    expect(at("Copy of a Check", 10)).toEqual({ scope: "document", feedbackId: 21 });
    expect(at("RETURN CHECK FEE", 10)).toEqual({ scope: "document", feedbackId: 21 });
    // The Safe Deposit Box rows after the business table are for all members: unknown.
    expect(at("3\" x 5\"", 10)).toBeNull();
    expect(at("10\" x 10\"", 50)).toBeNull();
    expect(at("Safe Deposit Box 3x5", 10)).toBeNull();
    // A fee whose line is not on the page cannot be placed: unknown.
    expect(at("Night Deposit Bag", 15)).toBeNull();
  });

  it("still teaches every fee of a business-only schedule, and nothing without its stored text (#2072)", () => {
    expect(audienceLessonFor(row("Monthly Maintenance Fee", 5), pure, 13912, CCUFL_TEXT)).toEqual({ scope: "document", feedbackId: 22 });
    expect(audienceLessonFor(row("Stop Payment", 30), pure, 13912, CCUFL_TEXT)).toEqual({ scope: "document", feedbackId: 22 });
    expect(audienceLessonFor(row("Stop Payment", 30), pure, 13912, null)).toBeNull();
    expect(audienceLessonFor(row("Stop Payment", 30), pure, 13912, "  ")).toBeNull();
  });

  it("reads nothing from no lessons or a bad document id", () => {
    expect(lessonFor(read(), emptyAudienceLessons(), 40)).toBeNull();
    expect(audienceLessonsFrom([{ feedback_id: 1, source_document_id: "x", fee_name: "Fee", amount: 1, business_document: true }]).loaded).toBe(0);
  });
});
