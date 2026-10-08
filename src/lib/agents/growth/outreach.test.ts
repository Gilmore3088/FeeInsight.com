import { describe, expect, it } from "vitest";

import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import { buildSnapshotFee, marketLabel, type MarketSnapshot, type SnapshotFeeRow } from "./market-snapshot";
import { buildFollowUpDraft, buildOutreachDraft, firstName, summarizeOutreach, type OutreachContact } from "./outreach";

function odRow(institutionId: number, amount: number, text: string | null = `Overdraft Fee $${amount.toFixed(2)} per item`): SnapshotFeeRow {
  return {
    institution_id: institutionId,
    fee_category: "overdraft",
    fee_name: "Overdraft Fee",
    amount,
    canonical_fee_key: "overdraft",
    conditions: null,
    account_product_type: null,
    waiver_text: null,
    document_url: `https://bank${institutionId}.example/fees.pdf`,
    read_at: "2026-10-01T00:00:00.000Z",
    normalized_text: text,
  };
}

const PEER_AMOUNTS = [25, 28, 30, 32, 35];
const rows = [odRow(1, 30), ...PEER_AMOUNTS.map((amount, index) => odRow(10 + index, amount)), odRow(99, 40, "Checking accounts have no fee for this.")];

function snapshot(feeRows: SnapshotFeeRow[] = rows): MarketSnapshot {
  return {
    subject: { id: 1, name: "First Bank", city: "Waco", stateCode: "TX", cbsaCode: "47380", cbsaName: "Waco, TX", charterType: "bank" },
    peers: [...PEER_AMOUNTS.map((_, index) => 10 + index), 99].map((id) => ({
      id,
      name: `Peer ${id}`,
      city: "Waco",
      stateCode: "TX",
      cbsaCode: "47380",
      cbsaName: "Waco, TX",
      charterType: "bank",
    })),
    fees: [buildSnapshotFee("overdraft", 1, feeRows)],
  };
}

const jane: OutreachContact = {
  email: "jsmith@firstbank.com",
  kind: "person",
  name: "Jane Q. Smith",
  title: "SVP, Director of Marketing",
  role: "marketing",
  source_url: "https://firstbank.com/leadership",
};
const info: OutreachContact = { email: "info@firstbank.com", kind: "general", name: null, title: null, role: "other", source_url: "https://firstbank.com/" };

describe("market snapshot", () => {
  it("keeps the pipeline's provenance out of a fee's notes", () => {
    const fee = buildSnapshotFee("overdraft", 1, [
      { ...odRow(1, 30), conditions: "Knox deterministic extraction from Rosetta artifact #11638. canonical_hint=overdraft; text_hash=e8a1" },
      { ...odRow(10, 25), conditions: "After the first two per month" },
    ]);
    expect(fee.subject?.notes).toEqual([]);
    expect(fee.peers[0].notes).toEqual(["Conditions: After the first two per month"]);
  });

  it("counts only peers whose amount traces to their own schedule", () => {
    const fee = buildSnapshotFee("overdraft", 1, rows);
    expect(fee.subject).toMatchObject({ value: 30, verified: true });
    expect(fee.subject?.sourceLine).toContain("$30.00");
    expect(fee.peers).toHaveLength(6);
    expect(fee.verifiedPeerCount).toBe(5);
    expect(fee.verifiedMedian).toBe(30);
    expect(fee.peers.find((peer) => peer.institutionId === 99)).toMatchObject({ verified: false, sourceLine: null });
  });

  it("gives no median below the site's minimum of verified institutions", () => {
    const fee = buildSnapshotFee("overdraft", 1, rows.slice(0, 4));
    expect(fee.verifiedMedian).toBeNull();
  });

  it("shortens the market name for the subject line", () => {
    expect(marketLabel({ cbsaName: "New York-Newark-Jersey City, NY-NJ-PA", city: null, stateCode: null })).toBe("New York-Newark");
    expect(marketLabel({ cbsaName: "St. Louis, MO-IL", city: null, stateCode: null })).toBe("St. Louis, MO");
    expect(marketLabel({ cbsaName: null, city: "Waco", stateCode: "TX" })).toBe("Waco, TX");
  });
});

