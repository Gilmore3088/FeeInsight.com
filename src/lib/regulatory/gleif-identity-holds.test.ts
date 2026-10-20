import { describe, expect, it } from "vitest";
import type { FdicIdentityHold } from "@/lib/data-store/fdic-identity-holds";
import { createGleifLinker, type GleifEntity } from "./gleif";
import { createGleifIdentityVeto } from "./gleif-identity-holds";
import { proposeByKey, proposeByNameState, proposeOwnLei, vetoLeiLink, type LeiUniverseInstitution } from "./gleif-lei-match";

const A = "5493001KJTIIGC8Y1R12";
const B = "549300ABCDEFGHIJKL34";
const C = "549300ZZZZZZZZZZZZ56";
const hold: FdicIdentityHold = { id: 1, fingerprint: "a".repeat(64), certificate: "99", institutionId: 1,
  reason: "stored_lei_conflict", storedLei: A, implicatedLeis: [A, B], reportedLeis: [B], ownerCertificates: ["99"],
  sourceUrl: "https://api.fdic.gov/banks/institutions", sourceSha256: "b".repeat(64), observedAt: "2026-10-19T00:00:00Z", agentRunId: 1, evidence: {} };
const institution: LeiUniverseInstitution = { id: 1, source: "fdic", cert: "99", charter: null, lei: A, rssd: "123", name: "First Bank", state: "TX" };
const entity: GleifEntity = { lei: B, legalName: "First Bank", jurisdiction: "US", legalCountry: "US", legalRegion: "US-TX", legalState: "TX",
  legalCity: null, hqCountry: null, category: null, legalFormId: null, entityStatus: "ACTIVE", registrationStatus: "ISSUED", registeredAtId: "NIC", registeredAs: "123",
  lastUpdate: null, nextRenewal: null, raw: {} };

describe("durable FDIC veto for GLEIF", () => {
  it("blocks every implicated LEI and a later institution with the held certificate", () => {
    const veto = createGleifIdentityVeto([{ ...hold, institutionId: null }]);
    expect(veto.blocksLei(` ${B.toLowerCase()} `)).toBe(true);
    expect(veto.blocksInstitution(123, "99", "fdic")).toBe(true);
    expect(veto.blocksInstitution(123, "99", "ncua")).toBe(false);
  });

  it("holds own LEI, regulator key, and exact name proposals", () => {
    expect(proposeOwnLei([institution], [hold]).get(1)).toMatchObject({ kind: "ambiguous", candidates: [A, B] });
    expect(proposeByKey([institution], [entity], "rssd", new Set(["NIC"]), [hold]).get(1)).toMatchObject({ kind: "ambiguous", candidates: [A, B] });
    expect(proposeByNameState(institution, [entity], [hold])).toMatchObject({ kind: "ambiguous", candidates: [A, B] });
    expect(vetoLeiLink({ institutionId: 1, status: "linked", lei: C, basis: "rssd", key: "123", candidates: [], reason: null }, institution, [hold])).toMatchObject({ status: "ambiguous", lei: null, candidates: [A, B, C] });
  });

  it("vetoes RSSD even when the lender LEI differs, and blocks another owner of an implicated key", () => {
    const universe = [{ id: 1, source: "fdic", cert: "99", lei: A, rssd: "123" }, { id: 2, source: "fdic", cert: "100", lei: B, rssd: "456" }];
    const link = createGleifLinker(universe, [hold]);
    expect(link(C, "123")).toEqual({ institutionId: null, method: null, ambiguous: true });
    expect(link(B, "456")).toEqual({ institutionId: null, method: null, ambiguous: true });
  });

  it("keeps held duplicate owners in uniqueness indexes and rejects contradictory identifiers", () => {
    const universe = [{ id: 1, source: "fdic", cert: "99", lei: C, rssd: "123" }, { id: 2, source: "fdic", cert: "100", lei: C, rssd: "456" }];
    expect(createGleifLinker(universe, [hold])(C, "456")).toMatchObject({ institutionId: null, ambiguous: true });
    expect(createGleifLinker([{ id: 1, lei: A, rssd: "123" }, { id: 2, lei: B, rssd: "456" }])(A, "456")).toMatchObject({ institutionId: null, ambiguous: true });
  });
});
