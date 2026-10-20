import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { fdicIdentityHoldFingerprint, type FdicIdentityHoldInput } from "@/lib/data-store/fdic-identity-holds";
import { leiShard } from "@/lib/regulatory/gleif";
import { gleifRegistryPartitions, runRegistryGleif } from "./gleif";
import type { RegistryDb } from "./partitions";

const LEI_BANK = "5493001KJTIIGC8Y1R12";
const LEI_HOLDCO = "549300ABCDEFGHIJKL34";
const LEI_SIBLING = "549300ZZZZZZZZZZZZ56";

function holdRow(institutionId: number | null, certificate = "99", implicatedLeis = [LEI_BANK]) {
  const input: FdicIdentityHoldInput = { institutionId, certificate, reason: "shared_lei", storedLei: implicatedLeis[0], implicatedLeis,
    reportedLeis: implicatedLeis, ownerCertificates: [certificate, "999"], evidence: { raw: true } };
  return { id: 1, fingerprint: fdicIdentityHoldFingerprint(input), institution_id: institutionId, certificate,
    reason: input.reason, stored_lei: input.storedLei, implicated_leis: input.implicatedLeis, reported_leis: input.reportedLeis,
    owner_certificates: input.ownerCertificates, evidence: input.evidence, source_url: "https://api.fdic.gov/banks/institutions",
    source_sha256: "a".repeat(64), observed_at: "2026-10-19T12:00:00Z", agent_run_id: 123 };
}


