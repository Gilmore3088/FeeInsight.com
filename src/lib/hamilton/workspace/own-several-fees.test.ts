import { describe, expect, it } from "vitest";
import { ownFeeFromRows } from "@/lib/own-fee";
import { reconcileAnswer, type LiveFeeValues } from "../answer-correctness";
import { buildFeeAnswer } from "./answer";
import { buildAskResponse, parseAsk } from "./ask";
import { splitOwnFees } from "./research";
import { overdraftResearch } from "./test-fixtures";
import type { FeeResearch, OwnFeeRow } from "./types";

// Invented fixture bank (#2030): its schedule states two stop payment fees, $20 online and $25
// in a branch. Their statistics value is $22.50; neither is a price of its own. No live data.
const QUESTION = "How does our stop payment fee compare with peers?";

const ownRow = (id: number, feeName: string, amount: number): OwnFeeRow => ({
  id,
  feeName,
  amount,
  sourceDocumentId: 77,
  documentUrl: "https://example.org/own-schedule.pdf",
  sourceUrl: "https://example.org/fees",
  publishedAt: "2026-09-12T00:00:00Z",
  verifiedByEventId: null,
});

function stopPaymentFee() {
  const rows = [
    { fee_name: "Stop payment, online", amount: 20 },
    { fee_name: "Stop payment, in branch", amount: 25 },
  ];
  return ownFeeFromRows("stop_payment", rows, 22.5, false)!;
}

function stopPaymentResearch(): FeeResearch {
  const { ownValues, ownSeveral } = splitOwnFees(new Map([["stop_payment", stopPaymentFee()]]));
  return overdraftResearch({
    institutionId: 1000,
    feeCategory: "stop_payment",
    displayName: "Stop payment",
    current: ownValues.get("stop_payment") ?? null,
    ownSeveral: ownSeveral.get("stop_payment") ?? null,
    ownRows: [ownRow(9, "Stop payment, in branch", 25), ownRow(10, "Stop payment, online", 20)],
    revenueLine: null,
  });
}

function liveFor(r: FeeResearch, own: number[] = [20, 25]): LiveFeeValues {
  return {
    rows: [
      ...own.map((amount) => ({ institution_id: r.institutionId, amount, fee_category: r.feeCategory })),
      ...[...r.peers, ...(r.localCompetitors ?? []), ...r.layers.flatMap((l) => l.members)].map((m) => ({
        institution_id: m.institutionId,
        amount: m.amount,
        fee_category: r.feeCategory,
      })),
    ],
  };
}

describe("a bank whose schedule states several stop payment fees (#2030)", () => {
  it("keeps the several fees beside the priced ones, from the shared own-fee helpers", () => {
    const { ownValues, ownSeveral } = splitOwnFees(new Map([["stop_payment", stopPaymentFee()]]));
    expect(ownValues.has("stop_payment")).toBe(false);
    expect(ownSeveral.get("stop_payment")).toEqual({
      low: 20,
      high: 25,
      fees: [
        { name: "Stop payment, online", amount: 20 },
        { name: "Stop payment, in branch", amount: 25 },
      ],
    });
  });

  it("states the bank's own fees instead of calling them missing", () => {
    const answer = buildFeeAnswer(stopPaymentResearch());
    expect(answer.headline).not.toMatch(/not in the index/);
    expect(answer.headline).toContain("$20 to $25");
    const own = answer.claims.find((c) => c.source.label.endsWith("published fee schedule"));
    expect(own?.text).toContain("$20 to $25 (Stop payment, online $20; Stop payment, in branch $25)");
    expect(own?.source.url).toBe("https://example.org/own-schedule.pdf");
    // The fee is on file, so the answer does not ask the bank what it charges.
    expect(answer.question?.fieldKey).not.toBe("fee.stop_payment.current_amount");
    expect(answer.storyline?.keyFigures[0]).toMatchObject({ value: "$20 to $25" });
  });

  it("passes the eval's own-fee check when the answer states the live fees", () => {
    const r = stopPaymentResearch();
    const response = buildAskResponse({ question: QUESTION, intent: parseAsk(QUESTION), research: r, memory: [] });
    const result = reconcileAnswer({ question: QUESTION, response, research: r, live: liveFor(r) });
    expect(result.failures.filter((f) => f.startsWith("your fee"))).toEqual([]);
  });

  it("still fails the check when the stated fees differ from the live ones", () => {
    const r = stopPaymentResearch();
    const response = buildAskResponse({ question: QUESTION, intent: parseAsk(QUESTION), research: r, memory: [] });
    const result = reconcileAnswer({ question: QUESTION, response, research: r, live: liveFor(r, [20, 30]) });
    expect(result.failures).toContain("your fee: the answer uses $20 to $25, the catalog has $20 to $30");
  });
});
