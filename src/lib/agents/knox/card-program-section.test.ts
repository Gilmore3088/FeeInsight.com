import { describe, expect, it } from "vitest";
import { withoutCardProgramSections } from "@/lib/custom-report/card-program-section";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";
import { CARD_SECTION_KEEP_DOCS } from "./__fixtures__/card-program-section-docs";

// #1905 / #1908: Navy Federal's general schedule (doc 39026) prints its debit card and stop payment
// fees, then a "Prepaid and Gift Cards" section. Every re-read published the GO Prepaid card's ATM
// fee and the gift card's lost card fee as the account's.
const SCHEDULE = [
  "Fees and Charges",
  "Debit Card Fees",
  "Fee | Amount",
  "Debit card replacement | $10.00",
  "Stop payment for a single item | $20.00",
  "",
  "Prepaid and Gift Cards",
  "Visa® Gift Cards",
  "Fee | Amount",
  "Card Purchase Charge | $3.00",
  "Lost/Stolen Card | $5.00",
  "GO Prepaid Cards",
  "Fee | Amount",
  "Visa/PLUS Network ATM domestic and foreign cash withdrawal and balance inquiry | $1.00 per transaction",
  "Lost/Stolen Card | $5.00",
].join("\n");

describe("Knox v116: a card program section's rows are not the account's (#1908, #1905)", () => {
  const { candidates } = runFreeSpecialists(SCHEDULE, { institutionName: "Navy Federal Credit Union" });

  it("is version 116", () => {
    expect(KNOX_RULES_STRATEGY.version).toBe(116);
  });

  it("reads none of the prepaid or gift card's rows as the account's", () => {
    expect(candidates.some((fee) => fee.amount === 5)).toBe(false);
    expect(candidates.some((fee) => fee.amount === 1)).toBe(false);
  });

  it("still reads the account's rows above the section", () => {
    expect(candidates.some((fee) => fee.amount === 10 && fee.canonicalHint === "card_replacement")).toBe(true);
    expect(candidates.some((fee) => fee.amount === 20 && fee.canonicalHint === "stop_payment")).toBe(true);
  });

  it("reads the same rows as the account's when no card heading is over them", () => {
    const plain = SCHEDULE.replace("Prepaid and Gift Cards\nVisa® Gift Cards", "Card Services").replace("GO Prepaid Cards", "More Card Services");
    const read = runFreeSpecialists(plain, { institutionName: "Navy Federal Credit Union" }).candidates;
    expect(read.some((fee) => fee.amount === 5)).toBe(true);
  });
});

// #1908 review (Oct 25): stored texts where an early v116 left out real fees. Each must read as it
// did before v116 apart from card program fees, and keep its own fees.
describe("Knox v116 keeps purchase prices and the account's rows next to card words (#1908 review)", () => {
  const read = (doc: string) => runFreeSpecialists(CARD_SECTION_KEEP_DOCS[doc]).candidates;
  const has = (doc: string, amount: number, key: string) =>
    read(doc).some((fee) => fee.amount === amount && fee.canonicalHint === key);

  it("leaves nothing out of these texts but card program fees", () => {
    const left = Object.fromEntries(Object.entries(CARD_SECTION_KEEP_DOCS).map(([doc, text]) => {
      const kept = new Set(withoutCardProgramSections(text).split("\n"));
      return [doc, text.split("\n").filter((line) => !kept.has(line))];
    }));
    expect(left).toEqual({
      ...Object.fromEntries(Object.keys(CARD_SECTION_KEEP_DOCS).map((doc) => [doc, []])),
      // The gift card's own inactivity fee and the travel card's price are the card program's.
      "7837": ["Inactivity Fee | $2.95"],
      "16435": ["reloadable for 12 months, other fees may | $10 per card"],
    });
  });

  it("reads a gift or prepaid card's price by audience or unit as its purchase price", () => {
    expect(has("7837", 3, "gift_card_purchase")).toBe(true);
    expect(has("7837", 9, "gift_card_purchase")).toBe(true);
    expect(has("13154", 2.5, "gift_card_purchase")).toBe(true);
    expect(has("13154", 4.5, "gift_card_purchase")).toBe(true);
    expect(has("28000", 2.5, "gift_card_purchase")).toBe(true);
    expect(has("28784", 5, "gift_card_purchase")).toBe(true);
    expect(has("29093", 5, "gift_card_purchase")).toBe(true);
    expect(has("32047", 3, "gift_card_purchase")).toBe(true);
    expect(has("38218", 3.95, "gift_card_purchase")).toBe(true);
  });

  it("does not take a perk line for a card heading", () => {
    expect(has("24508", 18, "monthly_maintenance")).toBe(true);
  });

  it("keeps the account's rows under a card heading in an interleaved or wrapped layout", () => {
    expect(has("13154", 25, "nsf")).toBe(true);
    expect(has("29762", 5, "dormant_account")).toBe(true);
    expect(has("20767", 95, "collection_item")).toBe(true);
    expect(has("20767", 5, "early_closure")).toBe(true);
    expect(has("20767", 10, "monthly_maintenance")).toBe(true);
    expect(withoutCardProgramSections(CARD_SECTION_KEEP_DOCS["32047"])).toContain("External Payment By Phone | $10");
    expect(withoutCardProgramSections(CARD_SECTION_KEEP_DOCS["16435"])).toContain("Commercial Business Package $30 monthly");
    expect(withoutCardProgramSections(CARD_SECTION_KEEP_DOCS["29762"])).toContain("Inactivity Fee (defined as no activity for 6 months on any share or $5.00 per month");
  });
});
