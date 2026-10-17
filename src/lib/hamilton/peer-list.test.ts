import { describe, expect, it } from "vitest";
import { formatPeerAssets, isPeerListContinuationQuestion, isPeerListQuestion, makePeerListContinuation, parsePeerListQuestion, peerListFeeFollowUp, peerListPageOffsets, peerListRefinementState, planPeerList, readPeerListOffset, validatePeerListContinuation, type PeerListSubject } from "./peer-list";
import type { ActivePeerSet } from "./active-peer-set";

export const subject: PeerListSubject = { institutionId: 101, name: "Synthetic Home CU", charterType: "credit_union", city: "Orlando", stateCode: "FL", totalAssetsUsd: 10_000_000_000, reportDate: "2026-06-30", source: "ncua", sourceUrl: null, recordId: 1 };
const intent = (question: string) => { const result = parsePeerListQuestion(question); if (!result) throw new Error("Not a list"); return result; };
const plan = (question: string, active: ActivePeerSet | null = null, target = subject) => planPeerList(intent(question), target, active);
const saved: ActivePeerSet = { status: "ready", institutionCount: 2, institutionId: 101, id: 7, name: "Chosen peers", label: "Chosen peers", filters: { institutionIds: [202, 203], charter_type: "credit_union", states: ["FL", "GA"] } };

describe("peer list question matrix", () => {
  for (const question of ["List ten peers", "Show 10 similarly sized credit unions in Florida", "List 15 banks between $1B and $5B in TX", "List institutions above $10B", "Who are our peers?", "List my saved peers", "Show peers in the same state", "List banks in Florida and Georgia", "List the 25 largest banks nationwide", "List all credit unions up to $1 billion"]) {
    it(`recognizes: ${question}`, () => { expect(isPeerListQuestion(question)).toBe(true); expect(intent(question).problems).toEqual([]); });
  }
  it("recognizes natural list phrasing including the reported typo and compact asset limit", () => {
    const q = "talki to me about institutions in florida over5b";
    expect(isPeerListQuestion(q)).toBe(true);
    const parsed = intent(q);
    expect(parsed.problems).toEqual([]);
    expect(parsed.states).toEqual(["FL"]);
    expect(parsed.minAssets).toEqual({ value: 5_000_000_000, inclusive: false });
    expect(isPeerListQuestion("Talk to me about our NSF fees")).toBe(false);
  });
  for (const question of ["How does our overdraft compare with peers?", "List peers and their NSF fees", "Create a report on peers", "What is our peer median?", "Explain how peers are selected", "What should we charge?", "List local competitors", "Who are my local competitors and where are they?"]) {
    it(`does not replace fee/report analysis: ${question}`, () => { expect(isPeerListQuestion(question)).toBe(false); expect(parsePeerListQuestion(question)).toBeNull(); });
  }
  it("uses dollars for asset bounds, not thousands or a fee price", () => { expect(intent("List banks above $10B").minAssets).toEqual({ value: 10_000_000_000, inclusive: false }); });
  it("distinguishes at least from greater than", () => { expect(intent("List banks at least $10B").minAssets).toEqual({ value: 10_000_000_000, inclusive: true }); });
  it("distinguishes up to from under", () => { expect(intent("List credit unions up to $1 billion").maxAssets).toEqual({ value: 1_000_000_000, inclusive: true }); expect(intent("List credit unions under $1 billion").maxAssets).toEqual({ value: 1_000_000_000, inclusive: false }); });
  it("supports abbreviated ranges without dropping units", () => { expect(intent("List banks between $1 and $5 billion").minAssets?.value).toBe(1_000_000_000); expect(intent("List banks between $1 and $5 billion").maxAssets?.value).toBe(5_000_000_000); });
  it("supports raw dollar amounts", () => { expect(intent("List banks above $1,000,000,000").minAssets?.value).toBe(1_000_000_000); });
  it("supports plus thresholds", () => { expect(intent("List $10B+ institutions").minAssets).toEqual({ value: 10_000_000_000, inclusive: true }); });
  it("keeps the requested count while bounding the page", () => { expect(intent("List 100 peers").requestedCount).toBe(100); expect(intent("List 100 peers").limit).toBe(50); });
  it("does not pretend an all request is a complete 50-row list", () => { expect(intent("List all peers").requestedCount).toBeNull(); expect(intent("List all peers").limit).toBe(50); });
  it("rejects a zero count", () => { expect(intent("List 0 peers").problems.length > 0).toBe(true); });
  it("rejects descending or incompatible asset ranges", () => { expect(intent("List banks between $5B and $1B").problems.length > 0).toBe(true); expect(intent("List banks over $5B and under $5B").problems.length > 0).toBe(true); });
  it("parses both types explicitly", () => { expect(intent("List 10 banks and credit unions").bothTypes).toBe(true); });
  it("supports full state names, abbreviations and multiple states", () => { expect(intent("List banks in Florida and Georgia").states).toEqual(["FL", "GA"]); expect(intent("List banks in fl").states).toEqual(["FL"]); });
  it("does not read lowercase 'in' as Indiana", () => { expect(intent("List banks in Florida").states).toEqual(["FL"]); });
  it("does not confuse Washington DC with Washington state", () => { expect(intent("List banks in Washington DC").states).toEqual(["DC"]); expect(intent("List banks in West Virginia").states).toEqual(["WV"]); });
  for (const question of ["List peers excluding Bank A", "List peers not in Florida", "List peers in Canada", "List peers with similar ROA", "List peers from 2024", "List local competitors with assets above $5B", "List peers for Named Bank", "List peers for Bank A", "List peers in ZZ"]) {
    it(`does not silently ignore unsupported criteria: ${question}`, () => { expect(intent(question).problems.length > 0).toBe(true); });
  }
});

