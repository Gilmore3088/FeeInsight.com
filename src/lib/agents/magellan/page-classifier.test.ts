import { describe, expect, it, vi } from "vitest";
import {
  MIN_EXAMPLES_PER_LABEL,
  classifyPage,
  pageFeatures,
  refreshPageClassifier,
  scoreHoldout,
  trainPageClassifier,
  withoutRequestEcho,
  type PageExample,
} from "./page-classifier";

const SCHEDULE = [
  "Schedule of Fees and Charges",
  "Overdraft fee $35.00 per item",
  "Returned item (NSF) fee $35.00",
  "Stop payment $30.00",
  "Outgoing domestic wire $25.00",
  "Cashier's check $10.00",
].join("\n");

const CHECKING_PAGE = [
  "Free Checking. Open an account online in minutes.",
  "No monthly maintenance fee with e-Statements.",
  "Earn rewards with your debit card. Mobile banking and Zelle included.",
  "Apply now",
].join("\n");

function examples(count: number): PageExample[] {
  const rows: PageExample[] = [];
  for (let index = 0; index < count; index += 1) {
    rows.push({ id: index * 2 + 1, text: `${SCHEDULE}\nDormant account $${5 + (index % 4)}.00`, url: `https://bank${index}.com/fee-schedule.pdf`, feePage: true });
    rows.push({ id: index * 2 + 2, text: `${CHECKING_PAGE}\nBranch ${index}`, url: `https://bank${index}.com/personal/checking`, feePage: false });
  }
  return rows;
}

describe("page classifier", () => {
  it("features include words, address words and the rule check's counts", () => {
    const features = pageFeatures(SCHEDULE, "https://bank.com/disclosures/fee-schedule.pdf");
    expect(features.has("w:overdra")).toBe(true);
    expect(features.has("u:schedul")).toBe(true);
    expect(features.has("u:.pdf")).toBe(true);
    expect(features.has("s:rule_fee_page")).toBe(true);
    expect(features.has("s:fee_lines_3")).toBe(true);
  });

  it("reads a page without the request headers it echoes back (our own user agent)", () => {
    // The top of a credit union page on one site platform, stored 2026-10 (agent_source_texts 12494).
    const echoed = [
      "Tx1Xx0QrzM8uFSwiGQe8m",
      "www.newellfcu.org",
      "FeeInsightBot/1.0 (Magellan; +https://feeinsight.com/contact)",
      "Ashburn",
      "x-forwarded-for",
      "cloudfront-viewer-city",
      "user-agent",
      "x-vercel-id",
      "x-forwarded-host",
      SCHEDULE,
    ].join("\n");
    expect(withoutRequestEcho(echoed)).toBe(SCHEDULE);
    const features = pageFeatures(echoed, null);
    for (const leaked of ["w:feeinsi", "w:magella", "w:vercel", "w:ashburn", "w:cloudfr"]) expect(features.has(leaked)).toBe(false);
    expect(features.has("w:overdra")).toBe(true);
    // A page that never names our crawler is read whole.
    expect(withoutRequestEcho(`Host\n${SCHEDULE}`)).toBe(`Host\n${SCHEDULE}`);
  });

  it("needs enough examples of each label before it trains", () => {
    expect(trainPageClassifier(examples(MIN_EXAMPLES_PER_LABEL - 1))).toBeNull();
    expect(trainPageClassifier(examples(MIN_EXAMPLES_PER_LABEL))).not.toBeNull();
  });

  it("learns schedules from product pages and scores a held-out set", () => {
    const model = trainPageClassifier(examples(40));
    expect(model).not.toBeNull();
    expect(classifyPage(model!, SCHEDULE, "https://other.com/fees.pdf")).toBeGreaterThan(0.9);
    expect(classifyPage(model!, CHECKING_PAGE, "https://other.com/checking")).toBeLessThan(0.1);
    const score = scoreHoldout(model!, examples(5));
    expect(score.examples).toBe(10);
    expect(score.accuracy).toBe(1);
    expect(score.modelMissesFeePages).toBe(0);
  });

  it("does nothing on a dry run and reports a missing table without throwing", async () => {
    const db = vi.fn(async () => [{ ready: false }]) as unknown as Parameters<typeof refreshPageClassifier>[0];
    await expect(refreshPageClassifier(db, { runId: 1, dryRun: true })).resolves.toMatchObject({ status: "dry_run" });
    await expect(refreshPageClassifier(db, { runId: 1 })).resolves.toMatchObject({ status: "not_ready" });
  });

  it("keeps a model younger than six hours", async () => {
    const trainedAt = new Date("2026-10-06T06:00:00Z");
    const db = vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("to_regclass")) return [{ ready: true }];
      if (text.includes("FROM magellan_page_classifier")) {
        return [{ trained_at: trainedAt, model: { bias: 0, weights: { "w:fee": 1 } }, positives: 40, negatives: 40 }];
      }
      throw new Error(`unexpected query: ${text}`);
    }) as unknown as Parameters<typeof refreshPageClassifier>[0];
    const result = await refreshPageClassifier(db, { runId: 1, now: new Date("2026-10-06T09:00:00Z") });
    expect(result).toMatchObject({ status: "fresh", positives: 40, features: 1 });
  });

  it("retrains a stale model from ledger labels and stores it in shadow", async () => {
    const inserts: unknown[][] = [];
    const rows = examples(40).map((example) => ({
      document_id: example.id,
      kind: example.feePage ? "produced_live_fees" : "thin_link",
      source_url: example.url,
      text: example.text,
    }));
    const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("to_regclass")) return [{ ready: true }];
      if (text.includes("FROM magellan_page_classifier")) return [];
      if (text.includes("FROM pipeline_feedback")) return rows;
      if (text.includes("INSERT INTO magellan_page_classifier")) {
        inserts.push(values);
        return [];
      }
      throw new Error(`unexpected query: ${text}`);
    }) as unknown as Parameters<typeof refreshPageClassifier>[0];
    const result = await refreshPageClassifier(db, { runId: 7, now: new Date("2026-10-06T09:00:00Z") });
    expect(result.status).toBe("trained");
    expect(result.positives).toBe(40);
    expect(result.negatives).toBe(40);
    expect(result.holdout?.examples).toBeGreaterThan(0);
    expect(inserts).toHaveLength(1);
  });
});
