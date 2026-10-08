import { describe, expect, it } from "vitest";

import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import { buildSnapshotFee, marketLabel, type MarketSnapshot, type SnapshotFeeRow } from "./market-snapshot";
import { buildFollowUpDraft, buildOutreachDraft, checkOutreachDestination, firstName, isDecisionMaker, loadOutreachCandidates, summarizeOutreach, withdrawNonBuyerDrafts, type OutreachContact } from "./outreach";

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

  it("quotes the row's own line, not a neighbouring one with the same price", () => {
    const text = "Insufficient Funds Fee (item $10.01 or greater) $25\nOverdraft Fee (item $10.01 or greater) $25";
    const row = { ...odRow(1, 25, text), fee_name: "Overdraft Fee (item or greater)", conditions: `Knox deterministic extraction from Rosetta artifact #6107. canonical_hint=overdraft; excerpt="Overdraft Fee (item $10.01 or greater) $25"` };
    const fee = buildSnapshotFee("overdraft", 1, [row]);
    expect(fee.subject).toMatchObject({ value: 25, verified: true, feeName: "Overdraft Fee (item or greater)", sourceLine: "Overdraft Fee (item $10.01 or greater) $25" });
    expect(fee.subject?.notes).toEqual([]);
  });

  it("compares the consumer tier when a business tier is also printed", () => {
    const text = "Paid nonsufficient funds (NSF)*\nConsumer account | $25.00\nBusiness account | $35.00";
    const consumer = { ...odRow(1, 25, text), fee_name: "Paid nonsufficient funds (NSF)*: Consumer account", conditions: `excerpt="Consumer account | $25.00"` };
    const business = { ...odRow(1, 35, text), fee_name: "Paid nonsufficient funds (NSF)*: Business account", conditions: `excerpt="Business account | $35.00"` };
    expect(buildSnapshotFee("overdraft", 1, [consumer, business]).subject).toMatchObject({ value: 25, sourceLine: "Consumer account | $25.00" });
    expect(buildSnapshotFee("overdraft", 1, [business]).subject).toMatchObject({ value: 35 });
    const perDay = { ...odRow(1, 30, "Overdraft Fee $30 per item, up to 4 per business day"), conditions: `excerpt="Overdraft Fee $30 per item, up to 4 per business day"` };
    const extended = { ...odRow(1, 20, "Extended Overdraft Fee $20"), fee_name: "Extended Overdraft Fee", conditions: `excerpt="Extended Overdraft Fee $20"` };
    expect(buildSnapshotFee("overdraft", 1, [perDay, extended]).subject).toMatchObject({ value: 30 });
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

function feeRow(category: string, label: string, institutionId: number, amount: number, text: string | null = `${label} $${amount.toFixed(2)}`): SnapshotFeeRow {
  return { ...odRow(institutionId, amount, text), fee_category: category, fee_name: label, canonical_fee_key: category, fee_published_id: institutionId * 100 + label.length };
}

/** Overdraft, stop payment and cashier's check, each with the subject and five verified peers. */
function multiSnapshot(categories: [string, string, number[]][] = [
  ["overdraft", "Overdraft Fee", [30, 25, 28, 30, 32, 35]],
  ["stop_payment", "Stop Payment", [30, 20, 25, 30, 32, 35]],
  ["cashiers_check", "Cashier's Check", [8, 5, 6, 8, 10, 10]],
]): MarketSnapshot {
  const base = snapshot();
  const ids = [1, 10, 11, 12, 13, 14];
  const feeRows = categories.flatMap(([category, label, amounts]) => amounts.map((amount, index) => feeRow(category, label, ids[index], amount)));
  feeRows.push(feeRow("overdraft", "Overdraft Fee", 99, 40, "Checking accounts have no fee for this."));
  return { ...base, fees: categories.map(([category]) => buildSnapshotFee(category, 1, feeRows)) };
}

describe("buildOutreachDraft", () => {
  it("reports several verified fees with named local competitors, then the audit block", () => {
    const built = buildOutreachDraft(multiSnapshot(), [info, jane]);
    if (!("draft" in built)) throw new Error(`skipped: ${built.skip}`);
    const { draft } = built;
    expect(draft.primary.email).toBe("jsmith@firstbank.com");
    expect(draft.primary.confidence).toBe("high");
    expect(draft.findings.map((finding) => finding.category)).toEqual(["overdraft", "cashiers_check", "stop_payment"]);
    expect(draft.caption).toContain("Subject: First Bank's published fees beside 5 Waco, TX institutions");
    expect(draft.caption).toContain("Hi Jane,");
    expect(draft.caption).toContain("3 of First Bank's fees can each be compared with at least 5 local institutions' own published figures.");
    expect(draft.caption).toContain("- Overdraft (OD): First Bank $30. 5 local schedules range from $25 (Peer 10) to $35 (Peer 14), median $30.");
    expect(draft.caption).toContain("https://feeinsight.com/institution/1/market?utm_source=email&utm_medium=outreach&utm_campaign=outreach-launch&utm_content=inst-1");
    const [email, audit] = draft.caption.split("--- For your audit");
    expect(email).toContain("not a recommendation on pricing");
    expect(email).not.toMatch(/\b(?:should|consider|lower your|raise)\b/i);
    expect(email).not.toContain("Peer 99");
    // CAN-SPAM: a postal address James fills in, and a way to opt out.
    expect(email).toContain("Fee Insight LLC · [postal address: James to add before sending]");
    expect(email).toContain("reply \"no thanks\" and I won't follow up.");
    expect(audit).toContain("Left out as unverified: Peer 99 $40");
    expect(audit).toContain('Schedule line: "Overdraft Fee $30.00"');
  });

  it("needs at least three qualifying fees, so a lone overdraft comparison gets no draft", () => {
    expect(buildOutreachDraft(snapshot(), [jane])).toEqual({ skip: "too_few_findings" });
    const twoGood = multiSnapshot().fees.map((fee) => (fee.category === "stop_payment" ? { ...fee, verifiedMedian: null, verifiedPeerCount: 4 } : fee));
    expect(buildOutreachDraft({ ...multiSnapshot(), fees: twoGood }, [jane])).toEqual({ skip: "too_few_findings" });
  });

  it("needs a named contact, never a shared mailbox alone", () => {
    expect(buildOutreachDraft(multiSnapshot(), [info])).toEqual({ skip: "no_contact" });
  });

  it("never uses a price for non-customers", () => {
    const fee = buildSnapshotFee("cashiers_check", 1, [feeRow("cashiers_check", "Cashier's Check - Non-Customer", 1, 15), feeRow("cashiers_check", "Cashier's Check", 10, 8)]);
    expect(fee.subject).toBeNull();
    expect(fee.peers.map((peer) => peer.value)).toEqual([8]);
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
      summarizeOutreach({ schemaReady: true, dryRun: false, considered: 9, drafted: 2, draftIds: [4, 5], skipped: { too_few_findings: 3, destination_not_live: 4 }, reason: null }),
    ).toBe("Drafted 2 first emails for James to audit and send himself (9 prospects read). Passed over: 3 fewer than 3 fees with 5 verified local competitors, 4 snapshot page not live or not showing the quoted figures.");
  });

  it("drafts only when the link opens a page showing every name and amount the email quotes", async () => {
    const page = (status: number, body: string) => () => Promise.resolve({ ok: status === 200, text: () => Promise.resolve(body) });
    const expected = { names: ["Fee Insight's Bank & Trust", "Peer 10"], amounts: [30, 2.5] };
    const html = "<h1>Fee Insight&#x27;s Bank &amp; Trust</h1><td>Peer 10</td><td>$30.00</td><td>$2.50</td>";
    expect(await checkOutreachDestination("https://x", expected, page(200, html))).toBe(true);
    expect(await checkOutreachDestination("https://x", expected, page(404, html))).toBe(false);
    expect(await checkOutreachDestination("https://x", { ...expected, amounts: [3] }, page(200, html.replace("$30.00", "$300")))).toBe(false);
    expect(await checkOutreachDestination("https://x", expected, () => Promise.reject(new Error("offline")))).toBe(false);
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

describe("withdrawing unreviewed drafts", () => {
  it("takes back non-buyers, older single-fee drafts and drafts quoting a fee no longer live", async () => {
    const updates: unknown[][] = [];
    const ceo = { email: "kday@x.bank", name: "Kevin Day", title: "CEO/President", role: "executive" };
    const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      if (query.includes("SELECT id, facts")) {
        return Promise.resolve([
          { id: 7, facts: { to: { email: "eroche@x.com", name: null, title: "Senior Mortgage Loan Officer", role: "other" }, quote_rule: 3 } },
          { id: 16, facts: JSON.stringify({ to: ceo, quote_rule: 2 }) },
          { id: 40, facts: { to: ceo, quote_rule: 3, published_ids: [501, 502] } },
          { id: 41, facts: { to: ceo, quote_rule: 3, published_ids: [601] } },
        ]);
      }
      if (query.includes("takedown_pending")) {
        const ids = values[0] as number[];
        return Promise.resolve([{ n: ids.includes(502) ? 1 : 0 }]);
      }
      updates.push(values);
      return Promise.resolve([]);
    }) as never;
    expect(await withdrawNonBuyerDrafts(db)).toBe(3);
    expect(updates.map((values) => values.at(-1))).toEqual([7, 16, 40]);
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
