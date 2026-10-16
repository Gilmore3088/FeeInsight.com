import { describe, expect, it } from "vitest";
import { formatPeerAssets, isPeerListQuestion, parsePeerListQuestion, planPeerList, type PeerListSubject } from "./peer-list";
import type { ActivePeerSet } from "./active-peer-set";

export const subject: PeerListSubject = { institutionId: 101, name: "Synthetic Home CU", charterType: "credit_union", city: "Orlando", stateCode: "FL", totalAssetsUsd: 10_000_000_000, reportDate: "2026-06-30", source: "ncua", sourceUrl: null, recordId: 1 };
const intent = (question: string) => { const result = parsePeerListQuestion(question); if (!result) throw new Error("Not a list"); return result; };
const plan = (question: string, active: ActivePeerSet | null = null, target = subject) => planPeerList(intent(question), target, active);
const saved: ActivePeerSet = { id: 7, name: "Chosen peers", label: "Chosen peers", filters: { institutionIds: [202, 203], charter_type: "credit_union", states: ["FL", "GA"] } };

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
  it("does not add a size restriction to a simple list of banks in a state", () => { const c = plan("List 10 banks in Florida").criteria; expect(c?.minAssets).toBeNull(); expect(c?.sort).toBe("name"); expect(c?.states).toEqual(["FL"]); });
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
