import { describe, expect, it, vi } from "vitest";
import {
  MAX_PEER_SET_INSTITUTIONS,
  formatPrefillDate,
  hasPeerSetPrefill,
  parsePeerSetPrefillParams,
  peerSetPrefillSearch,
  resolvePeerSetPrefill,
} from "./peer-set-prefill";

const NOW = new Date("2026-10-18T12:00:00Z");
const parse = (params: Parameters<typeof parsePeerSetPrefillParams>[0]) => parsePeerSetPrefillParams(params, NOW);

describe("parsePeerSetPrefillParams: valid links", () => {
  it("reads the link builder's format (comma-separated ids, a fee category key, YYYY-MM-DD)", () => {
    // What Next hands the page for /pro/settings?instId=323&peers=10%2C11&name=The+25+banks+closest+in+assets&fee=overdraft&asof=2026-10-17
    expect(parse({ peers: "10,11", name: "The 25 banks closest in assets", fee: "overdraft", asof: "2026-10-17" })).toEqual({
      peerIds: [10, 11],
      name: "The 25 banks closest in assets",
      fee: "overdraft",
      asOf: "2026-10-17",
    });
  });

  it("keeps the punctuation real set labels use", () => {
    for (const name of [
      "Banks with $300M to $1B in assets",
      "Credit unions with branches in the Tampa-St. Petersburg-Clearwater, FL metro",
      "Louisville/Jefferson County, KY-IN",
      "Coöperative banks in Puerto Rico",
    ]) {
      expect(parse({ name }).name).toBe(name);
    }
  });

  it("collapses whitespace in the name and drops duplicate ids, keeping link order", () => {
    expect(parse({ peers: " 12, 10 ,12,11 ", name: "  Home   metro " })).toMatchObject({ peerIds: [12, 10, 11], name: "Home metro" });
  });

  it("accepts every fee category in the taxonomy and an as-of date of today", () => {
    expect(parse({ fee: "monthly_maintenance" }).fee).toBe("monthly_maintenance");
    expect(parse({ fee: "wire_intl_outgoing" }).fee).toBe("wire_intl_outgoing");
    expect(parse({ asof: "2026-10-18" }).asOf).toBe("2026-10-18");
  });
});

describe("parsePeerSetPrefillParams: invalid input is dropped, each parameter on its own", () => {
  it("drops malformed ids and keeps the good ones", () => {
    expect(parse({ peers: "10,abc,-4,0,07,1.5,1e3,,  ,11" }).peerIds).toEqual([10, 11]);
  });

  it("drops ids larger than a Postgres integer, which the name lookup cannot cast", () => {
    expect(parse({ peers: "2147483647,2147483648,99999999999" }).peerIds).toEqual([2147483647]);
  });

  it("drops unknown fee keys and anything that is not a key", () => {
    for (const fee of ["not_a_fee", "Overdraft", "overdraft ", "__proto__", "constructor", "toString", "<script>", ""]) {
      expect(parse({ fee }).fee).toBeNull();
    }
  });

  it("drops dates that are not real, not in YYYY-MM-DD, too old or in the future", () => {
    for (const asof of ["2026-02-30", "2026-13-01", "2026-10-1", "10/17/2026", "2026-10-17T00:00:00Z", "1999-12-31", "2026-10-20", "2099-01-01", "not a date", ""]) {
      expect(parse({ asof }).asOf).toBeNull();
    }
  });

  it("drops names with markup, quotes, control characters or no letters at all", () => {
    for (const name of ['<img src=x onerror="alert(1)">', "Peers\"; DROP", "Line\u0000break", "tab\u0007bell", "`code`", "{peers}", "a;b", "   ", ""]) {
      expect(parse({ name }).name).toBeNull();
    }
  });

  it("drops a name longer than the 100 characters the save action accepts", () => {
    expect(parse({ name: "a".repeat(100) }).name).toBe("a".repeat(100));
    expect(parse({ name: "a".repeat(101) }).name).toBeNull();
  });

  it("ignores repeated parameters, which the link builder never writes", () => {
    expect(parse({ peers: ["10", "11"], name: ["A", "B"], fee: ["overdraft"], asof: ["2026-10-17"] })).toEqual({
      peerIds: [],
      name: null,
      fee: null,
      asOf: null,
    });
  });

  it("returns nothing for an empty query", () => {
    const parsed = parse({});
    expect(parsed).toEqual({ peerIds: [], name: null, fee: null, asOf: null });
    expect(hasPeerSetPrefill(parsed)).toBe(false);
  });
});

