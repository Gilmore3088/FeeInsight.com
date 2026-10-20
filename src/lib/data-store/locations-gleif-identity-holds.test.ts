import { beforeEach, describe, expect, it, vi } from "vitest";
const { db } = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("./connection", () => ({ sql: db }));
import { fdicIdentityHoldFingerprint, type FdicIdentityHoldInput } from "@/lib/data-store/fdic-identity-holds";
import { getCorporateFamily, getInstitutionLeiLink, getLeiLinkCoverage, getGleifLinkSummary } from "./locations-gleif-aggregates";
const A = "5493001KJTIIGC8Y1R12";
const B = "549300ABCDEFGHIJKL34";
const C = "549300ZZZZZZZZZZZZ56";
function holdRow(institutionId: number | null, certificate: string, implicatedLeis: string[]) {
  const input: FdicIdentityHoldInput = { institutionId, certificate, reason: "shared_lei", storedLei: implicatedLeis[0], implicatedLeis,
    reportedLeis: implicatedLeis, ownerCertificates: [certificate, "999"], evidence: {} };
  return { id: 1, fingerprint: fdicIdentityHoldFingerprint(input), institution_id: institutionId, certificate, reason: input.reason,
    stored_lei: input.storedLei, implicated_leis: implicatedLeis, reported_leis: implicatedLeis, owner_certificates: input.ownerCertificates,
    evidence: {}, source_url: "https://api.fdic.gov/banks/institutions", source_sha256: "a".repeat(64), observed_at: "2026-10-19T00:00:00Z", agent_run_id: 1 };
}
const statements: string[] = [];
let holds: unknown[];
let missingSchema: boolean;
beforeEach(() => {
  holds = [];
  missingSchema = false;
  statements.length = 0;
  db.mockImplementation((strings: string[]) => {
    const text = strings.join(" "); statements.push(text);
    if (text.includes("FROM institution_identity_holds") && !text.includes("WITH trusted")) {
      if (missingSchema) return Promise.reject(new Error("relation institution_identity_holds does not exist"));
      return Promise.resolve(holds);
    }
    if (text.includes("SELECT s.source, s.cert_number")) return Promise.resolve([{ source: "fdic", cert_number: "99" }]);
    if (text.includes("SELECT e.lei, e.ultimate_parent_lei")) return Promise.resolve([{ lei: A, ultimate_parent_lei: A }]);
    if (text.includes("FROM leis l")) return Promise.resolve([
      { lei: A, legal_name: "Root", direct_parent_lei: null, institution_id: 1, institution_name: "First Bank", identity_source: "fdic", identity_certificate: "99", link_method: "lei", has_record: true },
      { lei: B, legal_name: "Held member", direct_parent_lei: A, institution_id: 2, institution_name: "Second Bank", identity_source: "fdic", identity_certificate: "100", link_method: "rssd", has_record: true },
    ]);
    if (text.includes("l.lei AS linked_lei")) return Promise.resolve([
      { id: 1, source: "fdic", cert_number: "99", own_lei: A, linked_lei: A, status: "linked", match_basis: "own_lei" },
      { id: 2, source: "fdic", cert_number: "100", own_lei: B, linked_lei: B, status: "linked", match_basis: "rssd" },
      { id: 3, source: "ncua", cert_number: null, own_lei: C, linked_lei: C, status: "linked", match_basis: "ncua_charter" },
    ]);
    if (text.includes("l.status, TRIM(l.lei)")) return Promise.resolve([{ id: 1, source: "fdic", cert_number: "99", own_lei: A, status: "linked", lei: A, match_basis: "own_lei", reason: null }]);
    if (text.includes("WITH trusted")) return Promise.resolve([{ entities: 3, linked_by_lei: 0, linked_by_rssd: 0, unlinked: 3, with_parent: 1, relationships: 2, latest_publish: "2026-10-19" }]);
    return Promise.resolve([]);
  });
});

describe("GLEIF readers respect durable holds", () => {
  it("does not use a cached entity institution ID to restore a held family root", async () => {
    holds = [holdRow(1, "99", [A])];
    expect(await getCorporateFamily(1)).toMatchObject({ institution_leis: [], tree: null, members: 0, source_note: expect.stringContaining("FDIC identity hold") });
    expect(statements.some((text) => text.includes("SELECT e.lei, e.ultimate_parent_lei"))).toBe(false);
  });

  it("blocks a root LEI implicated by an untracked owner", async () => {
    holds = [holdRow(null, "999", [A])];
    expect(await getCorporateFamily(1)).toMatchObject({ institution_leis: [], tree: null, members: 0 });
  });

  it("retains source family facts but removes held cached member identity labels", async () => {
    holds = [holdRow(2, "100", [B])];
    const family = await getCorporateFamily(1);
    expect(family).toMatchObject({ members: 2, linked_members: 1, unlinked_members: 1 });
    expect(family.tree?.children[0]).toMatchObject({ lei: B, legal_name: "Held member", institution_id: null, institution_name: null, link_method: null });
  });

  it("overlays canonical-link and coverage counts without accepting held keys", async () => {
    holds = [holdRow(1, "99", [A]), { ...holdRow(null, "999", [B]), id: 2 }];
    expect(await getInstitutionLeiLink(1)).toMatchObject({ status: "ambiguous", lei: null, match_basis: null, reason: expect.stringContaining("FDIC identity hold") });
    expect(await getLeiLinkCoverage()).toMatchObject({ institutions: 3, linked: 1, ambiguous: 2, linked_by_basis: { ncua_charter: 1 } });
  });

  it("filters held global accepted-link counts, including certificates and implicated LEIs", async () => {
    await getGleifLinkSummary();
    const query = statements.find((text) => text.includes("WITH trusted"))!;
    expect(query).toContain("h.institution_id=e.institution_id");
    expect(query).toContain("ANY(h.implicated_leis)");
    expect(query).toContain("s.cert_number=h.certificate");
    expect(query).toContain("institution_id IS NULL OR NOT identity_trusted");
  });

  it("fails closed on missing durable hold schema", async () => {
    missingSchema = true;
    await expect(getCorporateFamily(1)).rejects.toThrow("institution_identity_holds");
    await expect(getInstitutionLeiLink(1)).rejects.toThrow("institution_identity_holds");
    await expect(getLeiLinkCoverage()).rejects.toThrow("institution_identity_holds");
    await expect(getGleifLinkSummary()).rejects.toThrow("institution_identity_holds");
  });
});
