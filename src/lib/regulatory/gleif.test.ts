import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  checkRelationships,
  createGleifLinker,
  familyRelationships,
  fetchRelationships,
  gleifPartitions,
  level1ShardOf,
  normalizeLei,
  parseGoldenCopyIndex,
  parseLeiRecords,
  parseRegistrationAuthorities,
  rssdAuthorities,
  rssdOf,
} from "./gleif";

const LEI_BANK = "5493001KJTIIGC8Y1R12";
const LEI_HOLDCO = "549300ABCDEFGHIJKL34";
const LEI_SIBLING = "549300ZZZZZZZZZZZZ56";
const LEI_OTHER = "529900OTHEROTHER0078";

function leiRecord(lei: string, over: Record<string, unknown> = {}) {
  return {
    type: "lei-records",
    id: lei,
    attributes: {
      lei,
      entity: {
        legalName: { name: `Entity ${lei.slice(-4)}`, language: "en" },
        legalAddress: { country: "US", region: "US-TX", city: "Houston", postalCode: "77002" },
        headquartersAddress: { country: "US", region: "US-TX" },
        registeredAt: { id: "RA000999", other: null },
        registeredAs: "123456",
        jurisdiction: "US-TX",
        category: "GENERAL",
        legalForm: { id: "XXXX" },
        status: "ACTIVE",
        ...over,
      },
      registration: { status: "ISSUED", lastUpdateDate: "2026-09-01T00:00:00Z", nextRenewalDate: "2027-09-01T00:00:00Z" },
    },
  };
}

const RR_HEADER = "Relationship.StartNode.NodeID,Relationship.StartNode.NodeIDType,Relationship.EndNode.NodeID,Relationship.EndNode.NodeIDType,Relationship.RelationshipType,Relationship.RelationshipStatus,Registration.RegistrationStatus";
const RR_ROWS = [
  `${LEI_BANK},LEI,${LEI_HOLDCO},LEI,IS_DIRECTLY_CONSOLIDATED_BY,ACTIVE,PUBLISHED`,
  `${LEI_BANK},LEI,${LEI_HOLDCO},LEI,IS_ULTIMATELY_CONSOLIDATED_BY,ACTIVE,PUBLISHED`,
  `${LEI_SIBLING},LEI,${LEI_HOLDCO},LEI,IS_ULTIMATELY_CONSOLIDATED_BY,ACTIVE,PUBLISHED`,
  `${LEI_OTHER},LEI,${LEI_SIBLING},LEI,IS_FUND-MANAGED_BY,ACTIVE,PUBLISHED`,
  `${LEI_OTHER},LEI,529900UNRELATED00099,LEI,IS_DIRECTLY_CONSOLIDATED_BY,ACTIVE,PUBLISHED`,
];

describe("partitions", () => {
  it("runs level 2 first, then eight level-1 shards", () => {
    const p = gleifPartitions();
    expect(p[0]).toBe("level2");
    expect(p).toHaveLength(9);
    expect(level1ShardOf("level1-7")).toBe(7);
    expect(level1ShardOf("level1-8")).toBeNull();
  });

  it("accepts only well-formed LEIs", () => {
    expect(normalizeLei(` ${LEI_BANK.toLowerCase()} `)).toBe(LEI_BANK);
    expect(normalizeLei("123")).toBeNull();
  });
});

describe("parseLeiRecords", () => {
  it("reads entity fields and the US state from the region", () => {
    const read = parseLeiRecords({ data: [leiRecord(LEI_BANK), { attributes: { lei: "bad" } }] });
    expect(read.valid).toBe(true);
    expect(read.entities).toHaveLength(1);
    expect(read.entities[0]).toMatchObject({ lei: LEI_BANK, legalState: "TX", legalCountry: "US", registeredAtId: "RA000999", registeredAs: "123456", registrationStatus: "ISSUED" });
    expect(read.skipped).toEqual({ bad_lei: 1 });
    expect(read.missingFields).toEqual([]);
  });

  it("names attribute paths no record carried", () => {
    const rec = leiRecord(LEI_BANK);
    delete (rec.attributes.entity as Record<string, unknown>).registeredAs;
    expect(parseLeiRecords({ data: [rec] }).missingFields).toEqual(["entity.registeredAs"]);
    expect(parseLeiRecords({ errors: [] })).toMatchObject({ valid: false, missingFields: ["data"] });
  });
});

