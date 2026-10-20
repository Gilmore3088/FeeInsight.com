import { describe, expect, it } from "vitest";
import { parseFdicInstitution, type FdicInstitutionRow } from "@/lib/regulatory/fdic";
import { prepareFdicLeiIdentity } from "./fdic-universe";

const lei = "549300OSSFHX7ABQ2Y81";
const other = "5493003GQDUH26DNNH17";
const third = "549300T94GSH3C4U5M59";
const active = (CERT: number, LEI: unknown, NAME: string | null = "Bank") => ({ CERT, LEI, NAME, ACTIVE: 1 });
const prepare = (records: Record<string, unknown>[], known = new Map<string, { id: number | null; lei: string | null; status: string | null }>()) =>
  prepareFdicLeiIdentity(records, records.map(parseFdicInstitution).filter((row): row is FdicInstitutionRow => row !== null), known);

describe("FDIC conflict evidence before profile parsing", () => {
  it("retains an unparseable profile as a shared-key owner", () => {
    const value = prepare([active(1, lei), active(2, lei.toLowerCase(), null)]);
    expect(value.rows).toHaveLength(1);
    expect(value.rows[0].lei).toBeNull();
    expect(value.holds).toEqual(expect.arrayContaining([
      expect.objectContaining({ certificate: "1", reason: "shared_lei", ownerCertificates: ["1", "2"] }),
      expect.objectContaining({ certificate: "2", institutionId: null, reason: "shared_lei" }),
    ]));
  });

  it("holds every source LEI and the preserved stored key in a certificate conflict", () => {
    const value = prepare([active(1, lei), active(1, other)], new Map([
      ["1", { id: 5, lei: third, status: "active" }],
    ]));
    expect(value.rows).toHaveLength(1);
    expect(value.rows[0].lei).toBeNull();
    expect(value.holds).toEqual(expect.arrayContaining([expect.objectContaining({ certificate: "1", institutionId: 5,
      reason: "source_certificate_conflict", implicatedLeis: [other, lei, third].sort(), reportedLeis: [lei, other].sort() })]));
    expect(value.report.conflicts).toHaveLength(2);
  });

  it.each([null, "", "malformed"])("holds a duplicate certificate with valid and %s source keys", (missing) => {
    const value = prepare([active(1, lei), active(1, missing)]);
    expect(value.rows[0].lei).toBeNull();
    expect(value.holds).toHaveLength(1);
    expect(value.holds[0]).toMatchObject({ reason: "source_certificate_conflict", implicatedLeis: [lei] });
  });

  it("deduplicates equivalent certificate rows without inventing a conflict", () => {
    const value = prepare([active(1, lei), active(1, ` ${lei.toLowerCase()} `)]);
    expect(value.rows).toHaveLength(1);
    expect(value.rows[0].lei).toBe(lei);
    expect(value.holds).toEqual([]);
  });

  it("uses a stable logical snapshot hash across row and object-key order", () => {
    const records = [active(1, lei), active(2, other)];
    const reversed = [...records].reverse().map((row) => Object.fromEntries(Object.entries(row).reverse()));
    const first = prepare(records).report.logical_snapshot_sha256;
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(prepare(reversed).report.logical_snapshot_sha256).toBe(first);
    expect(prepare([active(1, other), active(2, other)]).report.logical_snapshot_sha256).not.toBe(first);
  });

  it("records a stored mismatch even when shared source evidence has already held the new value", () => {
    const value = prepare([active(1, lei), active(2, lei)], new Map([["1", { id: 7, lei: other, status: "inactive" }]]));
    expect(value.report.conflicts).toEqual([{ certificate: "1", stored_lei: other, reported_lei: lei }]);
    expect(value.holds).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "stored_lei_conflict",
      institutionId: 7, implicatedLeis: [other, lei].sort() })]));
  });

  it.each(["inactive", "active", null])("counts the preserved key of an absent %s owner before accepting a new certificate", (status) => {
    const value = prepare([active(2, lei)], new Map([["1", { id: 7, lei: ` ${lei.toLowerCase()} `, status }]]));
    expect(value.rows[0].lei).toBeNull();
    expect(value.report.duplicate_leis).toEqual([{
      lei, certificates: ["1", "2"], reported_values: [{ certificate: "2", value: lei }],
      preserved_values: [{ certificate: "1", value: ` ${lei.toLowerCase()} `, institution_id: 7, regulatory_status: status }],
    }]);
    expect(value.holds).toEqual([
      expect.objectContaining({ certificate: "1", institutionId: 7, reason: "shared_lei", implicatedLeis: [lei], ownerCertificates: ["1", "2"] }),
      expect.objectContaining({ certificate: "2", institutionId: null, reason: "shared_lei", implicatedLeis: [lei], ownerCertificates: ["1", "2"] }),
    ]);
  });

  it("does not create a conflict merely because the reported certificate already owns the key", () => {
    const value = prepare([active(1, lei)], new Map([["1", { id: 7, lei, status: "active" }]]));
    expect(value.rows[0].lei).toBe(lei);
    expect(value.holds).toEqual([]);
  });
});
