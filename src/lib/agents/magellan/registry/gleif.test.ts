import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { leiShard } from "@/lib/regulatory/gleif";
import { gleifRegistryPartitions, runRegistryGleif } from "./gleif";
import type { RegistryDb } from "./partitions";

const LEI_BANK = "5493001KJTIIGC8Y1R12";
const LEI_HOLDCO = "549300ABCDEFGHIJKL34";
const LEI_SIBLING = "549300ZZZZZZZZZZZZ56";

function createDb(relLeis: string[] = []) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("FROM institution_sources")) return Promise.resolve([{ id: 1, lei: LEI_BANK, rssd_id: "555" }, { id: 2, lei: null, rssd_id: "123456" }]);
    if (text.includes("SELECT child_lei AS lei")) return Promise.resolve(relLeis.map((lei) => ({ lei })));
    if (text.includes("INSERT INTO gleif_relationships") || text.includes("INSERT INTO gleif_entities")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
      return Promise.resolve(payload.map(() => ({})));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partition = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return { status: insert.values[2], detail: JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string) };
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const record = (lei: string, registeredAt: string, registeredAs: string) => ({
  id: lei,
  attributes: {
    lei,
    entity: {
      legalName: { name: `Entity ${lei.slice(-4)}` },
      legalAddress: { country: "US", region: "US-TX", city: "Houston" },
      headquartersAddress: { country: "US" },
      registeredAt: { id: registeredAt },
      registeredAs,
      jurisdiction: "US-TX",
      category: "GENERAL",
      legalForm: { id: "XXXX" },
      status: "ACTIVE",
    },
    registration: { status: "ISSUED", lastUpdateDate: "2026-09-01", nextRenewalDate: "2027-09-01" },
  },
});

describe("registry gleif", () => {
  it("lists level 2 first", () => {
    expect(gleifRegistryPartitions(new Date())[0]).toBe("level2");
  });

  it("level2 keeps our LEIs' parents and their families", async () => {
    const rr = zipSync({
      "rr.csv": strToU8(
        [
          "Relationship.StartNode.NodeID,Relationship.StartNode.NodeIDType,Relationship.EndNode.NodeID,Relationship.EndNode.NodeIDType,Relationship.RelationshipType,Relationship.RelationshipStatus,Registration.RegistrationStatus",
          `${LEI_BANK},LEI,${LEI_HOLDCO},LEI,IS_ULTIMATELY_CONSOLIDATED_BY,ACTIVE,PUBLISHED`,
          `${LEI_SIBLING},LEI,${LEI_HOLDCO},LEI,IS_ULTIMATELY_CONSOLIDATED_BY,ACTIVE,PUBLISHED`,
          `529900OTHEROTHER0078,LEI,529900UNRELATED00099,LEI,IS_ULTIMATELY_CONSOLIDATED_BY,ACTIVE,PUBLISHED`,
        ].join("\n"),
      ),
    });
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("golden-copies") ? json({ data: { publish_date: "2026-10-17 08:00:00", rr: { full_file: { csv: { url: "https://g/rr.zip" } } } } }) : new Response(rr as unknown as BodyInit, { status: 200 }),
    ) as unknown as typeof fetch;
    const { db, statements } = createDb();
    const r = await runRegistryGleif({ partitionKey: "level2", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ seeds: 1, relationships: 2, writtenRows: 2, publishDate: "2026-10-17 08:00:00", empty: false });
    const { status, detail } = partition(statements);
    expect(status).toBe("succeeded");
    expect(detail.checks).toMatchObject({ seeds_with_parent: 1, parents: 1, kept: 2 });
    expect(detail.terms_url).toContain("gleif.org");
  });

  it("level2 names a missing golden-copy field and loads nothing", async () => {
    const fetchImpl = vi.fn(async () => json({ data: { publish_date: "2026-10-17" } })) as unknown as typeof fetch;
    const { db, statements } = createDb();
    const r = await runRegistryGleif({ partitionKey: "level2", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ empty: true, missingFields: ["data.rr.full_file.csv.url"] });
    expect(partition(statements).status).toBe("empty");
  });

  it("level1 reads the shard's LEIs, links by LEI or by RSSD, and keeps the rest unlinked", async () => {
    const leis = [LEI_BANK, LEI_HOLDCO, LEI_SIBLING];
    const shard = leiShard(LEI_BANK);
    const inShard = leis.filter((l) => leiShard(l) === shard);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("registration-authorities")) return json({ meta: { pagination: { lastPage: 1 } }, data: [{ id: "RA000602", attributes: { code: "RA000602", internationalName: "National Information Center" } }] });
      return json({ data: inShard.map((l) => (l === LEI_BANK ? record(l, "RA000111", "TX-1") : record(l, "RA000602", "123456"))) });
    }) as unknown as typeof fetch;
    const { db, statements } = createDb([LEI_HOLDCO, LEI_SIBLING]);
    const r = await runRegistryGleif({ partitionKey: `level1-${shard}`, db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.entities).toBe(inShard.length);
    const insert = statements.find((s) => s.text.includes("INSERT INTO gleif_entities"))!;
    const rows = JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
    const bank = rows.find((x: { lei: string }) => x.lei === LEI_BANK);
    expect(bank).toMatchObject({ institution_id: 1, link_method: "lei", rssd_id: null });
    for (const other of rows.filter((x: { lei: string }) => x.lei !== LEI_BANK)) {
      // Both carry RSSD 123456, which institution 2 holds; they link by RSSD.
      expect(other).toMatchObject({ rssd_id: "123456", institution_id: 2, link_method: "rssd" });
    }
    expect(partition(statements).detail.rssd_authorities).toEqual(["RA000602: National Information Center"]);
  });

  it("rejects an unknown partition", async () => {
    await expect(runRegistryGleif({ partitionKey: "level1-99", db: createDb().db })).rejects.toThrow(/Invalid GLEIF/);
  });
});