describe("RSSD ids", () => {
  it("finds the National Information Center by name and reads RSSD only from it", () => {
    const parsed = parseRegistrationAuthorities({
      meta: { pagination: { lastPage: 1 } },
      data: [
        { id: "RA000999", attributes: { code: "RA000999", internationalName: "National Information Center", internationalOrganizationName: "Federal Reserve" } },
        { id: "RA000111", attributes: { code: "RA000111", internationalName: "Texas Secretary of State" } },
      ],
    });
    const ids = new Set(rssdAuthorities(parsed.authorities).map((a) => a.id));
    expect([...ids]).toEqual(["RA000999"]);
    expect(rssdOf({ registeredAtId: "RA000999", registeredAs: "0123456" }, ids)).toBe("123456");
    expect(rssdOf({ registeredAtId: "RA000111", registeredAs: "123456" }, ids)).toBeNull();
  });
});

describe("createGleifLinker", () => {
  it("links by LEI, then by RSSD, and leaves the rest unlinked", () => {
    const link = createGleifLinker([
      { id: 1, lei: LEI_BANK.toLowerCase(), rssd: null },
      { id: 2, lei: null, rssd: "777" },
      { id: 3, lei: null, rssd: "888" },
      { id: 4, lei: null, rssd: "888" },
    ]);
    expect(link(LEI_BANK, null)).toEqual({ institutionId: 1, method: "lei", ambiguous: false });
    expect(link(LEI_HOLDCO, "777")).toEqual({ institutionId: 2, method: "rssd", ambiguous: false });
    expect(link(LEI_HOLDCO, "888")).toEqual({ institutionId: null, method: null, ambiguous: true });
    expect(link(LEI_OTHER, null)).toEqual({ institutionId: null, method: null, ambiguous: false });
  });
});

describe("golden copy", () => {
  it("reads the RR CSV link and publish date, naming what is missing", () => {
    expect(parseGoldenCopyIndex({ data: { publish_date: "2026-10-17 08:00:00", rr: { full_file: { csv: { url: "https://g/rr.zip" } } } } })).toEqual({ publishDate: "2026-10-17 08:00:00", rrCsvUrl: "https://g/rr.zip", missingFields: [] });
    expect(parseGoldenCopyIndex({ data: {} }).missingFields).toEqual(["data.publish_date", "data.rr.full_file.csv.url"]);
  });

  it("streams consolidation relationships from the zip and keeps our families", async () => {
    const zip = zipSync({ "20261017-gleif-goldencopy-rr-golden-copy.csv": strToU8([RR_HEADER, ...RR_ROWS].join("\n")) });
    const fetchImpl = (async () => new Response(zip as unknown as BodyInit, { status: 200 })) as unknown as typeof fetch;
    const read = await fetchRelationships("https://g/rr.zip", { fetchImpl, backoffMs: 0 });
    expect(read.missingFields).toEqual([]);
    expect(read.rows).toBe(5);
    expect(read.relationships).toHaveLength(4);
    expect(read.skipped).toEqual({ "other_type:IS_FUND-MANAGED_BY": 1 });
    const seeds = new Set([LEI_BANK]);
    const { kept, parents } = familyRelationships(read.relationships, seeds);
    expect([...parents]).toEqual([LEI_HOLDCO]);
    expect(kept.map((r) => `${r.childLei}>${r.kind}`)).toEqual([`${LEI_BANK}>direct`, `${LEI_BANK}>ultimate`, `${LEI_SIBLING}>ultimate`]);
    expect(checkRelationships(read, kept, seeds, parents)).toMatchObject({ kept: 3, seeds_with_parent: 1, conflicting_parents: 0 });
  });

  it("names RR columns the file does not carry", async () => {
    const zip = zipSync({ "rr.csv": strToU8("Start,End\nA,B\n") });
    const fetchImpl = (async () => new Response(zip as unknown as BodyInit, { status: 200 })) as unknown as typeof fetch;
    const read = await fetchRelationships("https://g/rr.zip", { fetchImpl, backoffMs: 0 });
    expect(read.missingFields).toContain("Relationship.StartNode.NodeID");
    expect(read.relationships).toEqual([]);
  });
});