describe("explicit, similar-size and saved selection", () => {
  it("states a default half-to-double asset band and the subject's reporting date", () => {
    const result = plan("List ten peers");
    expect(result.problem).toBeNull();
    expect(result.criteria?.minAssets).toEqual({ value: 5_000_000_000, inclusive: true });
    expect(result.criteria?.maxAssets).toEqual({ value: 20_000_000_000, inclusive: true });
    expect(result.criteria?.sort).toBe("closest_assets");
    expect(result.criteria?.descriptions.join(" ")).toContain("2026-06-30");
  });
  it("does not add a size restriction to a simple list of banks in a state", () => { const c = plan("List 10 banks in Florida").criteria; expect(c?.minAssets).toBeNull(); expect(c?.requiresAssets).toBe(false); expect(c?.sort).toBe("largest_assets"); expect(c?.states).toEqual(["FL"]); });
  it("keeps the largest when a filtered list is capped, and the closest for a similar-size list (#1540)", () => {
    expect(plan("List Florida institutions with assets above $5B").criteria?.sort).toBe("largest_assets");
    expect(plan("List Florida institutions with assets above $5B").criteria?.descriptions).toContain("Ordered by total assets, largest first, then institution name and ID.");
    expect(plan("List ten similarly sized credit unions").criteria?.sort).toBe("closest_assets");
  });
  it("does not treat all institutions as just the subject's type", () => { expect(plan("List institutions above $1B").criteria?.charterType).toBeNull(); });
  it("honors the active saved group for generic peers", () => { const c = plan("List ten peers", saved).criteria; expect(c?.basis).toBe("saved_peer_set"); expect(c?.institutionIds).toEqual([202, 203]); expect(c?.minAssets).toBeNull(); });
  it("lets explicit criteria replace defaults without retaining unrelated saved IDs", () => { const c = plan("List ten banks in Florida", saved).criteria; expect(c?.basis).toBe("explicit_filters"); expect(c?.institutionIds).toBeNull(); expect(c?.charterType).toBe("bank"); });
  it("refines an explicitly requested saved set without widening it", () => { const c = plan("List saved peers in Florida", saved).criteria; expect(c?.institutionIds).toEqual([202, 203]); expect(c?.states).toEqual(["FL"]); });
  it("does not widen conflicting saved states to nationwide", () => { expect(plan("List saved peers in Texas", saved).criteria).toBeNull(); });
  it("does not broaden a saved group's type on a request for both types", () => { expect(plan("List saved peers of both types", saved).criteria).toBeNull(); });
  it("does not pretend an unavailable saved group exists", () => { expect(plan("List saved peers").criteria).toBeNull(); });
  it("does not reinterpret an empty saved group as all institutions", () => { expect(plan("List saved peers", { ...saved, filters: {} }).criteria).toBeNull(); });
  it("keeps saved district and registry-tier constraints", () => { const c = plan("List saved peers", { ...saved, filters: { fed_districts: [6], asset_tiers: ["regional"] } }).criteria; expect(c?.fedDistricts).toEqual([6]); expect(c?.assetTiers).toEqual(["regional"]); });
  it("does not union contradictory saved state filters", () => { expect(plan("List saved peers", { ...saved, filters: { states: ["FL"], state_code: "TX" } }).criteria).toBeNull(); });
  it("does not guess similar-size eligibility when the subject's assets are unknown", () => { expect(plan("List ten peers", null, { ...subject, totalAssetsUsd: null }).criteria).toBeNull(); });
  it("still supports an explicit range when subject assets are missing", () => { expect(plan("List credit unions above $1B", null, { ...subject, totalAssetsUsd: null }).criteria?.minAssets?.value).toBe(1_000_000_000); });
  it("resolves same-state to the explicit subject's state", () => { expect(plan("List peers in the same state").criteria?.states).toEqual(["FL"]); });
  it("never substitutes a state when it is missing", () => { expect(plan("List peers in the same state", null, { ...subject, stateCode: null }).criteria).toBeNull(); });
  it("uses actual assets rather than deposits or a registry tier", () => { expect(plan("List similar credit unions").criteria?.referenceAssetsUsd).toBe(10_000_000_000); });
  it("distinguishes missing assets from a genuine zero", () => { expect(formatPeerAssets(null)).toBe("Not available"); expect(formatPeerAssets(0)).toBe("$0"); });
});

