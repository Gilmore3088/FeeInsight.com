import { describe, expect, it } from "vitest";

import { HOOVIE_SOURCES } from "@/lib/agents/hoovie/sources";
import { HELD_SOURCES, STRUCK_AREA_SOURCES } from "@/lib/data-store/struck-sources";
import { ATP_ATTRIBUTION } from "@/lib/regulatory/alltheplaces";
import { REMITTANCE_PRICES_ATTRIBUTION } from "@/lib/regulatory/economy";
import { OSM_ATTRIBUTION } from "@/lib/regulatory/payment-networks";
import { URBAN_DEBT_ATTRIBUTION } from "@/lib/regulatory/state-lists";
import {
  DATA_CATALOG,
  PIPELINE_AGENT_NAMES,
  SERVABLE_LICENCES,
  areaGeoTypeForScope,
  catalogEntry,
  isServable,
  scopeForAreaGeoType,
} from "./catalog";

describe("data catalog", () => {
  it("has one public-data entry per Hoovie contract, in registry order, and unique ids", () => {
    const publicIds = DATA_CATALOG.filter((e) => e.kind === "public-data").map((e) => e.id);
    expect(publicIds).toEqual(HOOVIE_SOURCES.map((c) => c.source));
    expect(new Set(DATA_CATALOG.map((e) => e.id)).size).toBe(DATA_CATALOG.length);
  });

  it("has fixed entries for published dollar fees, rate fees and institution financials", () => {
    expect(catalogEntry("published-fees")?.tables).toEqual(["published_fee_catalog"]);
    expect(catalogEntry("published-rate-fees")?.tables).toEqual(["published_fee_rate_catalog"]);
    expect(catalogEntry("institution-financials")?.tables).toContain("institution_financial_records");
  });

  it("never serves a held, terms-unconfirmed or struck source", () => {
    for (const entry of DATA_CATALOG) {
      if (entry.licence.status === "held" || entry.licence.status === "terms-unconfirmed") {
        expect(entry.servable, entry.id).toBe(false);
        expect(entry.notServableReason, entry.id).toBeTruthy();
      }
      if (STRUCK_AREA_SOURCES.includes(entry.id) || HELD_SOURCES.includes(entry.id)) expect(entry.servable, entry.id).toBe(false);
      if (entry.servable) expect(SERVABLE_LICENCES, entry.id).toContain(entry.licence.status);
    }
    // A struck or held id is refused even when its licence alone would pass.
    for (const id of [...STRUCK_AREA_SOURCES, ...HELD_SOURCES]) {
      expect(isServable({ status: "public-domain" }, id).servable, id).toBe(false);
    }
    // Released 2026-10-18 with attribution (CC BY 4.0; ODC-By 1.0).
    expect(catalogEntry("world-bank-remittance-prices")?.servable).toBe(true);
    expect(catalogEntry("urban-debt-in-america")?.servable).toBe(true);
    // Read from the Fed Board's own public-domain files since 2026-10-18 (FRED replaced).
    expect(catalogEntry("national-series")?.servable).toBe(true);
    expect(catalogEntry("bls-laus")?.servable).toBe(true);
  });

  it("gives every servable open-licence source the credit its licence requires, matching what the loader stores", () => {
    for (const entry of DATA_CATALOG) {
      if (!entry.servable || entry.licence.status !== "open-licence") continue;
      // CC0 asks for no credit; every other open licence here does.
      if (!/^CC0\b/.test(entry.licence.licenceName ?? "")) expect(entry.licence.attribution, entry.id).toBeTruthy();
    }
    expect(catalogEntry("world-bank-remittance-prices")?.licence.attribution).toBe(REMITTANCE_PRICES_ATTRIBUTION);
    expect(catalogEntry("urban-debt-in-america")?.licence.attribution).toBe(URBAN_DEBT_ATTRIBUTION);
    expect(catalogEntry("alltheplaces")?.licence.attribution).toBe(ATP_ATTRIBUTION);
    expect(catalogEntry("payment-networks")?.licence.attribution).toBe(OSM_ATTRIBUTION);
  });

  it("never names a pipeline agent in a customer-facing label or publisher", () => {
    const agents = new RegExp(`\\b(${PIPELINE_AGENT_NAMES.join("|")})\\b`, "i");
    for (const entry of DATA_CATALOG) {
      expect(entry.label, entry.id).not.toMatch(agents);
      expect(entry.publisher, entry.id).not.toMatch(agents);
      expect(entry.label.trim(), entry.id).not.toBe("");
    }
  });

  it("maps area_statistics nation to the contract's national and back", () => {
    expect(areaGeoTypeForScope("national")).toBe("nation");
    expect(areaGeoTypeForScope("state")).toBe("state");
    expect(areaGeoTypeForScope("institution")).toBeNull();
    expect(areaGeoTypeForScope("peer_set")).toBeNull();
    expect(scopeForAreaGeoType("nation")).toBe("national");
    expect(scopeForAreaGeoType("county")).toBe("county");
    expect(catalogEntry("fed-shed")?.areaGeoTypes).toEqual(["nation"]);
    expect(catalogEntry("bls-qcew")?.areaGeoTypes).toEqual(["nation", "state", "county", "metro"]);
    for (const entry of DATA_CATALOG) expect(entry.areaGeoTypes as string[], entry.id).not.toContain("national");
  });

  it("gives an area measure prefix only to sources that write area_statistics", () => {
    for (const entry of DATA_CATALOG.filter((e) => e.kind === "public-data")) {
      if (entry.tables.includes("area_statistics")) expect(entry.measurePrefix, entry.id).toBe(`area:${entry.id}:`);
      else expect(entry.measurePrefix, entry.id).toBeNull();
    }
    expect(catalogEntry("published-fees")?.measurePrefix).toBe("fee:");
  });
});
