import { describe, expect, it } from "vitest";
import { matchHmdaIdentities, normalizeHmdaRssd, planHmdaIdentityRepair, summarizeHmdaMatching, type HmdaInstitutionIdentity } from "./hmda-identity";

const A = "549300OSSFHX7ABQ2Y81";
const B = "5493001KJTIIGC8Y1R12";
const C = "254900B5PW4JPZAQI721";
const bank = (id: number, lei: string | null, rssdId: string | null = null): HmdaInstitutionIdentity => ({ id, lei, rssdId });
const match = (institutions: HmdaInstitutionIdentity[], rssdId: string | null = null) => matchHmdaIdentities([{ lei: A, rssdId }], institutions)[0];

describe("HMDA exact institution identity", () => {
  it("matches a normalized own LEI without a retired panel", () => {
    expect(match([bank(7, ` ${A.toLowerCase()} `)])).toMatchObject({ status: "matched", institutionId: 7, method: "lei" });
  });

  it.each(["own_lei", "rssd", "fdic_cert", "ncua_charter"])("uses a canonical linked LEI backed by %s", (basis) => {
    expect(match([{ ...bank(8, null), leiLink: { status: "linked", lei: A, basis } }])).toMatchObject({ status: "matched", institutionId: 8, method: "lei" });
  });

  it.each(["name_state", null])("does not promote a weak/unexplained canonical link (%s)", (basis) => {
    expect(match([{ ...bank(8, null), leiLink: { status: "linked", lei: A, basis } }])).toMatchObject({ status: "unmatched", institutionId: null });
  });

  it("does not use unmatched canonical proposals", () => {
    expect(match([{ ...bank(8, null), leiLink: { status: "unmatched", lei: A, basis: "rssd" } }]).institutionId).toBeNull();
  });

  it("matches only the respondent's normalized RSSD", () => {
    expect(match([bank(8, null, "480228")], "000480228")).toMatchObject({ status: "matched", institutionId: 8, method: "rssd" });
  });

  it("freezes the publisher identity and registry capture time without inventing a source URL", () => {
    const row = match([{ ...bank(7, A, "480228"), source: "fdic", certNumber: "42", registrySyncedAt: "2026-10-19T00:00:00Z" }]);
    expect(row.evidence).toEqual([{
      institutionId: 7, kind: "institution_lei", lei: A, rssdId: "480228", source: "fdic", certNumber: "42",
      registrySyncedAt: "2026-10-19T00:00:00Z", linkBasis: null, linkKey: null, sourceUrl: null, checkedAt: null,
    }]);
  });

  it("freezes key-backed canonical crosswalk provenance separately from a direct publisher LEI", () => {
    const row = match([{ ...bank(8, null), leiLink: {
      status: "linked", lei: A, basis: "fdic_cert", matchKey: "42", sourceUrl: "https://api.gleif.org/record", checkedAt: "2026-10-18T00:00:00Z",
    } }]);
    expect(row.evidence).toEqual([expect.objectContaining({ kind: "canonical_lei_link", institutionId: 8, lei: A,
      linkBasis: "fdic_cert", linkKey: "42", sourceUrl: "https://api.gleif.org/record", checkedAt: "2026-10-18T00:00:00Z" })]);
  });

  it("keeps both contradictory own and linked LEIs in a blocked candidate snapshot", () => {
    const row = match([{ ...bank(8, A, "480228"), source: "fdic", certNumber: "42", leiLink: {
      status: "linked", lei: B, basis: "fdic_cert", matchKey: "42", candidates: [],
      sourceUrl: "https://api.gleif.org/record", checkedAt: "2026-10-18T00:00:00Z",
    } }]);
    expect(row).toMatchObject({ status: "ambiguous", reason: "canonical_lei_conflict" });
    expect(row.canonicalSnapshots).toEqual([{
      id: 8, lei: A, rssdId: "480228", source: "fdic", certNumber: "42", registrySyncedAt: null,
      leiLink: { status: "linked", lei: B, basis: "fdic_cert", candidates: [], matchKey: "42",
        sourceUrl: "https://api.gleif.org/record", checkedAt: "2026-10-18T00:00:00Z" },
    }]);
    expect(row.evidence).toEqual([expect.objectContaining({ kind: "institution_lei", lei: A })]);
  });

  it("freezes an ambiguous review's full candidates and source facts even without accepted key evidence", () => {
    const institution: HmdaInstitutionIdentity = { ...bank(8, null), leiLink: {
      status: "ambiguous", lei: null, basis: "rssd", matchKey: "480228", candidates: [A, B],
      sourceUrl: "https://api.gleif.org/records", checkedAt: "2026-10-18T00:00:00Z",
    } };
    const row = match([institution]);
    expect(row).toMatchObject({ status: "ambiguous", reason: "canonical_lei_conflict", evidence: [],
      canonicalSnapshots: [{ id: 8, lei: null, leiLink: { status: "ambiguous", lei: null,
        basis: "rssd", matchKey: "480228", candidates: [A, B], sourceUrl: "https://api.gleif.org/records",
        checkedAt: "2026-10-18T00:00:00Z" } }] });
    institution.leiLink!.candidates!.push(C);
    institution.leiLink!.status = "linked";
    expect(row.canonicalSnapshots[0].leiLink).toMatchObject({ status: "ambiguous", candidates: [A, B] });
  });

  it("captures every competing canonical owner in stable candidate ID order", () => {
    const row = match([bank(9, A), bank(1, A)]);
    expect(row.canonicalSnapshots.map((candidate) => candidate.id)).toEqual([1, 9]);
    expect(match([bank(7, A)]).canonicalSnapshots).toEqual([expect.objectContaining({ id: 7, lei: A, leiLink: null })]);
    expect(match([bank(7, B)]).canonicalSnapshots).toEqual([]);
  });

  it("holds conflicting panel rows even when a direct LEI could match", () => {
    expect(matchHmdaIdentities([{ lei: A, rssdId: "480228", sourceConflict: true }], [bank(7, A, "480228")])[0])
      .toMatchObject({ status: "ambiguous", institutionId: null, reason: "panel_identity_conflict" });
  });

  it.each([null, "", "0", "0000", "-1", "NA", "480228.0", "4e5"])("does not guess RSSD %s", (rssd) => {
    expect(normalizeHmdaRssd(rssd)).toBeNull();
    expect(match([bank(8, null, "480228")], rssd).institutionId).toBeNull();
  });

  it("rejects a shared direct LEI even when one candidate also has the RSSD", () => {
    expect(match([bank(1, A, "480228"), bank(2, A)], "480228")).toMatchObject({ status: "ambiguous", institutionId: null, reason: "shared_lei", candidateIds: [1, 2] });
  });

  it("rejects a shared canonical LEI", () => {
    expect(match([1, 2].map((id) => ({ ...bank(id, null), leiLink: { status: "linked", lei: A, basis: "fdic_cert" } })))).toMatchObject({ status: "ambiguous", institutionId: null });
  });

  it("rejects a shared RSSD rather than selecting a lowest ID", () => {
    expect(match([bank(2, null, "00480228"), bank(1, null, "480228")], "480228")).toMatchObject({ status: "ambiguous", institutionId: null, reason: "shared_rssd", candidateIds: [1, 2] });
  });

  it("holds a direct LEI and respondent RSSD disagreement", () => {
    expect(match([bank(1, A), bank(2, B, "480228")], "480228")).toMatchObject({ status: "ambiguous", reason: "identifier_disagreement", institutionId: null });
  });

  it("holds disagreement between an own LEI and an accepted canonical key link", () => {
    expect(match([{ ...bank(1, A), leiLink: { status: "linked", lei: B, basis: "fdic_cert" } }])).toMatchObject({ status: "ambiguous", reason: "canonical_lei_conflict" });
  });

  it("respects an existing ambiguous canonical review", () => {
    expect(match([{ ...bank(1, A), leiLink: { status: "ambiguous", lei: null, basis: "rssd", candidates: [A, B] } }])).toMatchObject({ status: "ambiguous", institutionId: null });
  });

  it("does not treat a missing LEI as an alias for a valid respondent", () => {
    expect(matchHmdaIdentities([{ lei: "bad", rssdId: "480228" }], [bank(1, A, "480228")])[0]).toMatchObject({ status: "unmatched", reason: "invalid_lei" });
  });

  it("counts ambiguous and unknown separately from matched", () => {
    const rows = matchHmdaIdentities([{ lei: A, rssdId: null }, { lei: B, rssdId: null }, { lei: C, rssdId: null }], [bank(1, A), bank(2, B), bank(3, B)]);
    expect(summarizeHmdaMatching(rows)).toMatchObject({ matched: 1, ambiguous: 1, unmatched: 1 });
  });
});