describe("James's live wordings (#1537, #1539)", () => {
  const schoolsFirst: PeerListSubject = { ...subject, institutionId: 6741, name: "Schoolsfirst Federal Credit Union", stateCode: "CA", totalAssetsUsd: 37_200_000_000 };
  it("turns 'similarly sized … to SchoolsFirst' into a stated band around SchoolsFirst's assets", () => {
    for (const q of ["List ten similarly sized credit unions to SchoolsFirst.", "List ten similarly sized credit unions in Delaware to SchoolsFirst."]) {
      const result = planPeerList(intent(q), schoolsFirst, null);
      expect(result.problem).toBeNull();
      expect(result.criteria?.minAssets?.value).toBe(18_600_000_000);
      expect(result.criteria?.maxAssets?.value).toBe(74_400_000_000);
      expect(result.criteria?.descriptions[0]).toBe("Asset-size peers: between half and twice Schoolsfirst Federal Credit Union's $37,200,000,000 in assets (2026-06-30).");
    }
    expect(planPeerList(intent("List ten similarly sized credit unions in Delaware to SchoolsFirst."), schoolsFirst, null).criteria?.states).toEqual(["DE"]);
  });
  it("accepts other ways of saying similar size", () => {
    for (const q of ["List ten similar-sized credit unions", "List credit unions the same size as SchoolsFirst", "List credit unions about the same size as SchoolsFirst FCU"]) {
      expect(intent(q).similarSize).toBe(true);
    }
    expect(planPeerList(intent("List credit unions the same size as SchoolsFirst"), schoolsFirst, null).problem).toBeNull();
  });
  it("accepts short names of the research institution (U.S. Bank, M&T)", () => {
    const usBank: PeerListSubject = { ...subject, institutionId: 5, name: "U.S. Bank National Association", totalAssetsUsd: 660_000_000_000 };
    const mt: PeerListSubject = { ...subject, institutionId: 21, name: "Manufacturers and Traders Trust Company", totalAssetsUsd: 210_000_000_000 };
    expect(planPeerList(intent("List ten similarly sized banks to U.S. Bank"), usBank, null).problem).toBeNull();
    expect(planPeerList(intent("List ten similarly sized banks to M&T Bank"), { ...mt, name: "M&T Bank" }, null).problem).toBeNull();
    expect(planPeerList(intent("List ten similarly sized banks to M&T Bank"), mt, null).problem).toContain("open M&T Bank in the workspace first");
  });
  it("keeps a state inside a named size reference as part of the name (#1604 review)", () => {
    const idaho: PeerListSubject = { ...subject, institutionId: 900, name: "Idaho Central Credit Union", stateCode: "ID", totalAssetsUsd: 10_000_000_000 };
    const i = intent("List ten similarly sized credit unions to Idaho Central");
    expect(i.similarTo).toBe("Idaho Central");
    expect(i.states).toEqual([]);
    expect(planPeerList(i, idaho, null).problem).toBeNull();
    const tx = intent("List ten similarly sized banks to Texas Capital");
    expect(tx.states).toEqual([]);
    expect(planPeerList(tx, { ...subject, name: "Capital One, N.A." }, null).problem).toContain("open Texas Capital in the workspace first");
    const va = intent("List ten similarly sized credit unions like Navy Federal in VA");
    expect(va.similarTo).toBe("Navy Federal");
    expect(va.states).toEqual(["VA"]);
  });
  it("never treats a different institution with a similar name as the research institution", () => {
    for (const [typed, name] of [["TDECU", "TD Bank, N.A."], ["First Citizens", "FirstBank"], ["Citizens Business Bank", "Citizens Bank, N.A."], ["Citi", "Citizens Bank, N.A."], ["Capital", "Capital One, N.A."], ["Citizens Bank", "Citizens National Bank"], ["First Federal", "First National Bank"], ["American Bank", "American National Bank"]]) {
      expect(planPeerList(intent(`List ten similarly sized banks to ${typed}`), { ...subject, name }, null).problem).toContain("open");
    }
  });
  it("refuses a size reference that is not the research institution, rather than measuring against it", () => {
    const result = planPeerList(intent("List ten similarly sized credit unions to Navy Federal."), schoolsFirst, null);
    expect(result.criteria).toBeNull();
    expect(result.problem).toBe("This list measures size against the institution you are researching, Schoolsfirst Federal Credit Union. To list peers sized like Navy Federal, open Navy Federal in the workspace first.");
  });
  it("reads every common way of writing $5 billion as the same list request", () => {
    const wordings = ["Florida institutions with assets above $5B.", "Florida institutions with assets above 5 billion.", "Florida institutions with assets above $5 billion.", "Florida institutions with assets above $5,000M.", "Florida institutions with assets above 5000 million."];
    const plans = wordings.map(q => { expect(isPeerListQuestion(q)).toBe(true); return planPeerList(intent(q), schoolsFirst, null); });
    for (const p of plans) {
      expect(p.problem).toBeNull();
      expect(p.criteria?.minAssets).toEqual({ value: 5_000_000_000, inclusive: false });
      expect(p.criteria?.states).toEqual(["FL"]);
      expect(p.criteria?.descriptions).toEqual(plans[0].criteria?.descriptions);
    }
  });
  it("still leaves an asset-sized fee question to fee analysis", () => {
    expect(isPeerListQuestion("What do banks over $5B charge for overdraft fees?")).toBe(false);
  });
});

