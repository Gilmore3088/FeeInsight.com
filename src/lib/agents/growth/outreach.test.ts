import { describe, expect, it } from "vitest";

import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import { buildSnapshotFee, isOverdraftChargeLine, marketLabel, type MarketSnapshot, type SnapshotFeeRow, type StateComparison } from "./market-snapshot";
import { buildFollowUpDraft, buildOutreachDraft, firstName, isDecisionMaker, loadOutreachCandidates, summarizeOutreach, withdrawNonBuyerDrafts, type OutreachContact } from "./outreach";

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

  it("never takes a returned item, a charge-off or a transfer as the overdraft fee", () => {
    const chargeOff = { ...odRow(1, 50, "Overdraft Charge-off negative balance account $50.00 per charged off account"), fee_name: "Overdraft Charge-off" };
    const fee = buildSnapshotFee("overdraft", 1, [chargeOff, odRow(1, 30), ...rows.slice(1)]);
    expect(fee.subject).toMatchObject({ value: 30, verified: true });
    const onlyReturned = buildSnapshotFee("overdraft", 1, [{ ...odRow(1, 30, "5 Returned Unpaid NSF Items (consumer) | $30 per item"), fee_name: "Returned Unpaid NSF Items" }]);
    expect(onlyReturned.subject).toBeNull();
    for (const line of ["Insufficient Funds Fee (item $10.01 or greater) $25", "Business account | $35.00", "NSF Share Draft (Returned) | $25.00 per item", "Overdraft Protection Fee (per pre-authorized automatic transfer) $5.00"]) {
      expect(isOverdraftChargeLine(line)).toBe(false);
    }
    for (const line of ["Courtesy Pay | $30", "Paid Item | $29.00", "Overdraft Paid NSF item: Checking | $23.00 per item", "Overdraft (OD) or Non-sufficient Funds (NSF) item | $30.00 per item", "Debit Card Overdraft Protection (Opt-In)* | $10.00"]) {
      expect(isOverdraftChargeLine(line)).toBe(true);
    }
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

  it("compares with the state when the local market is too thin", () => {
    const stateRows = [odRow(1, 30), ...[20, 25, 25, 35, 35, 40].map((amount, index) => odRow(50 + index, amount)), odRow(70, 15, "No overdraft wording here")];
    const state: StateComparison = {
      stateCode: "TX",
      fee: buildSnapshotFee("overdraft", 1, stateRows),
      names: new Map([50, 51, 52, 53, 54, 55, 70].map((id) => [id, `State Peer ${id}`])),
    };
    const built = buildOutreachDraft(snapshot(rows.slice(0, 4)), [jane], state);
    if (!("draft" in built)) throw new Error(`skipped: ${built.skip}`);
    const { draft } = built;
    expect(draft.scope).toBe("state");
    expect(draft.median).toBe(30);
    expect(draft.verifiedPeers).toBe(6);
    expect(draft.caption).toContain("Subject: How your overdraft fee compares across Texas");
    expect(draft.caption).toContain(
      "reviewing published banking fees in Texas and noticed that First Bank's overdraft fee is $30, compared with a median of $30 among 6 verified banks and credit unions across Texas.",
    );
    const [, audit] = draft.caption.split("--- For your audit");
    expect(audit).toContain("Compared statewide: Waco, TX has 3 verified local competitors, fewer than the 5 a local median needs.");
    expect(audit).toContain("- State Peer 55: $40");
    expect(audit).toContain("- State Peer 70: $15");
  });

  it("keeps the local comparison when the local market has enough, and skips when the state is thin too", () => {
    const thinState: StateComparison = { stateCode: "TX", fee: buildSnapshotFee("overdraft", 1, rows.slice(0, 3)), names: new Map() };
    const built = buildOutreachDraft(snapshot(), [jane], thinState);
    expect("draft" in built && built.draft.scope).toBe("local");
    expect(buildOutreachDraft(snapshot(rows.slice(0, 4)), [jane], thinState)).toEqual({ skip: "too_few_verified_peers" });
  });

  it("never addresses a lender, a committee or a name with no title", () => {
    const lender: OutreachContact = { ...jane, email: "eroche@firstbank.com", name: null, title: "Senior Mortgage Loan Officer", role: "other" };
    const committee: OutreachContact = { ...jane, email: "supervisory@firstbank.com", name: "Ivan Shefrin", title: null, role: "other" };
    expect(isDecisionMaker(lender)).toBe(false);
    expect(isDecisionMaker(committee)).toBe(false);
    expect(buildOutreachDraft(snapshot(), [lender, committee])).toEqual({ skip: "no_contact" });
    const brand: OutreachContact = { ...jane, email: "mark.rieger@firstbank.com", name: null, title: "Chief Brand Officer", role: "marketing" };
    expect(isDecisionMaker(brand)).toBe(true);
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

describe("loadOutreachCandidates", () => {
  it("counts only institutions with a decision-maker toward the limit", async () => {
    const row = (institution_id: number, email: string, title: string | null, role: string) => ({ institution_id, asset_size: 900_000, email, kind: "person", name: null, title, role, source_url: "https://x" });
    const db = (() =>
      Promise.resolve([
        row(1, "a@big1.com", "Loan Officer", "other"),
        row(2, "b@big2.com", "Senior Mortgage Loan Officer", "other"),
        row(3, "c@small.com", "Chief Marketing Officer", "marketing"),
        row(4, "d@smaller.com", "President & CEO", "executive"),
      ])) as never;
    const candidates = await loadOutreachCandidates(db, 1);
    expect(candidates.map((candidate) => candidate.institutionId)).toEqual([3]);
  });
});

describe("withdrawing drafts made before the decision-maker rule", () => {
  it("skips unreviewed drafts whose addressee is not a buyer, and leaves buyers alone", async () => {
    const updates: unknown[][] = [];
    const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      if (query.includes("SELECT id, facts")) {
        return Promise.resolve([
          { id: 7, facts: { to: { email: "eroche@x.com", name: null, title: "Senior Mortgage Loan Officer", role: "other" } } },
          { id: 16, facts: JSON.stringify({ to: { email: "cpouliot@x.org", name: "Carlynne Pouliot", title: "VP of Retail & Business Development", role: "retail" } }) },
          { id: 13, facts: { to: { email: "supervisorycommittee@x.org", name: "Ivan Shefrin", title: null, role: "other" } } },
          { id: 37, facts: { to: { email: "kday@x.bank", name: "Kevin Day", title: "CEO/President", role: "executive" }, overdraft_line: "Overdraft Charge-off negative balance account $50.00 per charged off account" } },
          { id: 23, facts: { to: { email: "kday@x.bank", name: "Kevin Day", title: "CEO/President", role: "executive" }, overdraft_line: "Overdraft (each overdraft paid) $ 35.00" } },
        ]);
      }
      updates.push(values);
      return Promise.resolve([]);
    }) as never;
    expect(await withdrawNonBuyerDrafts(db)).toBe(3);
    expect(updates.map((values) => values.at(-1))).toEqual([7, 13, 37]);
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
