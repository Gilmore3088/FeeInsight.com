import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: Object.assign(vi.fn(), { unsafe: vi.fn() }) }));
vi.mock("./peer-markets", () => ({ getHomeMarket: vi.fn(), getMarketInstitutionIds: vi.fn() }));

import { sql } from "./connection";
import { getHomeMarket, getMarketInstitutionIds } from "./peer-markets";
import { describePeerSet } from "./peer-sets";
import { getPeerExplorerSet } from "./peer-explorer";
import { pickPeerSet, type PeerRankValue } from "./peer-fee-rank";
import { getInstitutionPeerChoices, institutionPeerRequest, statePeerDefinitions } from "./public-peer-sets";

const subjectRow = {
  id: 323, charter_type: "bank", asset_size: 4_447_362, asset_size_tier: "community_large", fed_district: 6,
  state_code: "FL", primary_regulator: "Federal Reserve", cu_charter_type: null, holding_company_rssd: "1085509",
};

describe("public peer sets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("splits credit unions by charter where banks split by regulator", () => {
    expect(institutionPeerRequest("regulator", { id: 1, charter_type: "bank" })).toEqual({ charter_type: "same", regulators: "same" });
    expect(institutionPeerRequest("regulator", { id: 1, charter_type: "credit_union" })).toEqual({ charter_type: "same", cu_charter: "same" });
  });

  it("should_take_banks_and_credit_unions_in_the_home_metro_with_a_banks_only_variant", () => {
    expect(institutionPeerRequest("metro", { id: 1, charter_type: "bank" })).toEqual({ market: "same" });
    expect(institutionPeerRequest("metro", { id: 1, charter_type: "credit_union" })).toEqual({ market: "same" });
    expect(institutionPeerRequest("metro_banks", { id: 1, charter_type: "credit_union" })).toEqual({ charter_type: "bank", market: "same" });
  });

  it("leaves out a choice the institution has no value for, such as a metro", async () => {
    vi.mocked(sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([subjectRow]);
    vi.mocked((sql as unknown as { unsafe: ReturnType<typeof vi.fn> }).unsafe).mockResolvedValue([{ id: 4 }]);
    vi.mocked(getHomeMarket).mockResolvedValue(null);
    const choices = await getInstitutionPeerChoices(323);
    // Closest in assets is listed first, so it is the default set; it names the one peer found.
    expect(choices.map((c) => [c.key, c.label])).toEqual([
      ["nearest", "The 1 bank closest in assets"],
      ["state", "Banks in Florida"],
      ["district", "Banks in the Atlanta Fed district"],
      ["size", "Banks with $1B to $10B in assets"],
      ["regulator", "Banks regulated by the Federal Reserve"],
    ]);
  });

  it("should_name_the_nearest_set_by_the_members_the_explorer_lists", async () => {
    // Four nearest; the explorer drops one it never names (Frost) and one without a member row.
    const db = sql as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    db.unsafe.mockImplementation((query: string, params?: unknown[]) => {
      if (params === undefined) return query;
      return Promise.resolve(query.includes("LIMIT") ? [{ id: 4 }, { id: 5 }, { id: 6 }, { id: 7 }] : []);
    });
    db.mockImplementation((strings: TemplateStringsArray) => {
      if (strings.join("?").includes("s.institution_name")) {
        return Promise.resolve([
          { id: 4, institution_name: "Peer 4" },
          { id: 5, institution_name: "Frost Bank" },
          { id: 7, institution_name: "Peer 7" },
        ]);
      }
      return Promise.resolve([subjectRow]);
    });
    vi.mocked(getHomeMarket).mockResolvedValue(null);
    const nearest = (await getInstitutionPeerChoices(323)).find((choice) => choice.key === "nearest");
    expect(nearest?.filters).toEqual({ institutionIds: [4, 7] });
    expect(nearest?.label).toBe("The 2 banks closest in assets");
  });

  it("names the state groups in plain words", () => {
    const labels = statePeerDefinitions("TX").map(({ def }) => describePeerSet(def));
    expect(labels).toContain("Institutions under $300M in assets in Texas");
    expect(labels).toContain("Banks regulated by the OCC in Texas");
    expect(labels).toContain("Federal credit unions in Texas");
  });

  it("should_count_the_home_metro_set_as_the_explorer_lists_it", async () => {
    // Tallahassee: eleven banks with a branch there besides the subject. One is inactive, one
    // publishes no approved fee and one is never named (Frost), so the explorer lists eight.
    const banks = [
      { id: 2, name: "Peer 2", active: true, publishes: true },
      { id: 3, name: "Closed Bank", active: false, publishes: true },
      { id: 4, name: "Quiet Bank", active: true, publishes: false },
      { id: 5, name: "Peer 5", active: true, publishes: true },
      { id: 7, name: "Frost Bank", active: true, publishes: true },
      { id: 8, name: "Peer 8", active: true, publishes: true },
      { id: 9, name: "Peer 9", active: true, publishes: true },
      ...[10, 11, 12, 13].map((id) => ({ id, name: `Peer ${id}`, active: true, publishes: true })),
    ];
    const MEMBER_RULE = "<explorer member rule>";
    const member = (id: number) => banks.some((b) => b.id === id && b.active && b.publishes);
    const db = sql as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    // A fake database applying the explorer's rule wherever a query carries it.
    db.unsafe.mockImplementation((query: string, params?: unknown[]) => {
      if (params === undefined) return query.includes("published_fee_catalog") ? MEMBER_RULE : query;
      const ids = params.find((p): p is number[] => Array.isArray(p) && typeof p[0] === "number");
      if (query.includes("SELECT s.id FROM institution_sources")) return Promise.resolve(ids ? ids.filter((id) => id !== 323).map((id) => ({ id })) : [{ id: 4 }]);
      return Promise.resolve([]);
    });
    db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      const ids = (values.find(Array.isArray) as number[] | undefined) ?? [];
      const ruled = values.includes(MEMBER_RULE);
      const rows = banks.filter((b) => ids.includes(b.id) && (!ruled || member(b.id)));
      if (query.includes("s.asset_size, s.city")) {
        return Promise.resolve([
          { id: 323, institution_name: "Subject Bank", asset_size: 4_447_362, city: "TALLAHASSEE", state_code: "FL", charter_type: "bank" },
          ...rows.map((b) => ({ id: b.id, institution_name: b.name, asset_size: 1_000_000, city: "TALLAHASSEE", state_code: "FL", charter_type: "bank" })),
        ]);
      }
      if (query.includes("s.institution_name")) return Promise.resolve(rows.map((b) => ({ id: b.id, institution_name: b.name })));
      return Promise.resolve([subjectRow]);
    });
    vi.mocked(getHomeMarket).mockResolvedValue({ code: 45220, name: "Tallahassee, FL" });
    vi.mocked(getMarketInstitutionIds).mockResolvedValue({ market: { code: 45220, name: "Tallahassee, FL" }, ids: new Set([323, ...banks.map((b) => b.id)]) });

    const choices = await getInstitutionPeerChoices(323);
    const all: PeerRankValue[] = [323, ...banks.map((b) => b.id)].map((id) => [id, "overdraft", 30, "bank", "FL", 6, "community_large"]);
    const sets = pickPeerSet(323, null, choices, all, "metro");
    const linkCount = sets?.options.find((option) => option.key === "metro")?.count;
    expect(sets?.selected.key).toBe("metro");

    const explorer = await getPeerExplorerSet(323, sets!.selectedFilters);
    expect(explorer?.peers.map((peer) => peer.id)).toEqual([2, 5, 8, 9, 10, 11, 12, 13]);
    expect(linkCount).toBe(explorer?.peers.length);
  });

  it("should_list_credit_unions_in_the_home_metro_and_count_both_views_as_the_explorer_lists_them", async () => {
    // Tallahassee: nine banks and nine credit unions with a branch there besides the subject. One
    // credit union publishes no approved fee, so the explorer lists seventeen, and banks only nine.
    const bankIds = [2, 3, 4, 5, 6, 7, 8, 9, 10];
    const cuIds = [30, 31, 32, 33, 34, 35, 36, 37];
    const members = [
      ...bankIds.map((id) => ({ id, name: `Peer Bank ${id}`, charter: "bank", publishes: true })),
      ...cuIds.map((id) => ({ id, name: `Peer Credit Union ${id}`, charter: "credit_union", publishes: true })),
      { id: 38, name: "Quiet Credit Union", charter: "credit_union", publishes: false },
    ];
    const MEMBER_RULE = "<explorer member rule>";
    const member = (id: number) => members.some((m) => m.id === id && m.publishes);
    const db = sql as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    db.unsafe.mockImplementation((query: string, params?: unknown[]) => {
      if (params === undefined) return query.includes("published_fee_catalog") ? MEMBER_RULE : query;
      if (!query.includes("SELECT s.id FROM institution_sources")) return Promise.resolve([]);
      if (query.includes("LIMIT")) return Promise.resolve([{ id: 2 }]);
      const ids = params.find((p): p is number[] => Array.isArray(p) && typeof p[0] === "number") ?? [];
      const charter = query.includes("s.charter_type =") ? params[0] : null;
      const kept = [323, ...members.map((m) => m.id)].filter((id) => ids.includes(id) && id !== 323);
      return Promise.resolve(kept.filter((id) => !charter || members.find((m) => m.id === id)?.charter === charter).map((id) => ({ id })));
    });
    db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      const ids = (values.find(Array.isArray) as number[] | undefined) ?? [];
      const ruled = values.includes(MEMBER_RULE);
      const rows = members.filter((m) => ids.includes(m.id) && (!ruled || member(m.id)));
      if (query.includes("s.asset_size, s.city")) {
        return Promise.resolve([
          { id: 323, institution_name: "Subject Bank", asset_size: 4_447_362, city: "TALLAHASSEE", state_code: "FL", charter_type: "bank" },
          ...rows.map((m) => ({ id: m.id, institution_name: m.name, asset_size: 1_000_000, city: "TALLAHASSEE", state_code: "FL", charter_type: m.charter })),
        ]);
      }
      if (query.includes("s.institution_name")) return Promise.resolve(rows.map((m) => ({ id: m.id, institution_name: m.name })));
      return Promise.resolve([subjectRow]);
    });
    vi.mocked(getHomeMarket).mockResolvedValue({ code: 45220, name: "Tallahassee, FL" });
    vi.mocked(getMarketInstitutionIds).mockResolvedValue({ market: { code: 45220, name: "Tallahassee, FL" }, ids: new Set([323, ...members.map((m) => m.id)]) });

    const choices = await getInstitutionPeerChoices(323);
    const metro = choices.find((choice) => choice.key === "metro");
    const banks = choices.find((choice) => choice.key === "metro_banks");
    expect(metro?.label).toBe("Banks and credit unions in the Tallahassee, FL metro");
    expect(banks?.label).toBe("Banks in the Tallahassee, FL metro");
    expect(metro?.filters).toEqual({ institutionIds: [...bankIds, ...cuIds] });
    expect(banks?.filters).toEqual({ institutionIds: bankIds });

    const all: PeerRankValue[] = [323, ...members.map((m) => m.id)].map((id) => [id, "overdraft", 30, "bank", "FL", 6, "community_large"]);
    const picked = pickPeerSet(323, null, choices, all, "metro");
    const explorer = await getPeerExplorerSet(323, picked!.selectedFilters);
    expect(explorer?.peers.filter((peer) => peer.charter === "credit_union").map((peer) => peer.id)).toEqual(cuIds);
    expect(explorer?.peers).toHaveLength(17);
    expect(picked?.options.find((option) => option.key === "metro")?.count).toBe(explorer?.peers.length);

    const banksOnly = pickPeerSet(323, null, choices, all, "metro_banks");
    expect(banksOnly?.selected.key).toBe("metro_banks");
    const banksExplorer = await getPeerExplorerSet(323, banksOnly!.selectedFilters);
    expect(banksOnly?.options.find((option) => option.key === "metro_banks")?.count).toBe(banksExplorer?.peers.length);
  });

  it("should_never_open_on_the_banks_only_metro_view_by_default", () => {
    const banks = [2, 3, 4, 5, 6, 7, 8, 9, 10];
    const all: PeerRankValue[] = [323, ...banks, 30].map((id) => [id, "overdraft", 30, "bank", "FL", 6, "community_large"]);
    const choices = [
      { key: "metro_banks", label: "Banks in the Tallahassee, FL metro", filters: { institutionIds: banks } },
      { key: "metro", label: "Banks and credit unions in the Tallahassee, FL metro", filters: { institutionIds: [...banks, 30] } },
    ];
    expect(pickPeerSet(323, null, choices, all, null)?.selected.key).toBe("metro");
  });
});