describe("state refinement of a peer list (#1538)", () => {
  it("narrows by a state in the common follow-up phrasings", async () => {
    const { peerListRefinementState } = await import("./peer-list");
    expect(peerListRefinementState("Only show the California ones.")).toBe("CA");
    expect(peerListRefinementState("Only Florida")).toBe("FL");
    expect(peerListRefinementState("Show only Texas")).toBe("TX");
    expect(peerListRefinementState("Show me only the GA ones")).toBe("GA");
    expect(peerListRefinementState("Filter to Florida.")).toBe("FL");
  });
  it("matches no state when the follow-up adds another condition, rather than dropping it", async () => {
    const { peerListRefinementState } = await import("./peer-list");
    expect(peerListRefinementState("Show only Texas banks")).toBeNull();
    expect(peerListRefinementState("Filter to Florida credit unions over $1B")).toBeNull();
    expect(peerListRefinementState("Florida only")).toBeNull();
  });
});

/**
 * The peer-request test matrix (#977, H02-T01): one row per wording, with the task Hamilton should
 * take, the filters it should read, the selection basis and what the reader gets back. Rows marked
 * "Oct 15-16 live run" are the wordings that failed in James's live run (#1537, #1538, #1540).
 * The half-to-twice band for "similarly sized" awaits James's approval; this table records it as built.
 */