function createDb(relLeis: string[] = [], holds: unknown[] = [], atWriteHolds?: unknown[]) {
  let holdReads = 0;
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("FROM institution_identity_holds")) return Promise.resolve(++holdReads > 1 && atWriteHolds ? atWriteHolds : holds);
    if (text.includes("FROM institution_sources")) return Promise.resolve([{ id: 1, source: "fdic", cert_number: "99", lei: LEI_BANK, rssd_id: "555" }, { id: 2, source: "fdic", cert_number: "100", lei: null, rssd_id: "123456" }]);
    if (text.includes("SELECT child_lei AS lei")) return Promise.resolve(relLeis.map((lei) => ({ lei })));
    if (text.includes("INSERT INTO gleif_relationships") || text.includes("INSERT INTO gleif_entities")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
      return Promise.resolve(payload.map(() => ({})));
    }
    return Promise.resolve([]);
  });
  Object.assign(db, { begin: async (cb: (tx: unknown) => unknown) => cb(db) });
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
  it("lists the LEI matches before level 2", () => {
    const p = gleifRegistryPartitions(new Date());
    expect(p.indexOf("lei-match-name")).toBeLessThan(p.indexOf("level2"));
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

  it("excludes held LEIs from family seeds even when an untracked owner caused the hold", async () => {
    const fetchImpl = vi.fn(async () => json({ data: { publish_date: "2026-10-17", rr: { full_file: { csv: { url: "https://g/rr.zip" } } } } })) as unknown as typeof fetch;
    const { db, statements } = createDb([], [holdRow(null, "999")]);
    const result = await runRegistryGleif({ partitionKey: "level2", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(result).toMatchObject({ seeds: 0, empty: true });
    expect(statements.some((statement) => statement.text.includes("INSERT INTO gleif_relationships"))).toBe(false);
  });

  it("rechecks newly inserted holds while the entity write lock is held", async () => {
    const fetchImpl = vi.fn(async (url: string) => url.includes("registration-authorities")
      ? json({ meta: { pagination: { lastPage: 1 } }, data: [] })
      : json({ data: [record(LEI_BANK, "RA000111", "x")] })) as unknown as typeof fetch;
    const { db, statements } = createDb([], [], [holdRow(1)]);
    await runRegistryGleif({ partitionKey: `level1-${leiShard(LEI_BANK)}`, db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    const insert = statements.find((statement) => statement.text.includes("INSERT INTO gleif_entities"))!;
    const rows = JSON.parse(insert.values.find((value) => typeof value === "string" && value.startsWith("[")) as string);
    expect(rows[0]).toMatchObject({ institution_id: null, link_method: null });
    const holdLock = statements.findIndex((statement) => statement.text.includes("LOCK TABLE institution_identity_holds"));
    expect(holdLock).toBeGreaterThan(statements.findIndex((statement) => statement.text.includes("LOCK TABLE institution_sources")));
    expect(holdLock).toBeLessThan(statements.indexOf(insert));
  });

  it("rejects an unknown partition", async () => {
    await expect(runRegistryGleif({ partitionKey: "level1-99", db: createDb().db })).rejects.toThrow(/Invalid GLEIF/);
  });
});

describe("registry gleif LEI match", () => {
  const NIC = "RA000602";
  const universe = [
    { id: 1, source: "fdic", lei: null, rssd_id: "12345", cert_number: "99", ncua_charter_id: null, institution_name: "First Bank", state_code: "TX" },
    { id: 2, source: "fdic", lei: LEI_SIBLING, rssd_id: null, cert_number: null, ncua_charter_id: null, institution_name: "Second Bank", state_code: "TX" },
  ];

  function createMatchDb(opts: { rssdHasRun?: boolean; nameCandidates?: unknown[]; resume?: Record<string, number>; holds?: unknown[]; writeHolds?: unknown[]; missingHolds?: boolean } = {}) {
    const statements: Array<{ text: string; values: unknown[] }> = [];
    let holdReads = 0;
    const fn = vi.fn((strings: unknown, ...values: unknown[]) => {
      if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
      const text = (strings as string[]).join(" ");
      statements.push({ text, values });
      if (text.includes("FROM institution_identity_holds")) {
        if (opts.missingHolds) return Promise.reject(new Error("relation institution_identity_holds does not exist"));
        return Promise.resolve(++holdReads > 1 && opts.writeHolds ? opts.writeHolds : opts.holds ?? []);
      }
      if (text.includes("WHERE s.id IN")) return Promise.resolve([...universe, ...(opts.nameCandidates ?? []) as Array<Record<string, unknown>>]);
      if (text.includes("l.lei AS linked_lei")) return Promise.resolve([{ ...universe[0], status: "linked", linked_lei: LEI_BANK, match_basis: "rssd" }, { ...universe[1], status: null, match_basis: null }]);
      if (text.includes("walk_resume")) return Promise.resolve(opts.resume ? [{ resume: opts.resume }] : []);
      if (text.includes("FROM registry_ingest_partitions")) return Promise.resolve(opts.rssdHasRun ? [{ found: 1 }] : []);
      if (text.includes("LIMIT") && text.includes("LEFT JOIN institution_lei_links")) return Promise.resolve(opts.nameCandidates ?? []);
      if (text.includes("GROUP BY")) return Promise.resolve([{ status: "linked", match_basis: "rssd", n: 1 }, { status: null, match_basis: null, n: 1 }]);
      if (text.includes("FROM institution_sources s")) return Promise.resolve(universe);
      if (text.includes("INSERT INTO institution_lei_links")) {
        const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
        return Promise.resolve(payload.map(() => ({})));
      }
      return Promise.resolve([]);
    });
    const db = Object.assign(fn, { begin: async (cb: (tx: unknown) => unknown) => cb(db), unsafe: (s: string) => s });
    const linkRows = () =>
      statements
        .filter((s) => s.text.includes("INSERT INTO institution_lei_links"))
        .flatMap((s) => JSON.parse(s.values.find((v) => typeof v === "string" && v.startsWith("[")) as string));
    return { db: db as unknown as RegistryDb, statements, linkRows };
  }

  const authorities = () => json({ meta: { pagination: { lastPage: 1 } }, data: [{ id: NIC, attributes: { code: NIC, internationalName: "National Information Center" } }] });

  it("links by RSSD and by an institution's own LEI, in bounded transactions", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes("registration-authorities") ? authorities() : json({ meta: { pagination: { lastPage: 1 } }, data: [record(LEI_BANK, NIC, "0012345")] });
    }) as unknown as typeof fetch;
    const { db, statements, linkRows } = createMatchDb();
    const r = await runRegistryGleif({ partitionKey: "lei-match-rssd", db, fetchOptions: { fetchImpl, backoffMs: 0 }, spacingMs: 0 });
    expect(r.leiMatch).toMatchObject({ changes: 2, remaining: 0 });
    expect(linkRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ institution_id: 1, status: "linked", lei: LEI_BANK, match_basis: "rssd", match_key: "12345" }),
        expect.objectContaining({ institution_id: 2, status: "linked", lei: LEI_SIBLING, match_basis: "own_lei" }),
      ]),
    );
    expect(statements.some((s) => s.text.includes("statement_timeout"))).toBe(true);
    expect(calls[1]).toContain("filter%5Bentity.registeredAt.id%5D=RA000602");
    const { status, detail } = partition(statements);
    expect(status).toBe("succeeded");
    expect(detail).toMatchObject({ walk_complete: true, coverage: { institutions: 2, linked: 1, unchecked: 1 } });
  });

  it("stops a walk whose authority filter did not hold and links nothing by RSSD from it", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("registration-authorities") ? authorities() : json({ meta: { pagination: { lastPage: 5000 } }, data: [record(LEI_BANK, "RA000111", "12345")] }),
    ) as unknown as typeof fetch;
    const { db, statements, linkRows } = createMatchDb();
    await runRegistryGleif({ partitionKey: "lei-match-rssd", db, fetchOptions: { fetchImpl, backoffMs: 0 }, spacingMs: 0 });
    expect(linkRows().map((x: { match_basis: string }) => x.match_basis)).toEqual(["own_lei"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(partition(statements).detail).toMatchObject({ walk_complete: false, walk_problems: [expect.stringContaining("filter did not hold")] });
  });

  it("walks a long register over several runs and never clears links from a partial walk", async () => {
    const pages: number[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("registration-authorities")) return authorities();
      pages.push(Number(/page%5Bnumber%5D=(\d+)/.exec(url)![1]));
      return json({ meta: { pagination: { lastPage: 100 } }, data: [record(LEI_HOLDCO, NIC, "424242")] });
    }) as unknown as typeof fetch;
    const first = createMatchDb();
    await runRegistryGleif({ partitionKey: "lei-match-rssd", db: first.db, fetchOptions: { fetchImpl, backoffMs: 0 }, spacingMs: 0 });
    expect(pages[0]).toBe(1);
    expect(pages).toHaveLength(75);
    expect(partition(first.statements).detail).toMatchObject({ walk_complete: false, walk_resume: { [NIC]: 76 } });

    pages.length = 0;
    const second = createMatchDb({ resume: { [NIC]: 76 } });
    await runRegistryGleif({ partitionKey: "lei-match-rssd", db: second.db, fetchOptions: { fetchImpl, backoffMs: 0 }, spacingMs: 0 });
    expect(pages[0]).toBe(76);
    expect(pages.at(-1)).toBe(100);
    expect(partition(second.statements).detail).toMatchObject({ walk_complete: false, walk_resume: {} });
  });

  it("holds the name search until the RSSD match has run", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { db, statements } = createMatchDb({ rssdHasRun: false });
    const r = await runRegistryGleif({ partitionKey: "lei-match-name", db, fetchOptions: { fetchImpl, backoffMs: 0 }, spacingMs: 0 });
    expect(r.empty).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(partition(statements).status).toBe("empty");
  });

  it("holds own-LEI and RSSD links and rechecks holds arriving after matching", async () => {
    const fetchImpl = vi.fn(async (url: string) => url.includes("registration-authorities") ? authorities()
      : json({ meta: { pagination: { lastPage: 1 } }, data: [record(LEI_BANK, NIC, "12345")] })) as unknown as typeof fetch;
    const { db, linkRows, statements } = createMatchDb({ writeHolds: [holdRow(1), { ...holdRow(2, "100", [LEI_SIBLING]), id: 2 }] });
    await runRegistryGleif({ partitionKey: "lei-match-rssd", db, fetchOptions: { fetchImpl, backoffMs: 0 }, spacingMs: 0 });
    expect(linkRows()).toHaveLength(2);
    expect(linkRows().every((row: { status: string; lei: string | null; reason: string }) => row.status === "ambiguous" && row.lei === null && row.reason.includes("FDIC identity hold"))).toBe(true);
    expect(statements.some((statement) => statement.text.includes("LOCK TABLE institution_identity_holds IN SHARE MODE"))).toBe(true);
  });

  it("fails closed when the durable hold schema is absent", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { db, linkRows } = createMatchDb({ missingHolds: true });
    await expect(runRegistryGleif({ partitionKey: "lei-match-rssd", db, fetchOptions: { fetchImpl, backoffMs: 0 }, spacingMs: 0 })).rejects.toThrow("institution_identity_holds");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(linkRows()).toEqual([]);
  });

  it("links by exact name and state, and records a miss for review", async () => {
    const candidates = [
      { ...universe[0], institution_id: null },
      { ...universe[0], id: 3, institution_name: "Third Bank", institution_id: null },
    ];
    const fetchImpl = vi.fn(async (url: string) => {
      const hit = record(LEI_BANK, "RA000111", "x");
      hit.attributes.entity.legalName = { name: "FIRST BANK" };
      return json({ data: url.includes("First%20Bank") && url.includes("US-TX") ? [hit] : [] });
    }) as unknown as typeof fetch;
    const { db, statements, linkRows } = createMatchDb({ rssdHasRun: true, nameCandidates: candidates });
    await runRegistryGleif({ partitionKey: "lei-match-name", db, fetchOptions: { fetchImpl, backoffMs: 0 }, spacingMs: 0 });
    expect(linkRows()).toEqual([
      expect.objectContaining({ institution_id: 1, status: "linked", lei: LEI_BANK, match_basis: "name_state", match_key: "FIRST BANK|TX" }),
      expect.objectContaining({ institution_id: 3, status: "unmatched", lei: null, match_basis: null }),
    ]);
    // The name pass never overwrites a key-based row.
    expect(statements.find((s) => s.text.includes("INSERT INTO institution_lei_links"))!.text).toContain("match_basis = 'name_state'");
    expect(partition(statements).status).toBe("succeeded");
  });
});
