import { describe, expect, it } from "vitest";

import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import { buildSnapshotFee, marketLabel, type MarketSnapshot, type SnapshotFeeRow } from "./market-snapshot";
import { OUTREACH_HELD_REASON, OUTREACH_STALE_WORDING_REASON, institutionKinds, outreachCampaignsFromEnv, runOutreachDrafts, buildFollowUpDraft, buildOutreachDraft, checkOutreachDestination, runOutreachFollowUps, firstName, isDecisionMaker, loadOutreachCandidates, summarizeOutreach, withdrawNonBuyerDrafts, type OutreachContact } from "./outreach";

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
  it("writes campaign C only when allowed: one tier-A fact, named competitors, a link, and the evidence", () => {
    const built = buildOutreachDraft(multiSnapshot(), [info, jane], { allowInsight: true });
    if (!("draft" in built)) throw new Error(`skipped: ${built.skip}`);
    const { draft } = built;
    expect(draft.campaign).toBe("market_insight");
    expect(draft.primary.email).toBe("jsmith@firstbank.com");
    expect(draft.findings.map((finding) => finding.category)).toEqual(["overdraft", "cashiers_check", "stop_payment"]);
    expect(draft.caption).toContain("Subject: Waco, TX fee schedules, side by side");
    expect(draft.caption).toContain("Hi Jane,");
    expect(draft.caption).toContain("In the Waco, TX schedules we hold, overdraft (OD) fees run from $25 at Peer 10 to $35 at Peer 14. First Bank's published figure is $30.");
    expect(draft.caption).toContain("https://feeinsight.com/institution/1/market?utm_source=email&utm_medium=outreach&utm_campaign=outreach-launch&utm_content=inst-1");
    const [email, audit] = draft.caption.split("--- For your audit");
    expect(email).toContain("James\nFounder, Fee Insight");
    expect(email).not.toMatch(/\b(?:median|should|consider|lower|higher|raise)\b/i);
    expect(email).not.toContain("Peer 99");
    // CAN-SPAM: a postal address James fills in, and a way to opt out.
    expect(email).toContain("Fee Insight LLC · [postal address: James to add before sending]");
    expect(email).toContain("reply \"no thanks\" and I won't follow up.");
    expect(audit).toContain("Campaign C");
    expect(audit).toContain("Left out as unverified: Peer 99 $40");
    expect(audit).toContain('Schedule line: "Overdraft Fee $30.00"');
  });

  it("writes campaign B without figures or a link when the page can't be used", () => {
    const built = buildOutreachDraft(multiSnapshot(), [jane]);
    if (!("draft" in built)) throw new Error(`skipped: ${built.skip}`);
    const { draft } = built;
    expect(draft.campaign).toBe("personalized_research");
    expect(draft.link).toBeNull();
    const [email, audit] = draft.caption.split("--- For your audit");
    expect(email).toContain("Subject: Competitive fee research for First Bank");
    expect(email).toContain("First Bank's schedule is in our research, along with those of 5 other institutions in the Waco, TX area, including Peer 10 and Peer 11. Between them, 3 fee types can be compared line by line.");
    expect(email).not.toMatch(/\$\d|https?:/);
    expect(audit).toContain("Campaign B");
    expect(email).toContain("be useful for your product reviews?");
  });

  it("never quotes a comparison with a row waiting on a takedown second look", () => {
    const pending = new Set([10 * 100 + "Overdraft Fee".length]);
    const built = buildOutreachDraft(multiSnapshot(), [jane], { allowInsight: true, pendingTakedown: pending });
    if (!("draft" in built)) throw new Error(`skipped: ${built.skip}`);
    expect(built.draft.score.tiers.overdraft).toBe("D");
    expect(built.draft.findings.map((finding) => finding.category)).not.toContain("overdraft");
  });

  it("writes campaign A, the research-efficiency question, when the data is thin", () => {
    const built = buildOutreachDraft(snapshot(), [jane], { allowInsight: true });
    if (!("draft" in built)) throw new Error(`skipped: ${built.skip}`);
    expect(built.draft.campaign).toBe("research_efficiency");
    const [email] = built.draft.caption.split("--- For your audit");
    expect(email).toContain("Subject: Quick question about competitor fee research");
    expect(email).toContain("Reviewing a checking product against what competitors publish usually means finding, reading and lining up dozens of published fee schedules by hand.");
    expect(built.draft.caption).toContain("Only tier A figures may be quoted.");
    expect(email).toContain("do you compile that research yourselves, or do you already have a tool or consultant for it?");
    expect(email).not.toMatch(/\$\d|https?:|Peer/);
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
      summarizeOutreach({ schemaReady: true, dryRun: false, considered: 9, drafted: 2, draftIds: [4, 5], skipped: { no_contact: 3 }, campaigns: { research_efficiency: 1, personalized_research: 1 }, insightPageNotLive: 1, reason: null }),
    ).toBe("Drafted 2 first emails for James to audit and send himself (9 prospects read); by campaign: A 1, B 1. Passed over: 3 no decision-maker contact. 1 could have had campaign C but the snapshot page didn't show their figures, so they got B.");
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
          { id: 7, facts: { to: { email: "eroche@x.com", name: null, title: "Senior Mortgage Loan Officer", role: "other" }, quote_rule: 4 } },
          { id: 16, facts: JSON.stringify({ to: ceo, quote_rule: 2 }) },
          { id: 40, facts: { to: ceo, quote_rule: 4, published_ids: [501, 502] } },
          { id: 41, facts: { to: ceo, quote_rule: 4, published_ids: [601] } },
          { id: 42, facts: { to: { email: "ceo@x.org", name: "Mailing Address", title: "CEO For questions or concerns not resolved by staff", role: "executive" }, quote_rule: 4 } },
          // Campaigns A-C written before credit unions got member wording.
          { id: 43, facts: { to: ceo, quote_rule: 3 } },
        ]);
      }
      if (query.includes("takedown_pending")) {
        const ids = values[0] as number[];
        return Promise.resolve([{ n: ids.includes(502) ? 1 : 0 }]);
      }
      updates.push(values);
      return Promise.resolve([]);
    }) as never;
    expect(await withdrawNonBuyerDrafts(db)).toBe(5);
    expect(updates.map((values) => values.at(-1))).toEqual([7, 16, 40, 42, 43]);
    expect(updates.at(-1)).toContain(OUTREACH_STALE_WORDING_REASON);
    updates.length = 0;
    expect(await withdrawNonBuyerDrafts(db, true)).toBe(5);
    expect(updates).toEqual([]);
  });
});