type MatrixTask = "peer_list" | "refine_list" | "list_fees" | "fee_or_report" | "clarify";
type MatrixOutput = "institution_table" | "narrowed_table" | "peer_fee_table" | "guidance" | "other_route";
interface MatrixRow {
  question: string;
  task: MatrixTask;
  filters?: { charterType?: "bank" | "credit_union" | null; states?: string[]; minAssets?: number | null; maxAssets?: number | null; requestedCount?: number | null; sort?: "closest_assets" | "largest_assets" };
  basis?: "similar_assets" | "explicit_filters" | "saved_peer_set";
  output: MatrixOutput;
  source?: string;
  subject?: PeerListSubject;
  active?: ActivePeerSet;
}
const schoolsFirstSubject: PeerListSubject = { ...subject, institutionId: 6741, name: "Schoolsfirst Federal Credit Union", stateCode: "CA", totalAssetsUsd: 37_200_000_000 };
const PEER_REQUEST_MATRIX: MatrixRow[] = [
  { question: "List ten peers", task: "peer_list", filters: { charterType: "credit_union", states: [], minAssets: 5e9, maxAssets: 2e10, requestedCount: 10, sort: "closest_assets" }, basis: "similar_assets", output: "institution_table" },
  { question: "List ten similarly sized credit unions to SchoolsFirst.", task: "peer_list", filters: { charterType: "credit_union", states: [], minAssets: 18.6e9, maxAssets: 74.4e9, requestedCount: 10, sort: "closest_assets" }, basis: "similar_assets", output: "institution_table", source: "Oct 15-16 live run, B8 (#1537)", subject: schoolsFirstSubject },
  { question: "List ten similarly sized credit unions in Delaware to SchoolsFirst.", task: "peer_list", filters: { charterType: "credit_union", states: ["DE"], minAssets: 18.6e9, maxAssets: 74.4e9, requestedCount: 10 }, basis: "similar_assets", output: "institution_table", source: "Oct 15-16 live run, B10b (#1537)", subject: schoolsFirstSubject },
  { question: "List 10 similar-sized banks in Florida", task: "peer_list", filters: { charterType: "bank", states: ["FL"], requestedCount: 10, sort: "closest_assets" }, basis: "similar_assets", output: "institution_table", source: "demo wording that worked live (#1537)" },
  { question: "Show 10 similarly sized credit unions in Florida", task: "peer_list", filters: { charterType: "credit_union", states: ["FL"], requestedCount: 10 }, basis: "similar_assets", output: "institution_table" },
  { question: "Florida institutions with assets above $5B", task: "peer_list", filters: { charterType: null, states: ["FL"], minAssets: 5e9, maxAssets: null, requestedCount: 10, sort: "largest_assets" }, basis: "explicit_filters", output: "institution_table", source: "Oct 15-16 live run, B11 (#1540)" },
  { question: "talki to me about institutions in florida over5b", task: "peer_list", filters: { states: ["FL"], minAssets: 5e9 }, basis: "explicit_filters", output: "institution_table", source: "typo reported on #977" },
  { question: "List 15 banks between $1B and $5B in TX", task: "peer_list", filters: { charterType: "bank", states: ["TX"], minAssets: 1e9, maxAssets: 5e9, requestedCount: 15 }, basis: "explicit_filters", output: "institution_table" },
  { question: "List the 25 largest banks nationwide", task: "peer_list", filters: { charterType: "bank", states: [], requestedCount: 25, sort: "largest_assets" }, basis: "explicit_filters", output: "institution_table" },
  { question: "List all credit unions in Florida", task: "peer_list", filters: { charterType: "credit_union", states: ["FL"], requestedCount: null, sort: "largest_assets" }, basis: "explicit_filters", output: "institution_table" },
  { question: "List 10 banks and credit unions in Georgia", task: "peer_list", filters: { charterType: null, states: ["GA"], requestedCount: 10 }, basis: "explicit_filters", output: "institution_table" },
  { question: "Show peers in the same state", task: "peer_list", filters: { charterType: "credit_union", states: ["FL"] }, basis: "similar_assets", output: "institution_table" },
  { question: "List my saved peers", task: "peer_list", filters: { charterType: "credit_union", states: ["FL", "GA"] }, basis: "saved_peer_set", output: "institution_table", active: { status: "ready", institutionCount: 2, institutionId: 101, id: 7, name: "Chosen peers", label: "Chosen peers", filters: { institutionIds: [202, 203], charter_type: "credit_union", states: ["FL", "GA"] } } },
  { question: "List my saved peers", task: "clarify", output: "guidance", source: "no saved group: says so, runs no substitute" },
  { question: "List local competitors with assets above $5B", task: "clarify", output: "guidance" },
  { question: "List peers excluding Bank A", task: "clarify", output: "guidance" },
  { question: "List peers for Bank A", task: "clarify", output: "guidance" },
  { question: "List ten similarly sized credit unions to Navy Federal", task: "clarify", output: "guidance", source: "size measured only against the researched institution (#1539)" },
  { question: "List local competitors", task: "fee_or_report", output: "other_route", source: "local-market view keeps its branch data" },
  { question: "How does our overdraft compare with peers?", task: "fee_or_report", output: "other_route" },
  { question: "List peers and their NSF fees", task: "fee_or_report", output: "other_route" },
  { question: "Create a report on peers", task: "fee_or_report", output: "other_route" },
  { question: "What is our peer median?", task: "fee_or_report", output: "other_route" },
  { question: "Only show the California ones.", task: "refine_list", filters: { states: ["CA"] }, output: "narrowed_table", source: "Oct 15-16 live run, B9 (#1538)" },
  { question: "Only Florida", task: "refine_list", filters: { states: ["FL"] }, output: "narrowed_table" },
  { question: "Filter to Texas", task: "refine_list", filters: { states: ["TX"] }, output: "narrowed_table" },
  { question: "Compare their NSF fees.", task: "list_fees", output: "peer_fee_table", source: "Oct 15-16 live run, B10 (#1538)" },
  { question: "Compare their overdraft fees", task: "list_fees", output: "peer_fee_table" },
  { question: "How does this compare with us?", task: "list_fees", output: "peer_fee_table" },
];

