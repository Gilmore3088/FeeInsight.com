import { describe, expect, it } from "vitest";

import type { GleifEntity } from "./gleif";
import {
  keyAuthorities,
  mergeLeiLink,
  normalizeLegalName,
  proposeByKey,
  proposeByNameState,
  proposeOwnLei,
  type LeiLinkRow,
  type LeiUniverseInstitution,
} from "./gleif-lei-match";

const A = "5493001KJTIIGC8Y1R12";
const B = "549300ABCDEFGHIJKL34";
const NIC = "RA000602";

function entity(lei: string, over: Partial<GleifEntity> = {}): GleifEntity {
  return {
    lei, legalName: "First Bank", jurisdiction: "US-TX", legalCountry: "US", legalRegion: "US-TX", legalState: "TX", legalCity: null, hqCountry: "US",
    category: null, legalFormId: null, entityStatus: "ACTIVE", registrationStatus: "ISSUED", registeredAtId: NIC, registeredAs: "0012345",
    lastUpdate: null, nextRenewal: null, raw: {}, ...over,
  };
}

function inst(id: number, over: Partial<LeiUniverseInstitution> = {}): LeiUniverseInstitution {
  return { id, source: "fdic", lei: null, rssd: null, cert: null, charter: null, name: "First Bank", state: "TX", ...over };
}

const linked = (id: number, lei: string, basis: LeiLinkRow["basis"]): LeiLinkRow => ({ institutionId: id, status: "linked", lei, basis, key: "k", candidates: [], reason: null });

describe("GLEIF LEI matching", () => {
  it("finds each regulator's registration authority by name", () => {
    const list = [{ id: NIC, name: "National Information Center" }, { id: "RA1", name: "Federal Deposit Insurance Corporation" }, { id: "RA2", name: "Companies House" }];
    expect(keyAuthorities(list, "rssd").map((a) => a.id)).toEqual([NIC]);
    expect(keyAuthorities(list, "fdic_cert").map((a) => a.id)).toEqual(["RA1"]);
    expect(keyAuthorities(list, "ncua_charter")).toEqual([]);
  });

  it("links by RSSD with leading zeros dropped, and never links a key two institutions share or two records carry", () => {
    const universe = [inst(1, { rssd: "12345" }), inst(2, { rssd: "777" }), inst(3, { rssd: "888" }), inst(4, { rssd: "888" }), inst(5, { rssd: "999" })];
    const entities = [
      entity(A),
      entity(B, { registeredAs: "999" }),
      entity("529900AAAAAAAAAAAA11", { registeredAs: "999" }),
      entity("529900BBBBBBBBBBBB22", { registeredAs: "888" }),
      // Another authority's id is ignored even when the number matches.
      entity("529900CCCCCCCCCCCC33", { registeredAs: "777", registeredAtId: "RA999" }),
      // A retired record is not linked.
      entity("529900DDDDDDDDDDDD44", { registeredAs: "777", registrationStatus: "RETIRED" }),
    ];
    const p = proposeByKey(universe, entities, "rssd", new Set([NIC]));
    expect(p.get(1)).toMatchObject({ kind: "linked", lei: A, key: "12345" });
    expect(p.get(2)).toMatchObject({ kind: "none" });
    expect(p.get(3)).toMatchObject({ kind: "ambiguous", reason: expect.stringContaining("2 tracked institutions") });
    expect(p.get(5)).toMatchObject({ kind: "ambiguous", candidates: ["529900AAAAAAAAAAAA11", B].sort() });
  });

  it("uses a cert only for FDIC rows and a charter only for NCUA rows", () => {
    const universe = [inst(1, { cert: "12345" }), inst(2, { source: "ncua", cert: "12345", charter: "12345" })];
    expect(proposeByKey(universe, [entity(A)], "fdic_cert", new Set([NIC])).has(2)).toBe(false);
    expect(proposeByKey(universe, [entity(A)], "ncua_charter", new Set([NIC])).has(1)).toBe(false);
  });

  it("links by exact name and state only, with one record", () => {
    expect(normalizeLegalName("First Bank & Trust, N.A.")).toBe("FIRST BANK AND TRUST N A");
    expect(proposeByNameState(inst(1), [entity(A, { legalName: "FIRST BANK" })])).toMatchObject({ kind: "linked", lei: A, key: "FIRST BANK|TX" });
    expect(proposeByNameState(inst(1), [entity(A, { legalState: "OK" })])).toMatchObject({ kind: "none" });
    expect(proposeByNameState(inst(1), [entity(A, { legalName: "First Bank Texas" })])).toMatchObject({ kind: "none" });
    expect(proposeByNameState(inst(1), [entity(A), entity(B)])).toMatchObject({ kind: "ambiguous", candidates: [A, B] });
    expect(proposeByNameState(inst(1, { state: null }), [])).toMatchObject({ kind: "none", reason: expect.stringContaining("no name or state") });
  });

  it("lets a key replace a name match, never the other way round", () => {
    const byName = linked(1, B, "name_state");
    expect(mergeLeiLink(byName, { kind: "linked", basis: "rssd", lei: A, key: "1" }, 1)).toMatchObject({ status: "linked", lei: A, basis: "rssd" });
    expect(mergeLeiLink(linked(1, A, "rssd"), { kind: "linked", basis: "name_state", lei: B, key: "X|TX" }, 1)).toBeNull();
  });

  it("marks two keys that disagree ambiguous, and keeps the stronger basis when they agree", () => {
    const own = linked(1, A, "own_lei");
    expect(mergeLeiLink(own, { kind: "linked", basis: "rssd", lei: A, key: "1" }, 1)).toBeNull();
    const disagree = mergeLeiLink(own, { kind: "linked", basis: "rssd", lei: B, key: "1" }, 1)!;
    expect(disagree).toMatchObject({ status: "ambiguous", basis: "own_lei", candidates: [A, B].sort(), lei: null });
    // Still in review on the next run of either key.
    expect(mergeLeiLink(disagree, { kind: "linked", basis: "own_lei", lei: A, key: A }, 1)).toBeNull();
  });

  it("clears a key link that its own key no longer finds, and leaves other bases alone", () => {
    const none = { kind: "none", basis: "rssd", key: "1", reason: "gone" } as const;
    expect(mergeLeiLink(linked(1, A, "rssd"), none, 1)).toMatchObject({ status: "unmatched", lei: null, basis: null });
    expect(mergeLeiLink(linked(1, A, "fdic_cert"), none, 1)).toBeNull();
    expect(mergeLeiLink(null, none, 1)).toBeNull();
    expect(mergeLeiLink(null, { kind: "none", basis: "name_state", key: null, reason: "no match" }, 1)).toMatchObject({ status: "unmatched" });
  });

  it("takes an institution's own LEI as the strongest link", () => {
    expect(proposeOwnLei([inst(1, { lei: ` ${A.toLowerCase()} ` }), inst(2, { lei: "bad" })])).toEqual(new Map([[1, { kind: "linked", basis: "own_lei", key: A, lei: A }]]));
  });
});