describe("follow-ups", () => {
  it("drafts the final follow-up only after the first follow-up was marked sent, and says it is the last", async () => {
    const queries: string[] = [];
    const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("information_schema") || query.includes("to_regclass")) return Promise.resolve([{ ready: true, exists: true, ok: true, n: 1 }]);
      if (query.includes("JOIN outreach_outcomes sent")) {
        const finalStage = values.includes("outreach-followup-final");
        return Promise.resolve(finalStage ? [{ id: 9, facts: { institution_id: 1, institution_name: "First Bank", market: "Waco, TX", subject: "Quick question about competitor fee research", to: { email: "j@x.com", name: "Jane Smith" } } }] : []);
      }
      return Promise.resolve([{ id: 77 }]);
    }) as never;
    const result = await runOutreachFollowUps({ db, runId: 1, dryRun: true });
    expect(result.due).toBe(1);
    const finalQuery = queries.filter((query) => query.includes("JOIN outreach_outcomes sent")).at(-1)!;
    expect(finalQuery).toContain("JOIN outreach_outcomes fs ON fs.draft_id = f.id AND fs.outcome = 'sent'");
    const final = buildFollowUpDraft({ draftId: 9, institutionId: 1, institutionName: "First Bank", market: "Waco, TX", link: "", subject: "Quick question about competitor fee research", to: null }, 2);
    expect(final.subject).toBe("Re: Quick question about competitor fee research");
    expect(final.caption).toContain("One last note, and then I'll stop.");
    expect(final.caption).toContain("This is the last email to this institution");
    expect(final.caption).not.toMatch(/\$\d|https?:/);
  });

  it("is short, threads under the first subject, carries no figures or link, and keeps the CAN-SPAM lines", () => {
    const source = {
      draftId: 41,
      institutionId: 1,
      institutionName: "First Bank",
      market: "Waco, TX",
      link: "https://feeinsight.com/institution/1/market?utm_source=email",
      to: { email: "jsmith@firstbank.com", name: "Jane Q. Smith", title: "SVP Marketing" },
    };
    const draft = buildFollowUpDraft(source);
    expect(draft.subject).toBe("Re: How your overdraft fee compares in Waco, TX");
    const [email, audit] = draft.caption.split("--- For your audit");
    expect(email).toContain("Hi Jane,");
    expect(email).not.toContain("https://");
    expect(email).toContain("a short, source-linked example comparing First Bank with a few Waco, TX institutions");
    expect(buildFollowUpDraft({ ...source, subject: "Quick question about competitor fee research" }).subject).toBe("Re: Quick question about competitor fee research");
    expect(email).not.toMatch(/\$\d/);
    expect(email).toContain("[postal address: James to add before sending]");
    expect(audit).toContain("queue item 41");
  });
});

