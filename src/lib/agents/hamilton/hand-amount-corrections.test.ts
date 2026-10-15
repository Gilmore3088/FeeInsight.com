import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import docs from "@/lib/agents/knox/__fixtures__/cut-cents-docs-2026-10-15.json";
import {
  HAND_AMOUNT_CHECK,
  HAND_AMOUNT_CORRECTIONS,
  HAND_REJECTED_TWINS,
  applyHandAmountCorrections,
  planHandAmountCorrections,
  planTwinRejections,
} from "./hand-amount-corrections";

type Doc = { text_id: number; text: string; text_sha256: string };
const textOf = (doc: number) => (docs as unknown as Record<string, Doc>)[String(doc)].text;

/** Each live row as it reads on prod (Oct 15), with its document's stored text. */
const OLD_NAMES: Record<number, string> = { 49175: "00 Loan Skip A Pay Fee", 29166: "00 ATM Transactions (per item)" };
const liveRows = HAND_AMOUNT_CORRECTIONS.map((fix) => ({
  fee_published_id: fix.feePublishedId,
  lineage_ref: fix.feePublishedId + 1_000_000,
  institution_id: fix.institutionId,
  canonical_fee_key: fix.canonicalFeeKey,
  fee_name: OLD_NAMES[fix.feePublishedId] ?? fix.feeName,
  amount: fix.from.toFixed(2),
  source_document_id: fix.sourceDocumentId,
  normalized_text: textOf(fix.sourceDocumentId),
}));

