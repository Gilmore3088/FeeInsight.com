import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REGISTRY_SOURCES } from "@/lib/agents/magellan/registry/index";
import { HOOVIE_SOURCES, hoovieSourceContract } from "./sources";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

function migrationTables(): Set<string> {
  const tables = new Set<string>();
  for (const file of readdirSync(MIGRATIONS)) {
    if (!file.endsWith(".sql")) continue;
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const match of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi)) {
      tables.add(match[1].toLowerCase());
    }
  }
  return tables;
}

describe("Hoovie source contracts", () => {
  it("has exactly one contract per registry source, in registry order", () => {
    expect(HOOVIE_SOURCES.map((c) => c.source)).toEqual(REGISTRY_SOURCES.map((s) => s.source));
  });

  it("names a key for every keyed API and none elsewhere", () => {
    for (const contract of HOOVIE_SOURCES) {
      if (contract.connection === "keyed-api") expect(contract.envKey, contract.source).toMatch(/^[A-Z][A-Z0-9_]+$/);
      else expect(contract.envKey, contract.source).toBeUndefined();
    }
  });

  it("names the licence for every open-licence source", () => {
    for (const contract of HOOVIE_SOURCES.filter((c) => c.licence.status === "open-licence")) {
      expect(contract.licence.licenceName, contract.source).toBeTruthy();
    }
  });

  it("says what is unconfirmed for every held or unconfirmed licence", () => {
    for (const contract of HOOVIE_SOURCES.filter((c) => c.licence.status === "held" || c.licence.status === "terms-unconfirmed")) {
      expect(contract.licence.note, contract.source).toBeTruthy();
    }
  });

  it("gives every source a publisher and at least one grain", () => {
    for (const contract of HOOVIE_SOURCES) {
      expect(contract.publisher.trim(), contract.source).not.toBe("");
      expect(contract.grain.length, contract.source).toBeGreaterThan(0);
    }
  });

  it("writes only to tables the migrations create", () => {
    const known = migrationTables();
    const unknown = HOOVIE_SOURCES.flatMap((c) => c.tables.filter((t) => !known.has(t)).map((t) => `${c.source}: ${t}`));
    expect(unknown).toEqual([]);
  });

  it("looks a contract up by source key", () => {
    const first = HOOVIE_SOURCES[0];
    expect(hoovieSourceContract(first.source)).toBe(first);
    expect(hoovieSourceContract("no-such-source")).toBeNull();
  });
});