describe("pilot campaign gate", () => {
  it("reads James's chosen campaigns from letters", () => {
    expect(outreachCampaignsFromEnv("A,B")).toEqual(["research_efficiency", "personalized_research"]);
    expect(outreachCampaignsFromEnv(" c ")).toEqual(["market_insight"]);
    expect(outreachCampaignsFromEnv(undefined)).toEqual([]);
  });

  it("drafts nothing in a real run until a campaign is chosen, but still withdraws", async () => {
    const queries: string[] = [];
    const db = ((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("information_schema") || query.includes("to_regclass")) return Promise.resolve([{ ready: true, exists: true, ok: true, n: 1 }]);
      return Promise.resolve([]);
    }) as never;
    const result = await runOutreachDrafts({ db, runId: 1, campaigns: [] });
    expect(result.reason).toBe(OUTREACH_HELD_REASON);
    expect(result.drafted).toBe(0);
    expect(queries.some((query) => query.includes("SELECT id, facts FROM content_drafts"))).toBe(true);
    expect(queries.some((query) => query.includes("prospect_contacts c") || query.includes("FROM prospect_contacts"))).toBe(false);
    expect(summarizeOutreach(result)).toContain("No first emails drafted: held");
  });
});

/** The same market with a credit union as the prospect and a mix of credit unions and banks around it. */
function creditUnionSnapshot(base: MarketSnapshot = multiSnapshot()): MarketSnapshot {
  return {
    ...base,
    subject: { ...base.subject, name: "First Community Credit Union", charterType: "credit_union" },
    peers: base.peers.map((peer) => (peer.id % 2 === 0 ? { ...peer, name: `Peer CU ${peer.id}`, charterType: "credit_union" } : peer)),
  };
}

const cuMarketing: OutreachContact = { ...jane, email: "jsmith@firstcommunitycu.org", source_url: "https://firstcommunitycu.org/leadership" };

function emailOf(built: ReturnType<typeof buildOutreachDraft>) {
  if (!("draft" in built)) throw new Error(`skipped: ${built.skip}`);
  const [email, audit] = built.draft.caption.split("--- For your audit");
  return { draft: built.draft, email, audit };
}

/** Rules every first email keeps, bank or credit union (James, 22:23 UTC Oct 8). */
function expectHouseRules(email: string) {
  expect(email).not.toMatch(/\b(?:median|average|(?:above|below) (?:the |your )?(?:median|average|market|peers)|should|consider|lower|higher|raise|cut|reduce|recommend)\b/i);
  expect(email).toContain("Best,\nJames\nFounder, Fee Insight");
  expect(email).toContain("Fee Insight LLC · [postal address: James to add before sending]");
  expect(email).toContain("reply \"no thanks\" and I won't follow up.");
  // One ask: the body asks one question (a link's query string is not one).
  const body = email.split("Best,")[0];
  expect(body.match(/\?(?=\s|$)/g)).toHaveLength(1);
}