describe("hand amount corrections (#1334)", () => {
  it("uses the stored texts byte for byte", () => {
    for (const [doc, entry] of Object.entries(docs as unknown as Record<string, Doc | string>)) {
      if (typeof entry === "string") continue;
      expect(createHash("sha256").update(entry.text).digest("hex"), doc).toBe(entry.text_sha256);
    }
  });

  it("corrects all eight on their own stored text: the corrected price traces and the cut one no longer does", () => {
    const plan = planHandAmountCorrections(liveRows);
    expect(plan.skipped).toEqual([]);
    expect(plan.corrected.map((fix) => [fix.feePublishedId, fix.from, fix.to])).toEqual([
      [49175, 29, 29.95], [29166, 1, 1.5], [141772, 1, 1.5], [97435, 1, 1.5],
      [61650, 1, 1.5], [61934, 4, 4.5], [79234, 7, 7.5], [79237, 3, 3.5],
    ]);
    expect(plan.corrected.find((fix) => fix.feePublishedId === 49175)).toMatchObject({ oldName: "00 Loan Skip A Pay Fee", newName: "Loan Skip A Pay Fee" });
  });

  it("is a fixed list that leaves a changed, corrected or untraceable row alone", () => {
    const [first, ...rest] = liveRows;
    expect(planHandAmountCorrections([{ ...first, amount: "29.95" }, ...rest]).skipped).toEqual([{ feePublishedId: 49175, reason: "already corrected" }]);
    expect(planHandAmountCorrections([{ ...first, amount: "30.00" }, ...rest]).skipped).toEqual([{ feePublishedId: 49175, reason: "changed since labelling" }]);
    expect(planHandAmountCorrections([{ ...first, normalized_text: "Loan Skip A Pay Fee | $29" }, ...rest]).skipped[0].reason).toMatch(/does not trace|still traces/);
    expect(planHandAmountCorrections(rest).skipped).toEqual([{ feePublishedId: 49175, reason: "not live" }]);
    // A fee that is not on the list is never touched.
    expect(planHandAmountCorrections([{ ...first, fee_published_id: 1 }]).corrected).toEqual([]);
  });

  it("rejects the unpublished copies (four cut-cents, three #1360 plans) only while each reads as labelled", () => {
    const rows = HAND_REJECTED_TWINS.map((twin) => ({
      fee_verified_id: twin.feeVerifiedId, canonical_fee_key: twin.canonicalFeeKey, fee_name: twin.feeName,
      amount: twin.amount.toFixed(2), review_status: "verified", source_document_id: twin.sourceDocumentId, live_published: false,
    }));
    expect(planTwinRejections(rows).rejectedTwins).toEqual([113133, 112658, 157467, 125738, 66392, 167844, 102462]);
    expect(planTwinRejections([{ ...rows[0], live_published: true }, ...rows.slice(1)]).skippedTwins).toEqual([{ feeVerifiedId: 113133, reason: "published" }]);
    expect(planTwinRejections([{ ...rows[0], amount: "29.95" }, ...rows.slice(1)]).skippedTwins).toEqual([{ feeVerifiedId: 113133, reason: "changed since labelling" }]);
  });

  it("writes the published and verified rows, the rollback evidence and one run event", async () => {
    const twins = HAND_REJECTED_TWINS.map((twin) => ({
      fee_verified_id: twin.feeVerifiedId, canonical_fee_key: twin.canonicalFeeKey, fee_name: twin.feeName,
      amount: twin.amount.toFixed(2), review_status: "verified", source_document_id: twin.sourceDocumentId, live_published: false,
    }));
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      calls.push({ text, values });
      if (text.includes("FROM published_fee_records fp")) return Promise.resolve(liveRows);
      if (text.includes("FROM verified_fee_observations fv")) return Promise.resolve(twins);
      if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: values[2] }]);
      if (text.includes("SET review_status = 'rejected'")) return Promise.resolve((values[2] as number[]).map((id) => ({ fee_verified_id: id })));
      return Promise.resolve([]);
    });
    const result = await applyHandAmountCorrections(db as never, { runId: 7, dryRun: false });
    expect(result.corrected).toHaveLength(8);
    expect(result.rejectedTwins).toEqual([113133, 112658, 157467, 125738, 66392, 167844, 102462]);
    const verifiedUpdates = calls.filter((call) => call.text.includes("UPDATE verified_fee_observations") && call.text.includes("SET amount"));
    expect(verifiedUpdates).toHaveLength(8);
    // Each update lands only while the row still holds the cut amount.
    expect(calls.filter((call) => call.text.includes("UPDATE published_fee_records")).every((call) => call.text.includes("AND amount ="))).toBe(true);
    const feedback = calls.find((call) => call.text.includes("INSERT INTO pipeline_feedback"));
    const written = JSON.parse(String(feedback?.values[0])) as Array<{ dedupe_key: string; evidence: Record<string, unknown> }>;
    expect(written.find((row) => row.dedupe_key === `${HAND_AMOUNT_CHECK}:pub:49175`)?.evidence).toMatchObject({ old_amount: 29, new_amount: 29.95, old_name: "00 Loan Skip A Pay Fee" });
    expect(written.filter((row) => row.dedupe_key.startsWith(`${HAND_AMOUNT_CHECK}:twin:`))).toHaveLength(7);
    // Each copy carries its own pattern: one UPDATE per flag.
    const flags = calls.filter((call) => call.text.includes("SET review_status = 'rejected'")).map((call) => call.values[0]);
    expect(flags).toEqual(["hand_rejected:cut_cents_twin", "hand_rejected:optional_overdraft_plan_twin"]);
    expect(written.find((row) => row.dedupe_key === `${HAND_AMOUNT_CHECK}:twin:66392`)?.evidence).toMatchObject({ issue: 1360, flag: "hand_rejected:optional_overdraft_plan_twin" });
    expect(calls.filter((call) => call.text.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
  });

  it("a dry run plans the same and writes nothing", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("FROM published_fee_records fp")) return Promise.resolve(liveRows);
      return Promise.resolve([]);
    });
    const result = await applyHandAmountCorrections(db as never, { runId: 7, dryRun: true });
    expect(result.corrected).toHaveLength(8);
    expect(db.mock.calls.some(([strings]) => /UPDATE|INSERT/.test((strings as TemplateStringsArray).join(" ")))).toBe(false);
  });
});