describe("peer-request test matrix (#977, H02-T01)", () => {
  for (const row of PEER_REQUEST_MATRIX) {
    it(`${row.task}: ${row.question}${row.source ? ` [${row.source}]` : ""}`, () => {
      const target = row.subject ?? subject;
      if (row.task === "fee_or_report") {
        expect(isPeerListQuestion(row.question)).toBe(false);
        expect(isPeerListContinuationQuestion(row.question)).toBe(false);
        return;
      }
      if (row.task === "refine_list" || row.task === "list_fees") {
        expect(isPeerListQuestion(row.question)).toBe(false);
        expect(isPeerListContinuationQuestion(row.question)).toBe(true);
        if (row.task === "refine_list") expect(peerListRefinementState(row.question)).toBe(row.filters?.states?.[0]);
        else expect(peerListFeeFollowUp(row.question)).not.toBeNull();
        return;
      }
      expect(isPeerListQuestion(row.question)).toBe(true);
      const result = planPeerList(intent(row.question), target, row.active ?? null);
      if (row.task === "clarify") {
        expect(result.criteria).toBeNull();
        expect(result.problem).toMatch(/\S/);
        return;
      }
      expect(result.problem).toBeNull();
      const c = result.criteria!;
      expect(c.basis).toBe(row.basis);
      const f = row.filters ?? {};
      if (f.charterType !== undefined) expect(c.charterType).toBe(f.charterType);
      if (f.states) expect(c.states).toEqual(f.states);
      if (f.minAssets !== undefined) expect(c.minAssets?.value ?? null).toBe(f.minAssets);
      if (f.maxAssets !== undefined) expect(c.maxAssets?.value ?? null).toBe(f.maxAssets);
      if (f.requestedCount !== undefined) expect(c.requestedCount).toBe(f.requestedCount);
      if (f.sort) expect(c.sort).toBe(f.sort);
    });
  }
  it("covers every task and output the matrix names, and each live-run failure", () => {
    expect(new Set(PEER_REQUEST_MATRIX.map(row => row.task))).toEqual(new Set(["peer_list", "refine_list", "list_fees", "fee_or_report", "clarify"]));
    const live = PEER_REQUEST_MATRIX.filter(row => row.source?.startsWith("Oct 15-16 live run")).map(row => row.source);
    expect(live).toEqual(expect.arrayContaining([expect.stringContaining("#1537"), expect.stringContaining("#1538"), expect.stringContaining("#1540")]));
  });
});