describe("credit union wording", () => {
  it("names a local set only by the charters it holds", () => {
    expect(institutionKinds(["credit_union", "bank"])).toBe("credit unions and banks");
    expect(institutionKinds(["credit_union", "credit_union"])).toBe("credit unions");
    expect(institutionKinds(["bank"])).toBe("bank");
    expect(institutionKinds([null, undefined])).toBe("institutions");
  });

  it("campaign A: members and the board or ALCO for a credit union; the bank email is unchanged", () => {
    const cu = emailOf(buildOutreachDraft(creditUnionSnapshot(snapshot()), [cuMarketing], { allowInsight: true }));
    expect(cu.draft.campaign).toBe("research_efficiency");
    expect(cu.email).toContain("Subject: Quick question about competitor fee research");
    expect(cu.email).toContain("Reviewing a member checking product against what other credit unions and banks publish usually means finding, reading and lining up dozens of published fee schedules by hand.");
    expect(cu.email).toContain("so a comparison that goes to the board or ALCO can be traced line by line.");
    expect(cu.email).toContain("When your team compares First Community Credit Union's member fees with other credit unions and banks, do you compile that research yourselves");
    expect(cu.email).not.toMatch(/customer|\$\d|https?:|Peer/i);
    expect(cu.audit).toContain("Credit union: member wording");
    expectHouseRules(cu.email);

    const bank = emailOf(buildOutreachDraft(snapshot(), [jane], { allowInsight: true }));
    expect(bank.draft.campaign).toBe("research_efficiency");
    expect(bank.email).toContain("Fee Insight brings published bank and credit union fee schedules together in one place, with every figure linked to the schedule it came from.\n");
    expect(bank.email).not.toMatch(/member|ALCO|board/i);
    expect(bank.audit).not.toContain("Credit union");
    expectHouseRules(bank.email);
  });

  it("campaign B: names the verified local credit unions and banks, still no figures or link", () => {
    const cu = emailOf(buildOutreachDraft(creditUnionSnapshot(), [cuMarketing]));
    expect(cu.draft.campaign).toBe("personalized_research");
    expect(cu.draft.link).toBeNull();
    expect(cu.email).toContain("First Community Credit Union's schedule is in our research, along with those of 5 other credit unions and banks in the Waco, TX area, including Peer CU 10 and Peer 11. Between them, 3 fee types can be compared line by line.");
    expect(cu.email).toContain("Would a short, source-linked comparison of First Community Credit Union's member fees and those of a few local credit unions and banks you choose be useful for your product reviews?");
    expect(cu.email).not.toMatch(/customer|\$\d|https?:/i);
    expectHouseRules(cu.email);

    // When the best-covered peers are both banks, a credit union's email still names one credit union.
    const base = multiSnapshot();
    const oneCu = emailOf(buildOutreachDraft({ ...creditUnionSnapshot(base), peers: base.peers.map((peer) => (peer.id === 13 ? { ...peer, name: "Peer CU 13", charterType: "credit_union" } : peer)) }, [cuMarketing]));
    expect(oneCu.email).toContain("including Peer 10 and Peer CU 13.");

    const bank = emailOf(buildOutreachDraft(multiSnapshot(), [jane]));
    expect(bank.draft.campaign).toBe("personalized_research");
    expect(bank.email).toContain("along with those of 5 other institutions in the Waco, TX area");
    expect(bank.email).not.toMatch(/member|ALCO/i);
    expectHouseRules(bank.email);
  });

  it("campaign C: one finding as a range across the verified local set, the member figure, and the checked link", () => {
    const cu = emailOf(buildOutreachDraft(creditUnionSnapshot(), [cuMarketing], { allowInsight: true }));
    expect(cu.draft.campaign).toBe("market_insight");
    expect(cu.email).toContain("In the Waco, TX schedules we hold, overdraft (OD) fees at 5 local credit unions and banks run from $25 at Peer CU 10 to $35 at Peer CU 14. The figure First Community Credit Union publishes for members is $30.");
    expect(cu.email).toContain("https://feeinsight.com/institution/1/market?utm_source=email&utm_medium=outreach&utm_campaign=outreach-launch&utm_content=inst-1");
    expect(cu.email).toContain("Is competitive fee research something your team prepares regularly, for example for ALCO or the board?");
    expect(cu.email).not.toMatch(/customer/i);
    expect(cu.email).not.toContain("Peer 99");
    expectHouseRules(cu.email);

    const bank = emailOf(buildOutreachDraft(multiSnapshot(), [jane], { allowInsight: true }));
    expect(bank.draft.campaign).toBe("market_insight");
    expect(bank.email).toContain("First Bank's published figure is $30.");
    expect(bank.email).not.toMatch(/member|ALCO/i);
    expectHouseRules(bank.email);
  });

  it("frames a finance or compliance addressee at a credit union for ALCO, the board or the supervisory committee", () => {
    const cfo: OutreachContact = { ...cuMarketing, email: "cfo@firstcommunitycu.org", title: "Chief Financial Officer", role: "finance" };
    const auditor: OutreachContact = { ...cuMarketing, email: "plee@firstcommunitycu.org", name: "Pat Lee", title: "Compliance Officer", role: "compliance" };
    expect(emailOf(buildOutreachDraft(creditUnionSnapshot(), [cfo])).email).toContain("be useful for your next ALCO or board review?");
    expect(emailOf(buildOutreachDraft(creditUnionSnapshot(snapshot()), [auditor])).email).toContain("internal analysis or supervisory committee reviews");
  });

  it("both follow-ups: member wording for a credit union, no figures or link, same sign-off", () => {
    const source = { draftId: 41, institutionId: 1, institutionName: "First Community Credit Union", market: "Waco, TX", link: "", subject: "Quick question about competitor fee research", to: { email: "jsmith@firstcommunitycu.org", name: "Jane Q. Smith", title: "SVP Marketing" }, charterType: "credit_union" };
    for (const stage of [1, 2] as const) {
      const cu = buildFollowUpDraft(source, stage);
      const bank = buildFollowUpDraft({ ...source, institutionName: "First Bank", charterType: "bank" }, stage);
      for (const draft of [cu, bank]) {
        const [email] = draft.caption.split("--- For your audit");
        expect(email).not.toMatch(/\$\d|https?:|customer|median|should/i);
        expect(email).toContain("James\nFounder, Fee Insight");
        expect(email).toContain("[postal address: James to add before sending]");
        expect(email.split("Best,")[0].match(/\?/g)?.length ?? 0).toBeLessThanOrEqual(1);
      }
      expect(cu.caption).toContain("ALCO or board");
      expect(bank.caption).not.toMatch(/ALCO|member/);
    }
    expect(buildFollowUpDraft(source, 1).caption).toContain("comparing First Community Credit Union's member fees with those of a few credit unions and banks in Waco, TX, laid out so it can go into an ALCO or board packet.");
    expect(buildFollowUpDraft(source, 2).caption).toContain("such as whoever prepares ALCO or board materials");
  });

  it("follow-ups read the charter from the institution when an older draft didn't store it", async () => {
    const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      if (query.includes("information_schema") || query.includes("to_regclass")) return Promise.resolve([{ ready: true, exists: true, ok: true, n: 1 }]);
      if (query.includes("JOIN outreach_outcomes sent")) {
        expect(query).toContain("charter_type");
        return Promise.resolve(!values.includes("outreach-followup-final") ? [{ id: 9, charter_type: "credit_union", facts: { institution_id: 1, institution_name: "First Community Credit Union", market: "Waco, TX", subject: "Quick question about competitor fee research", to: null } }] : []);
      }
      return Promise.resolve([{ id: 77 }]);
    }) as never;
    const inserted: unknown[][] = [];
    const recording = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join("?").includes("INSERT")) inserted.push(values);
      return (db as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(strings, ...values);
    }) as never;
    const result = await runOutreachFollowUps({ db: recording, runId: 1 });
    expect(result.drafted).toBe(1);
    expect(JSON.stringify(inserted)).toContain("ALCO or board packet");
  });
});