describe("parsePeerSetPrefillParams: oversized input", () => {
  it("caps peers at the most a saved group holds", () => {
    const ids = Array.from({ length: 80 }, (_, i) => i + 1);
    const parsed = parse({ peers: ids.join(",") });
    expect(parsed.peerIds).toHaveLength(MAX_PEER_SET_INSTITUTIONS);
    expect(parsed.peerIds).toEqual(ids.slice(0, MAX_PEER_SET_INSTITUTIONS));
  });

  it("ignores a peers value longer than a full set can be", () => {
    expect(parse({ peers: `10,${"1,".repeat(5_000)}` }).peerIds).toEqual([]);
    expect(parse({ peers: "9".repeat(100_000) }).peerIds).toEqual([]);
  });

  it("ignores huge name, fee and date values without scanning them", () => {
    expect(parse({ name: "a ".repeat(500_000), fee: "o".repeat(100_000), asof: "2".repeat(100_000) })).toEqual({
      peerIds: [],
      name: null,
      fee: null,
      asOf: null,
    });
  });
});

describe("peerSetPrefillSearch", () => {
  it("writes the checked values back in the link builder's format", () => {
    const parsed = parse({ peers: "10,11", name: "Home metro", fee: "overdraft", asof: "2026-10-17" });
    expect(peerSetPrefillSearch(parsed).toString()).toBe("peers=10%2C11&name=Home+metro&fee=overdraft&asof=2026-10-17");
    expect(peerSetPrefillSearch(parse({ peers: "x", name: "<b>" })).toString()).toBe("");
  });
});

describe("resolvePeerSetPrefill", () => {
  const lookup = vi.fn(async (ids: number[]) => new Map(ids.filter((id) => id !== 99).map((id) => [id, `Bank ${id}`])));

  it("keeps only institutions the lookup knows, with their names and the fee's display name", async () => {
    const prefill = await resolvePeerSetPrefill(
      parse({ peers: "10,99,11", name: "Home metro", fee: "overdraft", asof: "2026-10-17" }),
      lookup,
    );
    expect(lookup).toHaveBeenCalledWith([10, 99, 11]);
    expect(prefill).toEqual({
      peers: [{ id: 10, name: "Bank 10" }, { id: 11, name: "Bank 11" }],
      name: "Home metro",
      fee: { key: "overdraft", label: "Overdraft (OD)" },
      asOf: "2026-10-17",
    });
  });

  it("is null without a known peer, so a name or fee alone opens nothing", async () => {
    lookup.mockClear();
    expect(await resolvePeerSetPrefill(parse({ name: "Home metro", fee: "overdraft" }), lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    expect(await resolvePeerSetPrefill(parse({ peers: "99" }), lookup)).toBeNull();
  });

  it("is null when the lookup fails, so the page still renders", async () => {
    expect(await resolvePeerSetPrefill(parse({ peers: "10" }), async () => { throw new Error("db down"); })).toBeNull();
  });
});

describe("formatPrefillDate", () => {
  it("writes the date in words, in UTC", () => {
    expect(formatPrefillDate("2026-10-17")).toBe("October 17, 2026");
    expect(formatPrefillDate("2026-01-01")).toBe("January 1, 2026");
  });
});