describe("peer list pages (#977, H02-T08)", () => {
  const all = plan("List all credit unions in Florida").criteria!;
  const ten = plan("List ten peers").criteria!;
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ ...subject, institutionId: 500 + i, feeCoverage: "not_found" as const, inclusionReason: "x" }));
  const data = (criteria: typeof all, n: number, total: number, offset?: number) => ({ status: "ready" as const, criteria, rows: rows(n), totalMatches: total, ...(offset ? { offset } : {}) });
  it("offers the next page only for a list asked for all or for more than a page", () => {
    expect(peerListPageOffsets(data(all, 50, 120))).toEqual({ previous: null, next: 50 });
    expect(peerListPageOffsets(data(all, 50, 120, 50))).toEqual({ previous: 0, next: 100 });
    expect(peerListPageOffsets(data(all, 20, 120, 100))).toEqual({ previous: 50, next: null });
    expect(peerListPageOffsets(data(ten, 10, 120))).toEqual({ previous: null, next: null });
    expect(peerListPageOffsets(data(plan("List 60 credit unions in Florida").criteria!, 50, 120))).toEqual({ previous: null, next: 50 });
    expect(peerListPageOffsets(data(plan("List 60 credit unions in Florida").criteria!, 10, 120, 50))).toEqual({ previous: 0, next: null });
    expect(peerListPageOffsets({ ...data(all, 50, 120), feeComparison: { category: "nsf", comparedPeerIds: [], fees: [], account: null, includesAccount: false, note: "" } })).toEqual({ previous: null, next: null });
  });
  it("reads only whole offsets in range and carries the shown page into a follow-up", () => {
    expect([undefined, null, 0, 50, 10_000].map(readPeerListOffset)).toEqual([0, 0, 0, 50, 10_000]);
    expect([-1, 1.5, 10_001, "50"].map(readPeerListOffset)).toEqual([null, null, null, null]);
    const response = { kind: "peer_list" as const, shortAnswer: "x", peerList: { version: 1 as const, status: "ready" as const, subject, criteria: all, rows: rows(2), totalMatches: 52, queriedAt: "2026-10-17T00:00:00Z", notes: [], offset: 50 } };
    const continuation = makePeerListContinuation(response, "List all credit unions in Florida", "101")!;
    expect(continuation.originOffset).toBe(50);
    expect(validatePeerListContinuation(continuation)).toEqual(continuation);
    expect(validatePeerListContinuation({ ...continuation, originOffset: -5 })).toBeNull();
    expect(makePeerListContinuation({ ...response, peerList: { ...response.peerList, offset: undefined } }, "List all credit unions in Florida", "101")!.originOffset).toBeUndefined();
  });
});