describe("bounded HMDA matching review plan", () => {
  const input = () => ({
    year: 2025, leis: [A],
    lenders: [{ year: 2025, lei: A, institutionId: null, matchMethod: null, rssdId: null }],
    institutions: [bank(7, A)],
    cells: [{ year: 2025, lei: A, originationRows: 12, costRows: 6, states: ["VA", "DC", "MD"] }],
  });

  it("plans one annual lender and its children in every state without mutating inputs", () => {
    const values = input(); const before = JSON.stringify(values);
    expect(planHmdaIdentityRepair(values)).toMatchObject({ mode: "review_only", writes: 0, lenderRows: 1, aggregateRows: 18, proposedLenderChanges: 1, rows: [{ beforeInstitutionId: null, institutionId: 7, states: ["DC", "MD", "VA"] }] });
    expect(JSON.stringify(values)).toBe(before);
  });

  it("requires a single valid year and explicit distinct LEIs", () => {
    for (const change of [{ year: 2017 }, { leis: [] }, { leis: [A, A] }, { leis: ["invalid"] }, { leis: Array(26).fill(A) }]) {
      expect(() => planHmdaIdentityRepair({ ...input(), ...change })).toThrow();
    }
  });

  it("refuses a child census over the cap across all states", () => {
    const values = input(); values.cells[0].originationRows = 999; values.cells[0].costRows = 2;
    expect(() => planHmdaIdentityRepair(values)).toThrow(/1000 aggregate/);
  });

  it("requires separate review for existing institution links or match methods", () => {
    const values = input();
    expect(() => planHmdaIdentityRepair({ ...values, lenders: [{ ...values.lenders[0], institutionId: 9 }] })).toThrow(/unlinked/);
    expect(() => planHmdaIdentityRepair({ ...values, lenders: [{ ...values.lenders[0], matchMethod: "lei" }] })).toThrow(/unlinked/);
  });

  it("refuses missing, duplicate and invalid child counts", () => {
    expect(() => planHmdaIdentityRepair({ ...input(), cells: [] })).toThrow(/census/);
    const values = input(); values.cells.push(values.cells[0]);
    expect(() => planHmdaIdentityRepair(values)).toThrow(/census/);
    values.cells = [values.cells[0]]; values.cells[0].costRows = -1;
    expect(() => planHmdaIdentityRepair(values)).toThrow(/count/);
  });

  it("does not propose an arbitrary change when keys are ambiguous", () => {
    expect(planHmdaIdentityRepair({ ...input(), institutions: [bank(1, A), bank(2, A)] })).toMatchObject({ proposedLenderChanges: 0, summary: { ambiguous: 1 }, rows: [{ institutionId: null, changes: false }] });
  });
});
