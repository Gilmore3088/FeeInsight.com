import { describe, expect, it } from "vitest";
import { REPORT_INCLUDES, REPORT_OFFER } from "@/lib/constants";
import { reportFaqItems, reportFaqJsonLd } from "./report-faq";

describe("report FAQ (#1174)", () => {
  const items = reportFaqItems();

  it("answers from the offer constants", () => {
    const answers = items.map((item) => item.answer).join(" ");
    expect(answers).toContain(REPORT_OFFER.priceLabel);
    for (const line of REPORT_INCLUDES) expect(answers).toContain(line);
    expect(answers).toContain(REPORT_OFFER.refreshLabel);
    expect(items[0].question).toContain(REPORT_OFFER.name);
  });

  it("never promises a turnaround or a fixed price", () => {
    const text = items.map((item) => `${item.question} ${item.answer}`).join(" ");
    // "Within one business day" is the reply promise; no delivery time is given in digits.
    expect(text).not.toMatch(/\b\d+\s*(hours?|days?|weeks?)\b/i);
    // The only price is the label ("From $300"): each report is quoted.
    expect(text.replace(REPORT_OFFER.priceLabel, "")).not.toMatch(/\$\d/);
  });

  it("gives search the same questions and answers the page shows", () => {
    const ld = reportFaqJsonLd(items);
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(items.map((item) => [item.question, item.answer]));
  });
});