describe("buildOutreachDraft", () => {
  it("writes James's template with verified figures, then the audit block", () => {
    const built = buildOutreachDraft(snapshot(), [info, jane]);
    if (!("draft" in built)) throw new Error(`skipped: ${built.skip}`);
    const { draft } = built;
    expect(draft.primary.email).toBe("jsmith@firstbank.com");
    expect(draft.primary.confidence).toBe("high");
    expect(draft.caption).toContain("Subject: How your overdraft fee compares in Waco, TX");
    expect(draft.caption).toContain("Hi Jane,");
    expect(draft.caption).toContain(
      "noticed that First Bank's overdraft fee is $30, compared with a median of $30 among 5 verified local competitors.",
    );
    expect(draft.caption).toContain("https://feeinsight.com/institution/1/market?utm_source=email&utm_medium=outreach&utm_campaign=outreach-launch&utm_content=inst-1");
    expect(draft.caption).toContain("does your team handle competitive fee reviews internally, or do you use an outside research provider?");
    const [email, audit] = draft.caption.split("--- For your audit");
    expect(email).not.toContain("Peer 99");
    // CAN-SPAM: a postal address James fills in, and a way to opt out.
    expect(email).toContain("Fee Insight LLC · [postal address: James to add before sending]");
    expect(email).toContain("reply \"no thanks\" and I won't follow up.");
    expect(audit).toContain("Left out as unverified");
    expect(audit).toContain("- Peer 99: $40");
    expect(audit).toContain('Schedule line: "Overdraft Fee $30.00 per item"');
  });

  it("waits when the prospect's own fee doesn't verify", () => {
    const unverified = [odRow(1, 30, "No overdraft wording here"), ...rows.slice(1)];
    expect(buildOutreachDraft(snapshot(unverified), [jane])).toEqual({ skip: "own_fee_unverified" });
  });

  it("needs a named contact, never a shared mailbox alone", () => {
    expect(buildOutreachDraft(snapshot(), [info])).toEqual({ skip: "no_contact" });
  });

  it("needs enough verified competitors for a median", () => {
    expect(buildOutreachDraft(snapshot(rows.slice(0, 4)), [jane])).toEqual({ skip: "too_few_verified_peers" });
  });

  it("greets by first name only when the page printed one", () => {
    expect(firstName("Dr. Robert Lee")).toBe("Robert");
    expect(firstName(null)).toBeNull();
  });
});

describe("the outreach step", () => {
  it("is a free marketing step that only drafts", () => {
    expect(isMarketingStep("growth-outreach")).toBe(true);
    expect(isProviderStep("growth-outreach")).toBe(false);
    expect(
      summarizeOutreach({ schemaReady: true, dryRun: false, considered: 9, drafted: 2, draftIds: [4, 5], skipped: { own_fee_unverified: 3 }, reason: null }),
    ).toBe("Drafted 2 first emails for James to audit and send himself (9 prospects read). Passed over: 3 own overdraft fee didn't verify.");
  });
});

describe("day-7 follow-up", () => {
  it("is short, carries the same link and no new figures, and keeps the CAN-SPAM lines", () => {
    const draft = buildFollowUpDraft({
      draftId: 41,
      institutionId: 1,
      institutionName: "First Bank",
      market: "Waco, TX",
      link: "https://feeinsight.com/institution/1/market?utm_source=email",
      to: { email: "jsmith@firstbank.com", name: "Jane Q. Smith", title: "SVP Marketing" },
    });
    expect(draft.subject).toBe("Re: How your overdraft fee compares in Waco, TX");
    const [email, audit] = draft.caption.split("--- For your audit");
    expect(email).toContain("Hi Jane,");
    expect(email).toContain("https://feeinsight.com/institution/1/market?utm_source=email");
    expect(email).not.toMatch(/\$\d/);
    expect(email).toContain("[postal address: James to add before sending]");
    expect(audit).toContain("queue item 41");
  });
});
